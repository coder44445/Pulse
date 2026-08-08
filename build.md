# Pulse — Implementation Guide

A step-by-step build path. Each phase has a **goal**, **exact steps**, **code**, and a **verification check** — don't move to the next phase until the check passes.

**Rule for the whole project:** each phase must work standing alone before you touch the next one. If `pulse list` isn't reliable, don't start writing Docker code.

---

## 0. Prerequisites

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustc --version   # 1.75+

# Init the project
cargo new pulse --bin
cd pulse
```

Your `Cargo.toml` will grow one dependency block per phase — don't add everything up front. Each phase below lists exactly what to add.

---

## Phase 0 — Domain Modeling (no code yet)

**Goal:** know your nouns before you write a line of Rust.

**Steps:**
1. On paper or in a scratch `NOTES.md`, write out the five core concepts and their fields:
   - `Application` — name, version, stacks, dependencies, routes, idle_timeout
   - `Stack` — name, compose file path, health URL, current state
   - `Dependency` — application → application relationship
   - `State` — the lifecycle states (see below)
   - `Event` — things that happen (`ApplicationStarted`, `HealthFailed`, ...)
2. Draw the state machine on paper:
   ```
   STOPPED → STARTING → HEALTH_CHECK → RUNNING → IDLE → STOPPING → STOPPED
                                                                ↘ FAILED
   ```
3. Write one example `app.yaml` by hand (see Phase 1.3) so you know exactly what the loader needs to parse.

**Check:** you can describe, out loud, what happens when a user opens `localhost/quiz` from cold, without opening your editor.

---

## Phase 1 — Registry (`pulse list`)

**Goal:** read `app.yaml` files off disk and print the applications found. No Docker, no HTTP, no UI.

### 1.1 Add dependencies

```toml
# Cargo.toml
[dependencies]
serde = { version = "1", features = ["derive"] }
serde_yaml = "0.9"
walkdir = "2"
anyhow = "1"
clap = { version = "4", features = ["derive"] }
```

### 1.2 Directory layout

```
pulse/
├── Cargo.toml
├── src/
│   ├── main.rs
│   ├── core/
│   │   ├── mod.rs
│   │   ├── application.rs
│   │   └── stack.rs
│   └── registry/
│       ├── mod.rs
│       └── loader.rs
└── apps/
    ├── quiz/app.yaml
    └── persona/app.yaml
```

### 1.3 Write the manifest format first

```yaml
# apps/quiz/app.yaml
name: quiz

stacks:
  frontend:
    compose: ../quiz-frontend/docker-compose.yml
  backend:
    compose: ../quiz-backend/docker-compose.yml

dependencies:
  - persona

idle_timeout: 30m

health:
  backend: http://localhost:8000/health

routes:
  - /quiz
```

### 1.4 Define the core types

```rust
// src/core/stack.rs
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Stack {
    pub compose: String,
    #[serde(default)]
    pub health: Option<String>,
}
```

```rust
// src/core/application.rs
use serde::Deserialize;
use std::collections::HashMap;
use super::stack::Stack;

#[derive(Debug, Clone, Deserialize)]
pub struct Application {
    pub name: String,
    pub stacks: HashMap<String, Stack>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub routes: Vec<String>,
    #[serde(default)]
    pub idle_timeout: Option<String>,
}
```

```rust
// src/core/mod.rs
pub mod application;
pub mod stack;
```

### 1.5 Write the loader

```rust
// src/registry/loader.rs
use anyhow::{Context, Result};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;
use crate::core::application::Application;

pub fn load_all(apps_dir: &Path) -> Result<Vec<Application>> {
    let mut apps = Vec::new();

    for entry in WalkDir::new(apps_dir).max_depth(2) {
        let entry = entry?;
        if entry.file_name() == "app.yaml" {
            let content = fs::read_to_string(entry.path())
                .with_context(|| format!("reading {:?}", entry.path()))?;
            let app: Application = serde_yaml::from_str(&content)
                .with_context(|| format!("parsing {:?}", entry.path()))?;
            apps.push(app);
        }
    }

    Ok(apps)
}
```

```rust
// src/registry/mod.rs
pub mod loader;
```

### 1.6 Wire up the CLI

```rust
// src/main.rs
mod core;
mod registry;

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// List all discovered applications
    List,
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let apps_dir = PathBuf::from("apps");

    match cli.command {
        Commands::List => {
            let apps = registry::loader::load_all(&apps_dir)?;
            println!("Applications");
            for app in apps {
                println!("  {}", app.name);
            }
        }
    }

    Ok(())
}
```

### 1.7 Verify

```bash
cargo run -- list
```

Expected:
```
Applications
  quiz
  persona
