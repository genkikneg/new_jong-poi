-- Compatibility login for users migrated from the Laravel application.
-- The bcrypt hash is copied as-is; plaintext passwords are never stored.
ALTER TABLE users ADD COLUMN legacy_password_hash TEXT;

CREATE TABLE password_login_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL UNIQUE,
    created_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    used_at_ms INTEGER,
    CHECK (expires_at_ms > created_at_ms)
);

CREATE INDEX password_login_challenges_expiry_idx
    ON password_login_challenges(expires_at_ms);
