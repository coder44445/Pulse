mod api;
mod core;
mod docker;
mod health;
mod lifecycle;
mod proxy;
mod registry;
mod storage;

use crate::lifecycle::manager::LifeCycleManager;
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::sync::Arc;
use tokio;

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
    Status {
        app: String,
    },
    Restart {
        app: String,
    },
    /// Start the management API (port 7777) and reverse proxy (port 9000).
    Serve,
    /// Alias for serve — start everything up.
    Up,
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

        Commands::Status { app } => {
            let status = manager.status(app).await?;
            println!("{status}");
        }

        Commands::Restart { app } => {
            manager.restart(app).await?;
        }

        Commands::Serve | Commands::Up => {
            let engine = Arc::new(build_engine().await?);

            // ── Management API — port 7777 ────────────────────────────────────
            let mgmt_app = api::routes::build(engine.clone());
            let mgmt_listener = tokio::net::TcpListener::bind("127.0.0.1:7777").await?;

            // ── Reverse proxy — port 9000 ─────────────────────────────────────
            let proxy = proxy::router::ProxyRouter::new(engine.clone())?;
            let proxy_listener = tokio::net::TcpListener::bind("0.0.0.0:9000").await?;

            println!("[pulse] management API  →  http://127.0.0.1:7777");
            println!("[pulse] reverse proxy   →  http://0.0.0.0:9000");

            // ── Background Idle Sweeper ───────────────────────────────────
            let engine_clone = engine.clone();
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
                loop {
                    interval.tick().await;
                    let apps = registry::loader::load_all(PathBuf::from("apps").as_path()).unwrap_or_default();
                    for app in apps {
                        if let Some(timeout) = app.parsed_idle_timeout() {
                            let raw_state = storage::database::get_state(engine_clone.pool(), &app.name).await.unwrap_or_default().unwrap_or_default();
                            if lifecycle::manager::normalize_status(&raw_state) == "running" {
                                if let Ok(Some(idle_duration)) = storage::database::get_idle_duration(engine_clone.pool(), &app.name).await {
                                    if idle_duration > timeout {
                                        println!("[pulse] App '{}' has been idle for {}s > timeout {}s. Stopping...", app.name, idle_duration.as_secs(), timeout.as_secs());
                                        let _ = engine_clone.stop(&app.name).await;
                                    }
                                }
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

async fn build_engine() -> anyhow::Result<LifeCycleManager> {
    Ok(LifeCycleManager::new().await?)
}
