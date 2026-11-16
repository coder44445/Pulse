use anyhow::{Context, Result};
use serde::Serialize;
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::core::application::Application;
use crate::core::state::State;
use crate::docker::{self, Runtime};
use crate::health;
use crate::registry;
use crate::storage;

#[derive(Debug, Serialize, Clone)]
pub struct AppSummary {
    pub id: String,
    pub name: String,
    pub status: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AppDetail {
    pub id: String,
    pub name: String,
    pub status: String,
    pub routes: Vec<String>,
    pub dependencies: Vec<String>,
    pub idle_timeout: Option<String>,
    pub stacks: Vec<StackInfo>,
    pub tier: u8,
}

#[derive(Debug, Serialize)]
pub struct StackInfo {
    pub name: String,
    pub compose: String,
    pub health_url: Option<String>,
}

pub fn normalize_status(raw: &str) -> String {
    match raw.to_ascii_lowercase().as_str() {
        "starting" | "healthcheck" | "stopping" => "starting".to_string(),
        "running" => "running".to_string(),
        "stopped" | "idle" => "stopped".to_string(),
        "failed" => "error".to_string(),
        _ => "stopped".to_string(),
    }
}

pub struct LifeCycleManager {
    runtime: Box<dyn Runtime + Send + Sync>,
    pool: SqlitePool,
    apps: Vec<Application>,
    locks: HashMap<String, Arc<Mutex<()>>>,
    dependents: HashMap<String, Vec<String>>,
}

impl LifeCycleManager {
    /// Expose the SQLite pool so the proxy can record `last_activity` directly.
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Expose cached applications so other modules don't re-read disk.
    pub fn get_apps(&self) -> &[Application] {
        &self.apps
    }
}

impl LifeCycleManager {
    pub async fn new() -> Result<Self> {
        let db_path = std::env::current_dir()
            .context("failed to determine current working directory")?
            .join("pulse.db");

        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).context("failed to create database directory")?;
        }

        // create_if_missing(true) ensures pulse.db is created on first run
        let opts = SqliteConnectOptions::new()
            .filename(&db_path)
            .create_if_missing(true);

        let pool = SqlitePool::connect_with(opts).await.context(format!(
            "failed to open sqlite database at {}",
            db_path.display()
        ))?;

        storage::database::init_db(&pool)
            .await
            .context("failed to initialize sqlite schema")?;

        let apps = registry::loader::load_all(Path::new("apps"))?;

        // ── Cycle detection (DFS) ───────────────────────────────────────────────
        // Fail fast at startup if the dependency graph has a cycle.
        let app_map: HashMap<String, &Application> =
            apps.iter().map(|a| (a.name.clone(), a)).collect();

        for app in &apps {
            let mut visited = HashSet::new();
            let mut stack = HashSet::new();
            if let Err(e) = detect_cycle(&app_map, &app.name, &mut visited, &mut stack) {
                anyhow::bail!(
                    "[pulse] dependency cycle detected at startup — refusing to boot: {}",
                    e
                );
            }
        }

        let mut locks = HashMap::new();
        let mut dependents: HashMap<String, Vec<String>> = HashMap::new();

        for app in &apps {
            locks.insert(app.name.clone(), Arc::new(Mutex::new(())));
            storage::database::ensure_app_record(&pool, &app.name).await?;

            // Build reverse dependency graph (dependents)
            if let Some(deps) = &app.dependencies {
                for dep in deps {
                    dependents
                        .entry(dep.clone())
                        .or_default()
                        .push(app.name.clone());
                }
            }
        }

        let runtime: Box<dyn Runtime + Send + Sync> =
            Box::new(docker::compose_runtime::DockerComposeRuntime);

        // ── Boot reconciliation ─────────────────────────────────────────────────
        for app in &apps {
            let db_state_raw = storage::database::get_state(&pool, &app.name)
                .await
                .unwrap_or(None)
                .unwrap_or_else(|| "stopped".to_string());
            let norm = normalize_status(&db_state_raw);

            if norm == "running" || norm == "starting" {
                let mut is_running = false;
                for stack in app.stacks.values() {
                    if let Ok(st) = runtime.status(&stack.compose).await {
                        if st.to_lowercase().contains("running")
                            || st.to_lowercase().contains("up")
                        {
                            is_running = true;
                            break;
                        }
                    }
                }
                if !is_running {
                    eprintln!(
                        "[pulse] Boot reconciliation: '{}' marked '{}' in db, but not running in docker. Fixing.",
                        app.name, norm
                    );
                    let _ = storage::database::set_state(&pool, &app.name, "Stopped").await;
                }
            }
        }

