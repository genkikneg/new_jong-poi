-- One-time WebAuthn challenges for registration and authentication ceremonies.
CREATE TABLE webauthn_challenges (
    id TEXT PRIMARY KEY,
    ceremony TEXT NOT NULL CHECK (ceremony IN ('registration', 'authentication')),
    challenge TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL COLLATE NOCASE,
    display_name TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    used_at_ms INTEGER,
    CHECK (expires_at_ms > created_at_ms)
);

CREATE INDEX webauthn_challenges_expiry_idx ON webauthn_challenges(expires_at_ms);
