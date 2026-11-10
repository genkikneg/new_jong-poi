CREATE TABLE game_draft_entries (
    session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    final_score INTEGER NOT NULL,
    rank INTEGER,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (session_id, user_id)
);