        let manager = LifeCycleManager {
            runtime,
            pool,
            apps,
            locks,
            dependents,
        };

        Ok(manager)
    }

    /// Auto-start all Tier 0 and Tier 1 (pinned) services in topological order.
    ///
    /// Called once from `main` after `LifeCycleManager::new()`, before opening
    /// the proxy listener.  Failures are logged but do not abort the boot
    /// sequence — pulse itself must stay up even if a pinned service is broken.
    pub async fn boot_pinned_services(&self) {
        // Collect pinned apps sorted by tier (0 first, then 1).
        let mut pinned: Vec<&Application> = self
            .apps
            .iter()
            .filter(|a| a.is_pinned() || a.is_control())
            .collect();
        pinned.sort_by_key(|a| a.tier);

        // Topological start: collect the full ordered list (deps then app).
        let mut boot_order: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();

        for app in &pinned {
            let mut visited = HashSet::new();
            let mut dep_names = Vec::new();
            if let Err(e) = self.collect_dependency_names(app, &mut visited, &mut dep_names) {
                eprintln!("[pulse] boot: could not resolve deps for '{}': {e}", app.name);
                continue;
            }
            for name in dep_names {
                if seen.insert(name.clone()) {
                    boot_order.push(name);
                }
            }
            if seen.insert(app.name.clone()) {
                boot_order.push(app.name.clone());
            }
        }

        eprintln!(
            "[pulse] boot: auto-starting pinned services in order: {:?}",
            boot_order
        );

        for name in &boot_order {
            eprintln!("[pulse] boot: starting '{name}' …");
            match self.start(name).await {
                Ok(()) => eprintln!("[pulse] boot: '{name}' is ready"),
                Err(e) => eprintln!("[pulse] boot: '{name}' failed to start: {e:?}"),
            }
        }
    }

    pub async fn list_applications_with_status(&self) -> Result<Vec<AppSummary>> {
        let mut summaries = Vec::with_capacity(self.apps.len());
        for app in &self.apps {
            let raw = storage::database::get_state(&self.pool, &app.name)
                .await
                .unwrap_or(None)
                .unwrap_or_else(|| "stopped".to_string());
            summaries.push(AppSummary {
                id: app.name.clone(),
                name: app.name.clone(),
                status: normalize_status(&raw),
                description: if app.routes.is_empty() {
                    None
                } else {
                    Some(format!("Routes: {}", app.routes.join(", ")))
                },
            });
        }
        Ok(summaries)
    }

    pub async fn get_app_detail(&self, name: &str) -> Result<AppDetail> {
        let app = self.find_app(name)?;
        let raw = storage::database::get_state(&self.pool, name)
            .await
            .unwrap_or(None)
            .unwrap_or_else(|| "stopped".to_string());

        let stacks = app
            .stacks
            .iter()
            .map(|(stack_name, s)| StackInfo {
                name: stack_name.clone(),
                compose: s.compose.clone(),
                health_url: s.health.clone(),
            })
            .collect();

        Ok(AppDetail {
            id: app.name.clone(),
            name: app.name.clone(),
            status: normalize_status(&raw),
            routes: app.routes.clone(),
            dependencies: app.dependencies.clone().unwrap_or_default(),
            idle_timeout: app.idle_timeout.clone(),
            stacks,
            tier: app.tier.0,
        })
    }

    async fn set_state(&self, name: &str, state: State) -> Result<(), sqlx::Error> {
        let state_text = format!("{:?}", state);
        storage::database::set_state(&self.pool, name, &state_text).await
    }

    fn find_app(&self, name: &str) -> Result<Application> {
        self.apps
            .iter()
            .find(|a| a.name == name)
            .cloned()
            .context("app not found")
    }

    fn get_lock(&self, name: &str) -> Result<Arc<Mutex<()>>> {
        self.locks
            .get(name)
            .cloned()
            .context("lock not found for app")
    }

    fn collect_dependency_names(
        &self,
        app: &Application,
        visited: &mut HashSet<String>,
        result: &mut Vec<String>,
    ) -> Result<()> {
        if let Some(dependencies) = &app.dependencies {
            for dep_name in dependencies {
                if visited.insert(dep_name.clone()) {
                    let dep_app = self.find_app(dep_name)?;
                    self.collect_dependency_names(&dep_app, visited, result)?;
                    result.push(dep_name.clone());
                }
            }
        }
        Ok(())
    }

    pub async fn start(&self, name: &str) -> Result<()> {
        let lock_arc = self.get_lock(name)?;
        let _lock = lock_arc.lock().await;

        // Fast path: already running (concurrent proxy request may have beaten us here)
        let raw = storage::database::get_state(&self.pool, name)
            .await
            .unwrap_or(None)
            .unwrap_or_else(|| "stopped".to_string());
        if normalize_status(&raw) == "running" {
            return Ok(());
        }

        println!("raw state: {raw}, app name: {name}");

        self.set_state(name, State::Starting).await?;

        let app = self.find_app(name)?;
        let mut visited = HashSet::new();
        let mut dependency_names = Vec::new();
        self.collect_dependency_names(&app, &mut visited, &mut dependency_names)?;

        for dep_name in dependency_names {
            let dep_app = self.find_app(&dep_name)?;

            // Check if already running before touching the dependency
            let dep_raw = storage::database::get_state(&self.pool, &dep_name)
                .await
                .unwrap_or(None)
                .unwrap_or_else(|| "stopped".to_string());
            if normalize_status(&dep_raw) == "running" {
                continue;
            }

            for stack in dep_app.stacks.values() {
                self.runtime.start(&stack.compose).await?;
            }

            // Health-check the dependency before moving to the next
            self.set_state(&dep_name, State::HealthCheck).await?;
            if let Some(url) = &dep_app.health.backend {
                if let Err(err) = health::checker::wait_until_healthy(url, 60).await {
                    self.set_state(&dep_name, State::Failed).await?;
                    anyhow::bail!("dependency {} failed health check: {}", dep_name, err);
                }
            }
            self.set_state(&dep_name, State::Running).await?;
        }

        for stack in app.stacks.values() {
            self.runtime.start(&stack.compose).await?;
        }

        self.set_state(name, State::HealthCheck).await?;

        // Wait for the app-level health endpoint (health.backend in app.yaml).
        if let Some(url) = &app.health.backend {
            if let Err(err) = health::checker::wait_until_healthy(url, 60).await {
                self.set_state(name, State::Failed).await?;
                return Err(err);
            }
        }

        self.set_state(name, State::Running).await?;
        Ok(())
    }

    async fn stop_internal(&self, name: &str, allow_pinned: bool) -> Result<()> {
        let app = self.find_app(name)?;

        if !allow_pinned && (app.is_pinned() || app.is_control()) {
            eprintln!("[pulse] stop: '{name}' is a pinned service (tier {}); ignoring stop request", app.tier.0);
            return Ok(());
        }

        let lock_arc = self.get_lock(name)?;
        let _lock = lock_arc.lock().await;

        if let Some(consumers) = self.dependents.get(name) {
            for consumer in consumers {
                let consumer_state_raw = storage::database::get_state(&self.pool, consumer)
                    .await
                    .unwrap_or(None)
                    .unwrap_or_else(|| "stopped".to_string());
                let consumer_norm = normalize_status(&consumer_state_raw);
                if consumer_norm == "running" || consumer_norm == "starting" {
                    eprintln!(
                        "[pulse] keeping {} alive: {} is running and depends on it",
                        name, consumer
                    );
                    return Ok(());
                }
            }
        }

        self.set_state(name, State::Stopping).await?;

        for stack in app.stacks.values() {
            self.runtime.stop(&stack.compose).await?;
        }

        if app.idle_timeout.is_some() {
            self.set_state(name, State::Idle).await?;
        } else {
            self.set_state(name, State::Stopped).await?;
        }

        Ok(())
    }

    pub async fn stop(&self, name: &str) -> Result<()> {
        self.stop_internal(name, false).await
    }

    pub async fn stop_all(&self) -> Result<()> {
        for name in stop_order(&self.apps) {
            self.stop(&name).await?;
        }
        Ok(())
    }

    pub async fn stop_infra(&self) -> Result<()> {
        let names: Vec<String> = stop_order(&self.apps)
            .into_iter()
            .filter(|name| self.find_app(name).map(|app| app.is_pinned() || app.is_control()).unwrap_or(false))
            .collect();

        for name in names {
            self.stop_internal(&name, true).await?;
        }

        Ok(())
    }

    pub async fn restart(&self, name: &str) -> Result<()> {
        let lock_arc = self.get_lock(name)?;
        let _lock = lock_arc.lock().await;
        self.set_state(name, State::Stopping).await?;

        let app = self.find_app(name)?;

        for stack in app.stacks.values() {
            self.runtime.restart(&stack.compose).await?;
        }

        self.set_state(name, State::Running).await?;
        Ok(())
    }

    pub async fn status(&self, name: &str) -> Result<String> {
        let app = self.find_app(name)?;
        let mut statuses = Vec::new();

        for stack in app.stacks.values() {
            statuses.push(self.runtime.status(&stack.compose).await?);
        }

        if !app.routes.is_empty() {
            statuses.push(format!("routes: {}", app.routes.join(", ")));
        }
        if let Some(timeout) = &app.idle_timeout {
            statuses.push(format!("idle_timeout: {timeout}"));
        }
        if let Some(dependencies) = &app.dependencies {
            statuses.push(format!("dependencies: {}", dependencies.join(", ")));
        }
        statuses.push(format!("tier: {}", app.tier.0));

        Ok(statuses.join("\n"))
    }
}

