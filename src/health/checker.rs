use anyhow::{Result, bail};

pub async fn is_healthy(url: &str) -> bool {
    match reqwest::get(url).await {
        Ok(response) => response.status().is_success(),
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

    bail!(
        "Timeout reached while waiting for {} to become healthy",
        url
    );
}
