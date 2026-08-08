pub mod compose_runtime;

use anyhow::Result;
use async_trait::async_trait;

#[async_trait]
pub trait Runtime {
    async fn start(&self, compose_file: &str) -> Result<()>;
    async fn stop(&self, compose_file: &str) -> Result<()>;
    async fn restart(&self, compose_file: &str) -> Result<()>;
    async fn status(&self, compose_file: &str) -> Result<String>;
}
