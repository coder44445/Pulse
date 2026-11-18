mod api;
mod core;
mod docker;
mod health;
mod lifecycle;
mod proxy;
mod registry;
mod storage;

use crate::lifecycle::manager::LifeCycleManager;
use anyhow::bail;
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// List all discovered applications
    List,
    /// Print the dependency graph
    Graph,
    Start {
        app: String,
    },
    Stop {
        app: String,
    },
    /// Stop every non-pinned service in dependency-safe order.
    StopAll,
    /// Alias for stop-all.
    Down,
    /// Stop all pinned infrastructure services (tier 0 and 1).
    StopInfra,
    /// Alias for stop-infra.
    InfraDown,
    Status {
        app: String,
    },
    Restart {
        app: String,
    },
    /// Start the management API (port 7777), reverse proxy (port 9000), and dashboard (port 4173).
    Serve,
    /// Alias for serve — start everything up.
    Up,
    /// Start just the Pulse dashboard frontend.
    Dashboard,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let app_dir = PathBuf::from("apps");
    let manager = LifeCycleManager::new().await?;

    match &cli.command {
        Commands::List => {
            let apps = registry::loader::load_all(&app_dir)?;
            for app in apps {
                println!("{}", app.name);
            }
        }
        
        Commands::Graph => {
            let apps = registry::loader::load_all(&app_dir)?;
            println!("Pulse Applications Dependency Tree:");
            for app in &apps {
                println!("📦 {}", app.name);
                if let Some(deps) = &app.dependencies {
                    if deps.is_empty() {
                        println!(" └─ (no dependencies)");
                    } else {
                        for (i, dep) in deps.iter().enumerate() {
                            let prefix = if i == deps.len() - 1 { " └─" } else { " ├─" };
                            println!("{} depends on: {}", prefix, dep);
                        }
                    }
                } else {
                    println!(" └─ (no dependencies)");
                }
                println!();
            }

            println!("Pulse Applications DAG Visualization:");
            let mut g = ascii_dag::graph::Graph::new();
            let mut ids = std::collections::HashMap::new();
            let labels: Vec<String> = apps.iter().map(|app| format!(" {} ", app.name)).collect();
            
            for (i, app) in apps.iter().enumerate() {
                let node = g.add_node(i + 1, labels[i].as_str());
                ids.insert(app.name.clone(), node);
            }
            for app in &apps {
                if let Some(deps) = &app.dependencies {
                    for dep in deps {
                        if let (Some(&from), Some(&to)) = (ids.get(&app.name), ids.get(dep)) {
                            g.add_edge(from, to, None);
                        }
                    }
                }
            }
            println!("{}", g.render());
        }

        Commands::Start { app } => {
            manager.start(app).await?;
        }

        Commands::Stop { app } => {
            manager.stop(app).await?;
        }

        Commands::StopAll | Commands::Down => {
            manager.stop_all().await?;
            manager.stop_infra().await?;
        }

        Commands::StopInfra | Commands::InfraDown => {
            manager.stop_infra().await?;
        }

        Commands::Status { app } => {
            let status = manager.status(app).await?;
            println!("{status}");
        }

        Commands::Restart { app } => {
            manager.restart(app).await?;
        }

        Commands::Dashboard => {
            start_dashboard()?;
        }

        Commands::Serve | Commands::Up => {
            let engine = Arc::new(build_engine().await?);

            // ── Auto-start pinned (tier 0 & 1) services before opening ports ─
            // This is async / non-blocking for pulse itself; failures are logged.
            engine.boot_pinned_services().await;

            start_dashboard()?;

            // ── Management API — port 7777 ────────────────────────────────────
            let mgmt_app = api::routes::build(engine.clone());
            let mgmt_listener = tokio::net::TcpListener::bind("127.0.0.1:7777").await?;

            // ── Reverse proxy — port 9000 ─────────────────────────────────────
            let proxy = proxy::router::ProxyRouter::new(engine.clone())?;
            let proxy_listener = tokio::net::TcpListener::bind("0.0.0.0:9000").await?;

            println!("[pulse] management API  →  http://127.0.0.1:7777");
            println!("[pulse] reverse proxy   →  http://0.0.0.0:9000");

            // ── Background Idle Sweeper ───────────────────────────────────────
            // Pinned services (tier 0 & 1) are excluded — the lifecycle manager's
            // stop() already guards them, but we skip the call entirely here to
            // avoid log noise.
            let engine_clone = engine.clone();
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
                loop {
                    interval.tick().await;
                    let apps = registry::loader::load_all(PathBuf::from("apps").as_path())
                        .unwrap_or_default();
                    for app in apps {
                        // Never idle-evict pinned services.
                        if app.is_pinned() || app.is_control(){
                            continue;
                        }
                        if let Some(timeout) = app.parsed_idle_timeout() {
                            let raw_state = storage::database::get_state(
                                engine_clone.pool(),
                                &app.name,
                            )
                            .await
                            .unwrap_or_default()
                            .unwrap_or_default();
                            if lifecycle::manager::normalize_status(&raw_state) == "running"
                                && let Ok(Some(idle_duration)) =
                                    storage::database::get_idle_duration(
                                        engine_clone.pool(),
                                        &app.name,
                                    )
                                    .await
                                && idle_duration > timeout
                            {
                                println!(
                                    "[pulse] '{}' idle {}s > {}s — stopping",
                                    app.name,
                                    idle_duration.as_secs(),
                                    timeout.as_secs()
                                );
                                let _ = engine_clone.stop(&app.name).await;
                            }
                        }
                    }
                }
            });

            // Run both servers concurrently; either dying stops the process.
            tokio::try_join!(
                async {
                    axum::serve(mgmt_listener, mgmt_app)
                        .await
                        .map_err(anyhow::Error::from)
                },
                proxy.serve(proxy_listener),
            )?;
        }
    }

    Ok(())
}

fn start_dashboard() -> anyhow::Result<()> {
    let mut cmd = if Command::new("pnpm").arg("--version").output().is_ok() {
        let mut c = Command::new("pnpm");
        c.current_dir("pulse-dashboard");
        c.args(["dev", "--", "--host", "0.0.0.0"]);
        c
    } else if Command::new("npm").arg("--version").output().is_ok() {
        let mut c = Command::new("npm");
        c.current_dir("pulse-dashboard");
        c.args(["run", "dev", "--", "--host", "0.0.0.0"]);
        c
    } else {
        bail!("Neither pnpm nor npm is installed; cannot start the Pulse dashboard.");
    };

    let child = cmd.spawn()?;
    println!("[pulse] dashboard started with pid {} → http://localhost:4173", child.id());
    Ok(())
}

async fn build_engine() -> anyhow::Result<LifeCycleManager> {
    LifeCycleManager::new().await
}
