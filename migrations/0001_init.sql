CREATE TABLE applications (
    name TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'stopped',
    last_started TEXT,
    last_activity TEXT,
    crash_count INTEGER NOT NULL DEFAULT 0
);