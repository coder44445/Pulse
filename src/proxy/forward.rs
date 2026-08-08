use axum::body::Body;
use axum::http::{HeaderMap, HeaderName, Request, Response, StatusCode};
use axum::http::header;
use hyper::upgrade::OnUpgrade;
use hyper_util::client::legacy::{Client, connect::HttpConnector};
use hyper_util::rt::TokioIo;

// ─── Hop-by-hop header filtering ──────────────────────────────────────────────

/// Returns true if `name` is a standard hop-by-hop header that should not be
/// forwarded. Connection and Upgrade are handled separately so that WebSocket
/// upgrades can keep them.
fn is_hop_by_hop(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "keep-alive"
            | "transfer-encoding"
            | "te"
            | "trailers"
            | "proxy-connection"
            | "proxy-authenticate"
            | "proxy-authorization"
    )
}

/// Strip hop-by-hop headers from a header map.
///
/// When `keep_connection_upgrade` is **false** (normal HTTP), `Connection` and
/// any headers it lists are also removed.
/// When **true** (WebSocket upgrade path), `Connection` and `Upgrade` are kept
/// intact so the downstream server sees the correct handshake.
fn strip_hop_headers(headers: &mut HeaderMap, keep_connection_upgrade: bool) {
    if !keep_connection_upgrade {
        // Pull out headers the peer says are hop-by-hop via the Connection value.
        let listed: Vec<String> = headers
            .get(header::CONNECTION)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(',')
            .map(|s| s.trim().to_ascii_lowercase())
            .filter(|s| !s.is_empty())
            .collect();

        headers.remove(header::CONNECTION);

        for h in listed {
            if h != "upgrade" {
                headers.remove(h.as_str());
            }
        }
    }

    // Remove standard hop-by-hop headers.
    let to_remove: Vec<HeaderName> = headers
        .keys()
        .filter(|k| is_hop_by_hop(k.as_str()))
        .cloned()
        .collect();

    for h in to_remove {
        headers.remove(&h);
    }
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/// Returns `true` when the request is a WebSocket upgrade.
pub fn is_websocket_upgrade(req: &Request<Body>) -> bool {
    let has_upgrade_in_connection = req
        .headers()
        .get(header::CONNECTION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase()
        .contains("upgrade");

    let upgrade_is_websocket = req
        .headers()
        .get(header::UPGRADE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase()
        == "websocket";

    has_upgrade_in_connection && upgrade_is_websocket
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

fn error_response(status: StatusCode, msg: impl Into<String>) -> Response<Body> {
    Response::builder()
        .status(status)
        .body(Body::from(msg.into()))
        .unwrap()
}

// ─── HTTP proxy ───────────────────────────────────────────────────────────────

/// Forward a plain HTTP request to `target_uri`, streaming the response back.
/// The original method, headers, and body are preserved; hop-by-hop headers are
/// stripped in both directions.
pub async fn proxy_http(client: &Client<HttpConnector, Body>, req: Request<Body>, target_uri: &str) -> Response<Body> {
    let (mut parts, body) = req.into_parts();

    parts.uri = match target_uri.parse() {
        Ok(u) => u,
        Err(e) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                format!("invalid upstream URI: {e}"),
            )
        }
    };

    strip_hop_headers(&mut parts.headers, false);

    let backend_req = Request::from_parts(parts, body);

    match client.request(backend_req).await {
        Ok(res) => {
            let (mut res_parts, body) = res.into_parts();
            strip_hop_headers(&mut res_parts.headers, false);
            Response::from_parts(res_parts, Body::new(body))
        }
        Err(e) => error_response(
            StatusCode::BAD_GATEWAY,
            format!("upstream HTTP error: {e}"),
        ),
    }
}

// ─── WebSocket proxy ──────────────────────────────────────────────────────────

/// Proxy a WebSocket upgrade request.
///
/// Flow:
/// 1. Extract the server-side `OnUpgrade` future from the incoming request
///    extensions (inserted by hyper's HTTP/1.1 server).
/// 2. Forward the full upgrade handshake (including `Upgrade`, `Connection`,
///    and all `Sec-WebSocket-*` headers) to `target_uri`.
/// 3. Assert the backend returns 101 Switching Protocols.
/// 4. Extract the client-side `OnUpgrade` future from the backend response.
/// 5. Spawn a Tokio task that awaits both upgrades and then runs a
///    bidirectional byte-copy loop (`tokio::io::copy_bidirectional`).
/// 6. Return the 101 response (with backend headers) to the browser — hyper
///    will complete the server-side upgrade, which resolves step 5's future.
pub async fn proxy_websocket(client: &Client<HttpConnector, Body>, mut req: Request<Body>, target_uri: &str) -> Response<Body> {
    // Step 1: grab the upgrade future before consuming the request.
    let client_on_upgrade: Option<OnUpgrade> = req.extensions_mut().remove();

    let (mut parts, _body) = req.into_parts();

    // Step 2: rewrite the URI (keep http:// — WS handshake is still HTTP/1.1).
    parts.uri = match target_uri.parse() {
        Ok(u) => u,
        Err(e) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                format!("invalid upstream WS URI: {e}"),
            )
        }
    };

    // Keep Connection/Upgrade and all Sec-WebSocket-* headers intact.
    strip_hop_headers(&mut parts.headers, /*keep_connection_upgrade=*/ true);

    let backend_req = Request::from_parts(parts, Body::from(""));

    // Step 3: send the upgrade handshake to the backend.
    let mut backend_res = match client.request(backend_req).await {
        Ok(r) => r,
        Err(e) => {
            return error_response(
                StatusCode::BAD_GATEWAY,
                format!("upstream WS connect error: {e}"),
            )
        }
    };

    if backend_res.status() != StatusCode::SWITCHING_PROTOCOLS {
        return error_response(
            StatusCode::BAD_GATEWAY,
            format!(
                "backend did not upgrade WebSocket (got {})",
                backend_res.status()
            ),
        );
    }

    // Step 4: grab the backend's upgrade future.
    let backend_on_upgrade: Option<OnUpgrade> = backend_res.extensions_mut().remove();

    // Step 5: spawn the pipe — runs once both sides complete the 101 handshake.
    match (client_on_upgrade, backend_on_upgrade) {
        (Some(client_fut), Some(backend_fut)) => {
            tokio::spawn(async move {
                let client_conn = match client_fut.await {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("[proxy] WS client upgrade failed: {e}");
                        return;
                    }
                };
                let backend_conn = match backend_fut.await {
                    Ok(b) => b,
                    Err(e) => {
                        eprintln!("[proxy] WS backend upgrade failed: {e}");
                        return;
                    }
                };
                let mut client_io = TokioIo::new(client_conn);
                let mut backend_io = TokioIo::new(backend_conn);
                if let Err(e) =
                    tokio::io::copy_bidirectional(&mut client_io, &mut backend_io).await
                {
                    // EOF / peer disconnect is normal; log at debug level only.
                    eprintln!("[proxy] WS tunnel closed: {e}");
                }
            });
        }
        _ => {
            eprintln!("[proxy] WS upgrade futures missing — tunnel not started");
        }
    }

    // Step 6: return the 101 to the browser.
    let (mut res_parts, body) = backend_res.into_parts();
    strip_hop_headers(&mut res_parts.headers, /*keep_connection_upgrade=*/ true);
    Response::from_parts(res_parts, Body::new(body))
}