```

**Exit criterion for Phase 1:** `pulse list` correctly discovers every `app.yaml` under `apps/`, and a malformed YAML file produces a clear error naming the file — not a panic.

---

## Phase 2 — Docker Runtime Layer

**Goal:** one trait, one implementation, and Pulse never calls `docker` directly anywhere else.

### 2.1 Add dependencies

```toml
tokio = { version = "1", features = ["full"] }
```

### 2.2 Define the trait

```rust
// src/docker/mod.rs
use anyhow::Result;
use async_trait::async_trait;

#[async_trait]
pub trait Runtime {
    async fn start(&self, compose_path: &str) -> Result<()>;
    async fn stop(&self, compose_path: &str) -> Result<()>;
    async fn restart(&self, compose_path: &str) -> Result<()>;
    async fn status(&self, compose_path: &str) -> Result<String>;
}
```

(add `async-trait = "0.1"` to `Cargo.toml`)

### 2.3 Implement it against Docker Compose

```rust
// src/docker/compose_runtime.rs
use anyhow::{bail, Result};
use async_trait::async_trait;
use tokio::process::Command;
use super::Runtime;

pub struct DockerComposeRuntime;

#[async_trait]
impl Runtime for DockerComposeRuntime {
    async fn start(&self, compose_path: &str) -> Result<()> {
        run(&["compose", "-f", compose_path, "up", "-d"]).await
    }

    async fn stop(&self, compose_path: &str) -> Result<()> {
        run(&["compose", "-f", compose_path, "down"]).await
    }

    async fn restart(&self, compose_path: &str) -> Result<()> {
        self.stop(compose_path).await?;
        self.start(compose_path).await
    }

