# Pulse

**Pulse** is a local application lifecycle manager built in Rust. It manages a fleet of Docker Compose–based services — starting, stopping, health-checking, and reverse-proxying them — from a single binary with a CLI, an HTTP management API, and a React dashboard.

> Think of it as a lightweight, self-hosted Heroku/Railway for your local development machine or private server: declare your apps in YAML, and Pulse handles everything else.

---

## Why Build Our Own?

When you run multiple microservices locally — a quiz backend, an identity service, a persona engine — the typical setup involves:

- Eight terminal tabs, each running `docker compose up`
- Manually tracking which service is on which port
- Forgetting to start a dependency before hitting an endpoint
- Services left running overnight burning RAM and CPU

Existing tools don't fully solve this:

| Tool | Problem |
|---|---|
| **Docker Compose** (plain) | No lifecycle management, no auto-start, no idle shutdown, no reverse proxy |
| **Traefik / Nginx** | Excellent proxy, but zero awareness of whether your app is even running |
| **Foreman / Overmind** | Process management, not Docker-native, no HTTP API or dashboard |
| **Kubernetes** | Massively over-engineered for a single developer machine; requires 8 GB just to run |
| **Tilt / Skaffold** | Build/deploy tooling, not runtime lifecycle management |
| **Systemd** | Linux-only, no wake-on-request, no web UI, no dependency graph |

**Pulse** combines everything in one binary:
- **Registry** — declare apps in YAML, Pulse finds them automatically
- **Lifecycle engine** — start/stop/restart with dependency ordering
- **Health checks** — know *when* an app is actually ready, not just started
- **Persistent state** — knows what was running before a restart
- **HTTP API** — same operations as CLI over HTTP
- **Dashboard** — visual start/stop from any browser
- **Reverse proxy** — `localhost:9000/quiz` instead of `localhost:8000`, with auto-wake on first request
- **Idle shutdown** — apps stop themselves after inactivity (coming in Phase 10)