// ── Cycle detection ────────────────────────────────────────────────────────────

/// DFS-based cycle detection over the dependency graph.
///
/// Returns `Err` with a human-readable description of the cycle if one is found.
fn detect_cycle(
    app_map: &HashMap<String, &Application>,
    node: &str,
    visited: &mut HashSet<String>,
    stack: &mut HashSet<String>,
) -> Result<()> {
    if stack.contains(node) {
        anyhow::bail!("cycle through '{node}'");
    }
    if visited.contains(node) {
        return Ok(());
    }

    stack.insert(node.to_string());

    if let Some(app) = app_map.get(node) {
        if let Some(deps) = &app.dependencies {
            for dep in deps {
                detect_cycle(app_map, dep, visited, stack)
                    .with_context(|| format!("  ← '{node}' depends on '{dep}'"))?;
            }
        }
    }

    stack.remove(node);
    visited.insert(node.to_string());
    Ok(())
}

fn stop_order(apps: &[Application]) -> Vec<String> {
    let app_map: HashMap<String, &Application> = apps.iter().map(|app| (app.name.clone(), app)).collect();
    let mut ordered = Vec::new();
    let mut seen = HashSet::new();

    for app in apps {
        let mut visited = HashSet::new();
        let mut dep_names = Vec::new();
        let _ = collect_dependency_names_for_app(app, &app_map, &mut visited, &mut dep_names);

        for dep_name in dep_names {
            if seen.insert(dep_name.clone()) {
                ordered.push(dep_name);
            }
        }

        if seen.insert(app.name.clone()) {
            ordered.push(app.name.clone());
        }
    }

    ordered.reverse();
    ordered
}