    async fn status(&self, compose_path: &str) -> Result<String> {
        let output = Command::new("docker")
            .args(["compose", "-f", compose_path, "ps", "--format", "json"])
            .output()
            .await?;
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}

async fn run(args: &[&str]) -> Result<()> {
    let status = Command::new("docker").args(args).status().await?;
    if !status.success() {
        bail!("docker {:?} failed with {}", args, status);
    }
    Ok(())
}
```

### 2.4 Wire into the CLI

```rust
// in main.rs, add:
Commands::Start { app } => {
    let apps = registry::loader::load_all(&apps_dir)?;
    let target = apps.iter().find(|a| a.name == app).context("app not found")?;
    let runtime = docker::compose_runtime::DockerComposeRuntime;
    for stack in target.stacks.values() {
        runtime.start(&stack.compose).await?;
    }
}
```

Add matching `Stop { app }` and `Status { app }` variants and `#[tokio::main] async fn main()`.

### 2.5 Verify

```bash
cargo run -- start quiz
docker ps            # containers for quiz should be up
cargo run -- stop quiz
```

**Exit criterion:** `pulse start/stop/status quiz` correctly shells out to `docker compose` for every stack in `quiz`'s manifest. Nothing outside `src/docker/` imports `tokio::process::Command`.

---

## Phase 3 — Lifecycle Engine

**Goal:** connect Registry + Docker Runtime behind one API so the CLI/HTTP layer never touches Docker or YAML directly.

### 3.1 Steps
1. Create `src/lifecycle/manager.rs` with a `LifecycleEngine` struct holding the loaded `Vec<Application>` and a `Box<dyn Runtime>`.
2. Give it one method per action:
   ```rust
   pub struct LifecycleEngine {
       apps: Vec<Application>,
       runtime: Box<dyn Runtime + Send + Sync>,
   }

   impl LifecycleEngine {
       pub async fn start(&self, name: &str) -> Result<()> {
           let app = self.find(name)?;
           for stack in app.stacks.values() {
               self.runtime.start(&stack.compose).await?;
           }
           Ok(())
       }
       // stop(), restart(), status() follow the same shape
   }
   ```
3. Replace the CLI's direct calls to `registry::loader` + `DockerComposeRuntime` with calls through `LifecycleEngine` only.

### 3.2 Verify
Run `pulse start quiz`, `pulse restart quiz`, `pulse stop quiz` — behavior should be identical to Phase 2, but now routed through one object instead of scattered calls in `main.rs`.

**Exit criterion:** deleting `src/docker` and swapping in a fake `Runtime` (for tests) requires touching only `LifecycleEngine`'s constructor, nothing else.

---

## Phase 4 — Health System & State Machine

**Goal:** replace "did the command succeed" with "is the app actually healthy," tracked as a real state machine.

### 4.1 Add dependencies
```toml
reqwest = { version = "0.12", features = ["json"] }
```

### 4.2 Define the state enum

```rust
// src/core/state.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Stopped,
    Starting,
    HealthCheck,
    Running,
    Idle,
    Stopping,
    Failed,
}
```

### 4.3 Write the health checker

```rust
// src/health/checker.rs
use anyhow::Result;

pub async fn is_healthy(url: &str) -> bool {
    match reqwest::get(url).await {
        Ok(resp) => resp.status().is_success(),
        Err(_) => false,
    }
}

pub async fn wait_until_healthy(url: &str, timeout_secs: u64) -> Result<()> {
    let start = std::time::Instant::now();
    while start.elapsed().as_secs() < timeout_secs {
        if is_healthy(url).await {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    anyhow::bail!("health check timed out for {url}")
}
```

### 4.4 Drive state transitions in the Lifecycle Engine

```rust
pub async fn start(&self, name: &str) -> Result<()> {
    self.set_state(name, State::Starting);
    let app = self.find(name)?;
    for stack in app.stacks.values() {
        self.runtime.start(&stack.compose).await?;
    }
    self.set_state(name, State::HealthCheck);
    for stack in app.stacks.values() {
        if let Some(url) = &stack.health {
            health::checker::wait_until_healthy(url, 30).await?;
        }
    }
    self.set_state(name, State::Running);
    Ok(())
}
```

(`set_state` for now can just write into an in-memory `HashMap<String, State>` guarded by a `Mutex` — persistence comes in Phase 5.)

### 4.5 Verify
```bash
cargo run -- start quiz
cargo run -- status quiz   # should print Running only after /health returns 200
```

**Exit criterion:** stopping the health endpoint mid-start causes `pulse start quiz` to fail loudly instead of reporting success.

---

## Phase 5 — Persistence (SQLite)

**Goal:** survive a Pulse restart without losing runtime state.

### 5.1 Add dependencies
```toml
sqlx = { version = "0.8", features = ["sqlite", "runtime-tokio", "chrono"] }
```

### 5.2 Schema

```sql
-- migrations/0001_init.sql
CREATE TABLE applications (
    name TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'stopped',
    last_started TEXT,
    last_activity TEXT,
    crash_count INTEGER NOT NULL DEFAULT 0
);
```

### 5.3 Steps
1. `cargo install sqlx-cli --no-default-features --features sqlite`
2. `sqlx database create --database-url sqlite://pulse.db`
3. `sqlx migrate run --database-url sqlite://pulse.db`
4. Create `src/storage/database.rs` with a thin wrapper:
   ```rust
   pub async fn set_state(pool: &SqlitePool, name: &str, state: &str) -> Result<()> {
       sqlx::query("UPDATE applications SET state = ?, last_activity = datetime('now') WHERE name = ?")
           .bind(state)
           .bind(name)
           .execute(pool)
           .await?;
       Ok(())
   }
   ```
5. On Pulse startup, upsert every app found by the Registry into the `applications` table (so new apps in `apps/` appear automatically).
6. Replace the in-memory `HashMap` from Phase 4 with calls to this module.

### 5.4 Verify
```bash
cargo run -- start quiz
sqlite3 pulse.db "select name, state from applications;"
# restart the pulse process — state should still read 'running' until you stop it
```

**Exit criterion:** killing and restarting the Pulse process does not lose an app's last-known state or crash count.

---

## Phase 6 — REST API (Axum)

**Goal:** expose the Lifecycle Engine over HTTP so the Dashboard (Phase 7) has something to call.

### 6.1 Add dependencies
```toml
axum = "0.7"
tower = "0.5"
serde_json = "1"
```

### 6.2 Handlers

```rust
// src/api/handlers.rs
use axum::{extract::{State, Path}, Json};
use std::sync::Arc;
use crate::lifecycle::manager::LifecycleEngine;

pub async fn list_applications(
    State(engine): State<Arc<LifecycleEngine>>,
) -> Json<Vec<String>> {
    Json(engine.list_names())
}

pub async fn start_application(
    State(engine): State<Arc<LifecycleEngine>>,
    Path(id): Path<String>,
) -> Result<Json<&'static str>, axum::http::StatusCode> {
    engine.start(&id).await
        .map(|_| Json("started"))
        .map_err(|_| axum::http::StatusCode::INTERNAL_SERVER_ERROR)
}
```

### 6.3 Router

```rust
// src/api/routes.rs
use axum::{Router, routing::{get, post}};
use std::sync::Arc;
use crate::lifecycle::manager::LifecycleEngine;
use super::handlers::*;

pub fn build(engine: Arc<LifecycleEngine>) -> Router {
    Router::new()
        .route("/applications", get(list_applications))
        .route("/applications/:id/start", post(start_application))
        // .../stop, .../restart follow the same pattern
        .with_state(engine)
}
```

### 6.4 Serve it

```rust
// in main.rs, add a Commands::Serve variant:
Commands::Serve => {
    let engine = Arc::new(build_engine()?);
    let app = api::routes::build(engine);
    let listener = tokio::net::TcpListener::bind("0.0.0.0:7777").await?;
    axum::serve(listener, app).await?;
}
```

### 6.5 Verify
```bash
cargo run -- serve &
curl localhost:7777/applications
curl -X POST localhost:7777/applications/quiz/start
```

**Exit criterion:** every CLI command from Phases 1–4 now has an equivalent HTTP endpoint, and both paths (CLI and HTTP) go through the same `LifecycleEngine` instance logic.

---

## Phase 7 — Dashboard (React)

**Goal:** a minimal UI over the API from Phase 6. Not the focus of the backend project — keep it thin.

### 7.1 Steps
1. `npm create vite@latest pulse-dashboard -- --template react-ts`
2. `npm install` inside `pulse-dashboard/`, add Tailwind (`npm install -D tailwindcss postcss autoprefixer && npx tailwindcss init -p`).
3. Build four screens, each backed directly by the Phase 6 API:
   - **Applications** — `GET /applications`, list with a status badge per app.
   - **Application Details** — shows dependencies, routes, health URL.
   - **Logs** — placeholder until Phase 13's log collector exists.
   - **Metrics** — placeholder until Phase 13.
4. Each app card gets Start / Stop / Restart buttons calling the matching `POST` endpoint.
5. Poll `GET /applications` every few seconds (or add a WebSocket later) to reflect state changes.

### 7.2 Verify
Load the dashboard, click Start on Quiz, watch the badge move `stopped → starting → running`.

**Exit criterion:** you can start/stop every registered app from the browser without touching the CLI.

---

## Phase 8 — Router / Reverse Proxy (✅ Done)

**Goal:** `localhost/quiz` instead of `localhost:8000`, with automatic wake-on-request.

### 8.1 Add dependencies
```toml
hyper = { version = "1", features = ["full"] }
hyper-util = { version = "0.1", features = ["full"] }
```

### 8.2 Steps
1. Add a route table: `route prefix -> app name` (built from each `app.yaml`'s `routes:` list at Registry load time).
2. On every incoming request to the proxy port:
   ```
   match route prefix
     → look up owning application
     → check current state (from Phase 5 storage)
     → if not Running: call engine.start(app).await, wait for health
     → forward the request to the app's actual backend port
   ```
3. Implement forwarding with `hyper::Client` (or `reqwest` for simplicity first — swap to raw `hyper` only if you need streaming/websocket passthrough).
4. Record `last_activity = now()` on every forwarded request (feeds Phase 10).

### 8.3 Verify
```bash
cargo run -- stop quiz
curl localhost/quiz   # should transparently start quiz, wait for health, then return the page
```

**Exit criterion:** a cold request to a stopped app succeeds without the user ever calling `pulse start` manually, and the response time for a warm app is unaffected.

---

## Phase 9 — Dependency Graph (✅ Done)

**Goal:** don't stop an app that something else still needs.

### 9.1 Steps
1. Build a simple adjacency structure at Registry load time from each app's `dependencies:` list: `HashMap<String, Vec<String>>` (app → its dependencies) and the reverse (`HashMap<String, Vec<String>>`, dependency → dependents).
2. Before `LifecycleEngine::stop(name)` actually calls the runtime, check the reverse map: are any of `name`'s dependents currently `Running`? If yes, skip the stop (or queue it) and log why.
3. Before `start(name)`, walk the forward map recursively and `start()` each dependency first, waiting for its health check before starting `name` itself.

### 9.2 Verify
```bash
cargo run -- stop persona     # while quiz (which depends on persona) is running
# persona should remain running; Pulse should log "keeping persona alive: quiz depends on it"
```

**Exit criterion:** stopping a shared dependency while a consumer is active is a no-op (with a log line explaining why), and starting a consumer transitively starts its dependencies in the right order.

---

## Phase 10 — Idle Detection

**Goal:** stop apps automatically after a period with no traffic.

### 10.1 Steps
1. Every request through the Router (Phase 8) already updates `last_activity` in SQLite.
2. Spawn a background Tokio task at startup:
   ```rust
   tokio::spawn(async move {
       let mut interval = tokio::time::interval(Duration::from_secs(60));
       loop {
           interval.tick().await;
           for app in engine.running_apps() {
               if app.idle_for() > app.idle_timeout {
                   engine.stop(&app.name).await.ok();
               }
           }
       }
   });
   ```
3. Respect the Dependency Graph from Phase 9 — the idle sweep should call the same `stop()` path, not bypass it.

### 10.2 Verify
Set an app's `idle_timeout: 1m` for testing, hit it once, then wait — confirm it auto-stops and the dashboard reflects it.

**Exit criterion:** an app with no traffic for longer than its configured `idle_timeout` transitions to `Stopped` without manual intervention, and one with active dependents never does.

---

## Phase 11 — Deployment API

**Goal:** let CI trigger an update without Pulse building anything itself.

### 11.1 Steps
1. Add `POST /applications/:id/deploy` with body `{ "tag": "1.2.0" }`.
2. Handler flow:
   ```
   pull the new image tag (docker pull <image>:<tag>)
   → runtime.restart(compose_path) with the new tag substituted in
   → wait_until_healthy()
   → on failure: restart with the previous known-good tag (basic rollback)
   ```
3. Store the currently deployed tag per app in SQLite so rollback has something to roll back to.

### 11.2 Verify
```bash
curl -X POST localhost:7777/applications/quiz/deploy -d '{"tag":"1.2.0"}'
```
Confirm the container is running the new image tag and health passes.

**Exit criterion:** a deploy that fails its health check automatically reverts to the previous tag instead of leaving the app down.

---

## Phase 12 — Webhooks / CI Integration

**Goal:** GitHub → Jenkins → image push → Pulse deploy, hands-off.

### 12.1 Steps
1. Add `POST /webhooks/deploy` that verifies a shared-secret signature header.
2. On a valid webhook, translate the payload (`app`, `tag`) into a call to the Phase 11 deploy handler internally — don't duplicate the deploy logic.
3. Configure your CI (Jenkins/GitHub Actions) to `curl` this endpoint as its final pipeline step after pushing the image.

**Exit criterion:** pushing to `main` on an app's repo results in Pulse deploying the new image with zero manual steps, end to end.

---

## Phase 13 — Metrics & Logs

**Goal:** CPU, RAM, restarts, crashes, request counts, and log streaming per app.

### 13.1 Steps
1. Add `GET /applications/:id/metrics` backed by `docker stats --no-stream --format json` parsed per container.
2. Add `GET /applications/:id/logs` backed by `docker compose logs --tail 200`, optionally as an SSE stream for live tailing.
3. Persist rolling counters (restart count, crash count) in the existing SQLite table rather than a new store.
4. Wire the Dashboard's Metrics/Logs placeholder pages (Phase 7) to these two endpoints.

**Exit criterion:** the dashboard shows live CPU/RAM per app and a scrollable/tailing log view without shelling out from the frontend.

---

## Phase 14 — Scheduler

**Goal:** timed jobs — backups, cleanup, scheduled shutdown/startup windows.

### 14.1 Steps
1. Add `cron = "0.12"` (or hand-roll with `tokio::time::interval` for simple cases).
2. Define a `Job` trait with a `cron_expr()` and `run()`.
3. Register jobs in a `src/scheduler/jobs.rs` list: nightly backup, idle-sweep (already exists from Phase 10 — can be reframed as a Job here), image update check.
4. Run the scheduler as a background Tokio task alongside the Router and idle sweep.

**Exit criterion:** a job configured for `0 3 * * *` reliably fires once daily without manual triggering, verified via logs over a 24h period.

---

## Phase 15 — Plugin System

**Goal:** optional integrations (Discord, Slack, Email, GitHub, Jenkins) as swappable plugins instead of hardcoded features.

### 15.1 Steps
1. Define a `Plugin` trait keyed off the Event system from Phase 0/4: `fn on_event(&self, event: &Event)`.
2. Load enabled plugins from `config/pulse.yaml` at startup into a `Vec<Box<dyn Plugin>>`.
3. Every place that currently emits an `Event` (health failures, deploys, idle shutdowns) broadcasts to all registered plugins.
4. Ship a first plugin (e.g. Discord webhook on `ApplicationFailed`) as the reference implementation others can copy.

**Exit criterion:** adding a new integration means writing one new file implementing `Plugin` and adding one line to `pulse.yaml` — no changes to core modules.

---

## Reference: Full Repository Structure (end state)

```
pulse/
├── Cargo.toml
├── src/
│   ├── main.rs
│   ├── core/            application.rs, stack.rs, dependency.rs, state.rs, event.rs
│   ├── registry/        loader.rs, validator.rs, discovery.rs
│   ├── lifecycle/       manager.rs, state_machine.rs, reconciler.rs
│   ├── docker/          client.rs, compose.rs, container.rs
│   ├── dependency/       graph.rs, resolver.rs
│   ├── health/           checker.rs, monitor.rs
│   ├── router/           proxy.rs, routes.rs
│   ├── deployment/       webhook.rs, updater.rs, rollback.rs
│   ├── scheduler/        jobs.rs
│   ├── metrics/          collector.rs, exporter.rs
│   ├── logs/             collector.rs
│   ├── storage/          database.rs, models.rs
│   ├── api/              routes.rs, handlers.rs
│   └── plugins/          manager.rs
└── config/
    ├── pulse.yaml
    └── applications/     quiz.yaml, persona.yaml, upload.yaml
```

## Reference: Tech Stack by Phase

| Phase | Crates/tools added |
|---|---|
| 1 | serde, serde_yaml, walkdir, anyhow, clap |
| 2 | tokio, async-trait |
| 4 | reqwest |
| 5 | sqlx (+ sqlx-cli) |
| 6 | axum, tower, serde_json |
| 7 | vite, react, typescript, tailwind (separate `pulse-dashboard/` project) |
| 8 | hyper, hyper-util |
| 14 | cron |

## Reference: Non-Negotiable Rules (apply at every phase)

- Never hardcode an application — it must come from an `app.yaml` manifest.
- Only `src/docker/` is allowed to call `docker`/`docker compose`.
- Only `src/lifecycle/` decides *whether* something should start/stop; `src/docker/` only *executes*.
- Every meaningful state change emits an `Event` (Phase 0 model) — don't wait until Phase 15 to start doing this, retrofit costs more later.
- Applications keep their own repos and own databases; Pulse never queries another app's tables directly.

## Quick Checklist

- [ ] Phase 1: `pulse list` works
- [ ] Phase 2: `pulse start/stop/status <app>` works
- [ ] Phase 3: CLI routes through `LifecycleEngine`, not raw modules
- [ ] Phase 4: state machine + real health checks
- [ ] Phase 5: state survives a Pulse restart
- [ ] Phase 6: REST API mirrors CLI
- [ ] Phase 7: dashboard can start/stop apps
- [ ] Phase 8: `localhost/quiz` auto-wakes the app
- [ ] Phase 9: stopping a shared dependency is blocked correctly
- [ ] Phase 10: idle apps auto-stop
- [ ] Phase 11: deploy endpoint with rollback
- [ ] Phase 12: CI webhook triggers deploy automatically
- [ ] Phase 13: metrics + logs visible in dashboard
- [ ] Phase 14: scheduled jobs fire reliably
- [ ] Phase 15: new integrations are plugin files, not core edits