It is purpose-built for exactly this workflow, written in Rust for near-zero overhead.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           pulse serve                                │
│                                                                     │
│   ┌───────────────────────┐     ┌──────────────────────────────┐   │
│   │   Management API      │     │     Reverse Proxy            │   │
│   │   Axum  port 7777     │     │     Axum  port 9000          │   │
│   │                       │     │                              │   │
│   │  GET  /applications   │     │  /quiz/*   → localhost:8000  │   │
│   │  POST /…/start        │     │  /identity → localhost:8200  │   │
│   │  POST /…/stop         │     │  /persona  → localhost:8100  │   │
│   │  POST /…/restart      │     │                              │   │
│   │  GET  /health         │     │  wake-on-request ✓           │   │
│   └──────────┬────────────┘     └──────────────┬───────────────┘   │
│              │                                  │                   │
│   ┌──────────▼──────────────────────────────────▼───────────────┐  │
│   │                    LifeCycleManager                          │  │
│   │  start() → deps → docker compose up → wait health → Running │  │
│   │  stop()  → docker compose down → Stopped/Idle               │  │
│   └──────────┬───────────────────────────────────────────────────┘  │
│              │                                                      │
│   ┌──────────▼──────────┐   ┌─────────────────────────────────┐   │
│   │   Registry           │   │   SQLite (pulse.db)             │   │
│   │   reads app.yaml     │   │   persists state + last_activity│   │
│   └─────────────────────┘   └─────────────────────────────────┘   │
│              │                                                      │
│   ┌──────────▼──────────┐                                          │
│   │  Docker Runtime      │                                         │
│   │  docker compose up/  │                                         │
│   │  down/restart/ps     │                                         │
│   └─────────────────────┘                                          │
└─────────────────────────────────────────────────────────────────────┘
```

```
                     pulse-dashboard/  (React + Vite + Tailwind)
                           │
                    talks to port 7777
```

---

## App State Machine

Every application moves through these states:

```
STOPPED ──→ STARTING ──→ HEALTH_CHECK ──→ RUNNING ──→ IDLE
                                              │           │
                                              └──→ STOPPING ──→ STOPPED
                                                      ↘ FAILED
```

| State | Meaning |
|---|---|
| `Stopped` | Containers are down |
| `Starting` | `docker compose up -d` issued, waiting for containers |
| `HealthCheck` | Containers up, polling `health.backend` URL |
| `Running` | Health passed, proxy can route traffic |
| `Idle` | No traffic for `idle_timeout`; will be stopped (Phase 10) |
| `Stopping` | `docker compose down` issued |
| `Failed` | Health check timed out or startup error |

---

## App Manifest Format

Each app lives in `apps/<name>/app.yaml`:

```yaml
# apps/quiz/app.yaml
name: quiz

stacks:
  frontend:
    compose: ../open-quiz-web/docker-compose.yml
  backend:
    compose: ../fastapi-app/docker-compose.yml

dependencies:
  - persona          # started before quiz, never stopped while quiz is running

idle_timeout: 30m    # auto-stop after 30 minutes of no proxy traffic

health:
  backend: http://localhost:8000/health   # polled until 200 OK before → Running

routes:
  - /quiz            # proxy prefix: localhost:9000/quiz → localhost:8000
```

Pulse discovers all `app.yaml` files under `apps/` at startup — **no registration step needed**. Adding a new app is: create the directory, write the YAML, restart `pulse serve`.

---

## Source Layout

```
pulse/
├── Cargo.toml
├── apps/                        ← one subdirectory per registered app
│   ├── quiz/app.yaml
│   ├── identity/app.yaml
│   └── persona/app.yaml
├── pulse.db                     ← SQLite state store (auto-created)
├── pulse-dashboard/             ← React UI (separate Vite project)
│   └── src/
│       ├── App.tsx              ← main dashboard
│       ├── api.ts               ← typed wrappers over port 7777
│       └── types.ts
└── src/
    ├── main.rs                  ← CLI entry point + server spawn
    ├── core/
    │   ├── application.rs       ← Application + HealthConfig structs
    │   ├── stack.rs             ← Stack struct
    │   └── state.rs             ← State enum
    ├── registry/
    │   └── loader.rs            ← walk apps/, parse app.yaml files
    ├── lifecycle/
    │   └── manager.rs           ← LifeCycleManager (start/stop/restart/status)
    ├── docker/
    │   └── compose_runtime.rs   ← DockerComposeRuntime (only place docker is called)
    ├── health/
    │   └── checker.rs           ← wait_until_healthy() polling loop
    ├── storage/
    │   └── database.rs          ← SQLite CRUD (state, last_activity)
    ├── api/
    │   ├── routes.rs            ← Axum router (port 7777)
    │   └── handlers.rs          ← HTTP handler functions
    └── proxy/
        ├── router.rs            ← route table, wake-on-request, port 9000
        └── forward.rs           ← hyper HTTP + WebSocket passthrough
```

### Key Design Rules (enforced across all phases)

1. **Only `src/docker/` ever calls `docker`** — nothing else shell-executes Docker.
2. **Only `src/lifecycle/` decides *whether* to start/stop** — `src/docker/` only executes the decision.
3. **Apps are never hardcoded** — every app must have an `app.yaml`; no app name appears in Rust source.
4. **Each app owns its own repo and database** — Pulse never reads another app's data.

---

## CLI Reference

```bash
# Register + discover apps (reads apps/ directory)
pulse list

# Lifecycle commands
pulse start   <app>    # start all stacks, wait for health
pulse stop    <app>    # stop all stacks
pulse restart <app>    # restart all stacks
pulse status  <app>    # print current state + routes + idle_timeout

# Start both servers
pulse serve
#   Management API → http://localhost:7777
#   Reverse Proxy  → http://localhost:9000
```

---

## HTTP Management API (port 7777)

Used by the dashboard and any CI/CD tooling.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Pulse server health check |
| `GET` | `/applications` | List all apps with status |
| `GET` | `/applications/:id` | App detail (routes, deps, stacks, idle timeout) |
| `POST` | `/applications/:id/start` | Start app |
| `POST` | `/applications/:id/stop` | Stop app |
| `POST` | `/applications/:id/restart` | Restart app |

```bash
# Examples
curl localhost:7777/applications
curl -X POST localhost:7777/applications/quiz/start
```

---

## Reverse Proxy (port 9000)

The proxy is the primary innovation over just using Docker Compose directly.

**Route table** is built at startup from every app's `routes:` list in `app.yaml`.  
**Backend target** is derived from `health.backend` (scheme + host + port, path stripped).

```
Request: GET localhost:9000/quiz/api/game/create
                │
         match prefix /quiz  → app "quiz"  → backend http://localhost:8000
                │
         is app Running?
           NO  → engine.start("quiz").await   (cold-start, waits for health)
           YES → continue
                │
         strip prefix  /quiz/api/game/create → /api/game/create
                │
         update last_activity in SQLite  (Phase 10 idle detection)
                │
         forward:  GET http://localhost:8000/api/game/create
                │
         stream response back to browser
```

### WebSocket Support

The proxy uses raw `hyper` (not `reqwest`) for full WebSocket passthrough:

1. Detects `Upgrade: websocket` + `Connection: Upgrade` headers
2. Extracts `hyper::upgrade::OnUpgrade` from the incoming request extensions
3. Forwards the HTTP/1.1 upgrade handshake to the backend
4. When backend responds 101, extracts the backend's `OnUpgrade` future
5. Spawns a Tokio task running `tokio::io::copy_bidirectional` between both connections

This means `ws://localhost:9000/quiz/ws/<room-id>` works transparently — the quiz frontend's real-time game rooms pass through Pulse without any message inspection or buffering.

---

## Dashboard (pulse-dashboard)

A React + Vite + Tailwind app that talks exclusively to port 7777.

```bash
cd pulse-dashboard
npm install
npm run dev   # http://localhost:5173
```

Features:
- Live app list with status badges (Running / Starting / Stopped / Error)
- Start / Stop / Restart per app
- Detail panel: routes, dependencies, stacks, idle timeout
- Polls every 4 seconds; shows "updated N ago" timestamp
- Offline banner when port 7777 is unreachable

The dashboard never talks to app backends directly — only to Pulse's management API.

---

## Connecting App Frontends to the Proxy

After Phase 8, app frontends should route API calls through Pulse instead of direct service ports.

**Example — Quiz app (`open-quiz-web/.env.local`):**

```env
# Set this ONE variable to route ALL traffic through Pulse proxy.
# Route table (from app.yaml routes:):
#   /quiz      → quiz backend   (localhost:8000)
#   /identity  → identity svc   (localhost:8002)
NEXT_PUBLIC_PULSE_PROXY_URL=http://localhost:9000
```

Leave it unset for direct-port dev mode (no proxy needed for plain `npm run dev`).

`src/lib/config.ts` in the quiz app resolves URLs automatically:
- Proxy set → `http://localhost:9000/quiz`, `ws://localhost:9000/quiz/ws/<id>`
- Proxy unset → `http://localhost:8000`, `ws://localhost:8000` (fallback)

---

## Getting Started

### Prerequisites

- Rust 1.75+ (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- Docker + Docker Compose v2 (`docker compose version`)
- Node.js 18+ (for the dashboard)

### Run

```bash
# 1. Clone and build
git clone <repo>
cd pulse
cargo build --release

# 2. Configure your apps (one app.yaml per service)
# See apps/quiz/app.yaml for the format

# 3. Start Pulse
cargo run -- serve
# [pulse] management API  →  http://0.0.0.0:7777
# [pulse] reverse proxy   →  http://0.0.0.0:9000
# [proxy] route table:
#   /quiz      →  http://localhost:8000 (app: quiz)
#   /identity  →  http://localhost:8200 (app: identity)
#   /persona   →  http://localhost:8100 (app: persona)

# 4. Start the dashboard (separate terminal)
cd pulse-dashboard && npm install && npm run dev

# 5. Hit an app through the proxy (starts it automatically if stopped)
curl http://localhost:9000/quiz/health
```

### SQLite State

Pulse stores app state in `pulse.db` in the working directory. State survives restarts — if quiz was `Running` when Pulse stopped, it remembers that on the next start.

```bash
# Inspect state directly
sqlite3 pulse.db "SELECT name, state, last_activity FROM applications;"
```

---

## Roadmap

| Phase | Status | Description |
|---|---|---|
| 1 — Registry | ✅ Done | `pulse list`, YAML loader |
| 2 — Docker Runtime | ✅ Done | `docker compose` abstraction |
| 3 — Lifecycle Engine | ✅ Done | `LifeCycleManager` |
| 4 — Health Checks | ✅ Done | `wait_until_healthy()` |
| 5 — Persistence | ✅ Done | SQLite state store |
| 6 — HTTP API | ✅ Done | Axum REST API on port 7777 |
| 7 — Dashboard | ✅ Done | React UI (Redesigned with glassmorphism in Phase 8) |
| 8 — Reverse Proxy | ✅ Done | Wake-on-request proxy on port 9000, full WS support |
| 9 — Dependency Graph | ✅ Done | Block stop if a dependent is running |
| 10 — Idle Detection | 🔜 Next | Auto-stop after `idle_timeout` |
| 11 — Deploy API | 🔜 | `POST /applications/:id/deploy` + rollback |
| 12 — CI Webhooks | 🔜 | GitHub → Jenkins → Pulse, fully automated |
| 13 — Metrics & Logs | 🔜 | CPU/RAM per app, log streaming in dashboard |
| 14 — Scheduler | 🔜 | Cron jobs (backups, cleanup windows) |
| 15 — Plugin System | 🔜 | Discord/Slack/Email integrations as plugins |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | Rust (Tokio async runtime) |
| HTTP server | Axum 0.7 |
| HTTP/WS proxy | hyper 1.x + hyper-util |
| Outbound HTTP | reqwest 0.12 |
| State store | SQLite via sqlx 0.8 |
| YAML parsing | serde + serde_yaml |
| CLI | clap 4 |
| Dashboard | React 18 + Vite + TypeScript + Tailwind CSS |
| Container runtime | Docker Compose v2 |

---

## Contributing

Each phase in [build.md](build.md) is self-contained and has a clear exit criterion. When adding new features:

1. Find the correct module boundary (`src/docker/` for Docker, `src/lifecycle/` for decisions, `src/api/` for HTTP surface)
2. Write the app.yaml field first if the feature requires new config
3. Ensure `cargo build` passes before opening a PR
4. Do not import `tokio::process` outside of `src/docker/`