fn collect_dependency_names_for_app(
    app: &Application,
    app_map: &HashMap<String, &Application>,
    visited: &mut HashSet<String>,
    result: &mut Vec<String>,
) {
    if let Some(dependencies) = &app.dependencies {
        for dep_name in dependencies {
            if visited.insert(dep_name.clone()) {
                if let Some(dep_app) = app_map.get(dep_name) {
                    collect_dependency_names_for_app(dep_app, app_map, visited, result);
                }
                result.push(dep_name.clone());
            }
        }
    }
}

#[test]
fn stop_order_prioritizes_dependents_before_dependencies() {
    use crate::core::stack::Stack;

    let apps = vec![
        Application {
            name: "identity".to_string(),
            stacks: HashMap::from([("default".to_string(), Stack {
                compose: "identity-compose.yml".to_string(),
                health: None,
            })]),
            dependencies: None,
            routes: vec![],
            idle_timeout: None,
            health: crate::core::application::HealthConfig::default(),
            tier: crate::core::application::Tier::ON_DEMAND,
        },
        Application {
            name: "api".to_string(),
            stacks: HashMap::from([("default".to_string(), Stack {
                compose: "api-compose.yml".to_string(),
                health: None,
            })]),
            dependencies: Some(vec!["identity".to_string()]),
            routes: vec![],
            idle_timeout: None,
            health: crate::core::application::HealthConfig::default(),
            tier: crate::core::application::Tier::ON_DEMAND,
        },
    ];

    let stop_order = stop_order(&apps);
    assert_eq!(stop_order, vec!["api", "identity"]);
}
