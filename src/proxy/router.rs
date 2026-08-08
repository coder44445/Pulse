use std::collections::HashMap;

use std::sync::Arc;

use anyhow::Result;
use axum::body::Body;
use axum::extract::State;
use axum::http::{Request, Response, StatusCode};
use axum::Router;
use hyper_util::client::legacy::{Client, connect::HttpConnector};
use hyper_util::rt::TokioExecutor;
use sqlx::SqlitePool;
use tokio::net::TcpListener;

use crate::lifecycle::manager::{normalize_status, LifeCycleManager};
use crate::storage;

use super::forward;

// ─── Route table ─────────────────────────────────────────────────────────────

/// One entry in the proxy route table.
#[derive(Clone)]
struct RouteEntry {
    /// Name of the owning application (matches `app.yaml` `name:`).
    app_name: String,
    /// `scheme://host:port` derived from `health.backend` in `app.yaml`.
    /// Example: `"http://localhost:8000"`
    backend_base: String,
}

/// Derive `scheme://host:port` from a health check URL.
///
/// `"http://localhost:8000/health"` → `"http://localhost:8000"`
fn derive_backend_base(health_url: &str) -> Option<String> {
    let uri: axum::http::Uri = health_url.parse().ok()?;
    let scheme = uri.scheme_str().unwrap_or("http");
    let authority = uri.authority()?;
    Some(format!("{scheme}://{authority}"))
}

// ─── Proxy state (shared across all handler invocations) ─────────────────────

#[derive(Clone)]
pub struct ProxyState {
    engine: Arc<LifeCycleManager>,
    pool: SqlitePool,
    client: Arc<Client<HttpConnector, Body>>,
    /// Sorted longest-prefix first so that `/quiz/api` beats `/quiz`.
    routes: Vec<(String, RouteEntry)>,
}

impl ProxyState {
    fn new(engine: Arc<LifeCycleManager>, pool: SqlitePool) -> Result<Self> {
        let apps = engine.get_apps();
        let mut map: HashMap<String, RouteEntry> = HashMap::new();

        for app in apps {
            let Some(health_url) = app.health.backend.as_deref() else {
                eprintln!(
                    "[proxy] skipping '{}': no health.backend configured — \
                     cannot determine backend URL",
                    app.name
                );
                continue;
            };

            let Some(backend_base) = derive_backend_base(health_url) else {
                eprintln!(
                    "[proxy] skipping '{}': could not parse health URL '{health_url}'",
                    app.name
                );
                continue;
            };

            for prefix in &app.routes {
                map.insert(
                    prefix.clone(),
                    RouteEntry {
                        app_name: app.name.clone(),
                        backend_base: backend_base.clone(),
                    },
                );
            }
        }

        // Longest prefix wins.
        let mut routes: Vec<(String, RouteEntry)> = map.into_iter().collect();
        routes.sort_by(|a, b| b.0.len().cmp(&a.0.len()));

        eprintln!("[proxy] route table:");
        for (prefix, entry) in &routes {
            eprintln!("  {prefix}  →  {} (app: {})", entry.backend_base, entry.app_name);
        }

        let client = Arc::new(Client::builder(TokioExecutor::new()).build_http());

        Ok(Self { engine, pool, client, routes })
    }

    /// Longest-prefix match on `path`.
    fn match_route(&self, path: &str) -> Option<(&str, &RouteEntry)> {
        self.routes
            .iter()
            .find(|(prefix, _)| {
                path.starts_with(prefix.as_str())
                    && (path.len() == prefix.len()
                        || path[prefix.len()..].starts_with('/'))
            })
            .map(|(p, e)| (p.as_str(), e))
    }
}

// ─── Public entry point ───────────────────────────────────────────────────────

pub struct ProxyRouter {
    state: ProxyState,
}

impl ProxyRouter {
    /// Build the router, reading all `app.yaml` files to populate the route table.
    pub fn new(engine: Arc<LifeCycleManager>) -> Result<Self> {
        let pool = engine.pool().clone();
        let state = ProxyState::new(engine, pool)?;
        Ok(Self { state })
    }

    /// Start serving on the given listener.  Runs until the server is shut down.
    pub async fn serve(self, listener: TcpListener) -> Result<()> {
        let app = Router::new()
            .fallback(proxy_handler)
            .with_state(self.state);

        axum::serve(listener, app)
            .await
            .map_err(anyhow::Error::from)
    }
}

// ─── Core handler ─────────────────────────────────────────────────────────────

async fn proxy_handler(
    State(state): State<ProxyState>,
    req: Request<Body>,
) -> Response<Body> {
    let full_path = req.uri().path().to_owned();

    // 1. Match route prefix (longest-prefix wins).
    let (prefix, entry) = match state.match_route(&full_path) {
        Some(r) => r,
        None => {
            // FALLBACK: Route to the central Pulse Dashboard.
            // Override via PULSE_DASHBOARD_URL env var (default: http://127.0.0.1:4173)
            let backend_base = std::env::var("PULSE_DASHBOARD_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:4173".to_string());
            let query = req.uri().query().map(|q| format!("?{q}")).unwrap_or_default();
            let target_uri = format!("{}{}{}", backend_base, full_path, query);
            
            eprintln!("[proxy] fallback {} {full_path}  →  {target_uri}", req.method());

            if forward::is_websocket_upgrade(&req) {
                return forward::proxy_websocket(&state.client, req, &target_uri).await;
            } else {
                return forward::proxy_http(&state.client, req, &target_uri).await;
            }
        }
    };

    let app_name = entry.app_name.clone();
    let backend_base = entry.backend_base.clone();

    // Strip the matched prefix; keep the leading slash.
    // Frontends with a basePath (like quiz-ui) require the prefix to remain intact!
    let preserve_prefix = app_name == "quiz-ui";
    
    let stripped = if preserve_prefix {
        full_path.as_str()
    } else {
        let s = &full_path[prefix.len()..];
        if s.is_empty() { "/" } else { s }
    };

    // 2. Wake the app if it is not currently running.
    let raw_state = storage::database::get_state(&state.pool, &app_name)
        .await
        .unwrap_or(None)
        .unwrap_or_else(|| "stopped".into());

    if normalize_status(&raw_state) != "running" {
        eprintln!("[proxy] cold-starting '{app_name}' (current state: {raw_state}) …");
        if let Err(e) = state.engine.start(&app_name).await {
            eprintln!("[proxy] failed to start '{app_name}': {e:?}");
            return Response::builder()
                .status(StatusCode::SERVICE_UNAVAILABLE)
                .body(Body::from(format!(
                    "pulse proxy: could not start '{app_name}': {e}"
                )))
                .unwrap();
        }
        eprintln!("[proxy] '{app_name}' is ready");
    }

    // 3. Record activity (Phase 10 idle detection).
    let _ = storage::database::update_last_activity(&state.pool, &app_name).await;

    // 4. Build the upstream URI: backend_base + stripped_path + query.
    let query = req
        .uri()
        .query()
        .map(|q| format!("?{q}"))
        .unwrap_or_default();
    let target_uri = format!("{backend_base}{stripped}{query}");

    eprintln!(
        "[proxy] {} {full_path}  →  {target_uri}",
        req.method()
    );

    // 5. Dispatch: WebSocket upgrade or plain HTTP.
    if forward::is_websocket_upgrade(&req) {
        forward::proxy_websocket(&state.client, req, &target_uri).await
    } else {
        forward::proxy_http(&state.client, req, &target_uri).await
    }
}
