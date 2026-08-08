use sqlx::SqlitePool;

pub async fn init_db(pool: &SqlitePool) -> std::result::Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS applications (
            name TEXT PRIMARY KEY,
            state TEXT NOT NULL DEFAULT 'stopped',
            last_started TEXT,
            last_activity TEXT,
            crash_count INTEGER NOT NULL DEFAULT 0
        )",
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn ensure_app_record(
    pool: &SqlitePool,
    name: &str,
) -> std::result::Result<(), sqlx::Error> {
    sqlx::query("INSERT OR IGNORE INTO applications (name, state) VALUES (?, 'stopped')")
        .bind(name)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_state(
    pool: &SqlitePool,
    name: &str,
) -> std::result::Result<Option<String>, sqlx::Error> {
    let state = sqlx::query_scalar("SELECT state FROM applications WHERE name = ?")
        .bind(name)
        .fetch_optional(pool)
        .await?;
    Ok(state)
}

pub async fn set_state(
    pool: &SqlitePool,
    name: &str,
    state: &str,
) -> std::result::Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE applications SET state = ?, last_activity = datetime('now') WHERE name = ?",
    )
    .bind(state)
    .bind(name)
    .execute(pool)
    .await?;
    Ok(())
}

/// Update only `last_activity` without changing state.
/// Called by the proxy on every forwarded request to drive Phase 10 idle detection.
pub async fn update_last_activity(
    pool: &SqlitePool,
    name: &str,
) -> std::result::Result<(), sqlx::Error> {
    sqlx::query("UPDATE applications SET last_activity = datetime('now') WHERE name = ?")
        .bind(name)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_idle_duration(
    pool: &SqlitePool,
    name: &str,
) -> std::result::Result<Option<std::time::Duration>, sqlx::Error> {
    // Julian day * 86400 gives seconds.
    // If last_activity is NULL, this returns NULL.
    let diff_seconds: Option<f64> = sqlx::query_scalar(
        "SELECT (julianday('now') - julianday(last_activity)) * 86400.0 FROM applications WHERE name = ?"
    )
    .bind(name)
    .fetch_optional(pool)
    .await?
    .flatten();

    Ok(diff_seconds.map(|secs| std::time::Duration::from_secs_f64(secs)))
}
