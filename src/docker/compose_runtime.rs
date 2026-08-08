use super::Runtime;
use anyhow::{Result, bail};
use async_trait::async_trait;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

pub struct DockerComposeRuntime;

#[async_trait]
impl Runtime for DockerComposeRuntime {
    async fn start(&self, compose_path: &str) -> Result<()> {
        run(&["compose", "-f", compose_path, "up", "-d", "--wait"]).await
    }

    async fn stop(&self, compose_path: &str) -> Result<()> {
        run(&["compose", "-f", compose_path, "down"]).await
    }

    async fn restart(&self, compose_path: &str) -> Result<()> {
        self.stop(compose_path).await?;
        self.start(compose_path).await
    }

    async fn status(&self, compose_path: &str) -> Result<String> {
        let cmd_future = Command::new("docker")
            .args(["compose", "-f", compose_path, "ps", "--format", "json"])
            .output();
        
        let output = match timeout(Duration::from_secs(60), cmd_future).await {
            Ok(Ok(out)) => out,
            Ok(Err(e)) => bail!("docker ps failed to execute: {}", e),
            Err(_) => bail!("docker ps timed out after 60 seconds"),
        };

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}

async fn run(args: &[&str]) -> Result<()> {
    let cmd_future = Command::new("docker").args(args).status();
    
    let status = match timeout(Duration::from_secs(120), cmd_future).await {
        Ok(Ok(st)) => st,
        Ok(Err(e)) => bail!("docker {:?} failed to execute: {}", args, e),
        Err(_) => bail!("docker {:?} timed out after 120 seconds", args),
    };

    if !status.success() {
        bail!("docker {:?} failed with {}", args, status);
    }
    Ok(())
}
