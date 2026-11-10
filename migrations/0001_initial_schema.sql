-- Initial D1 schema for Jong-Poi Next.
-- All timestamps are Unix milliseconds in UTC. Score and point values are integers.

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    CHECK (length(user_id) BETWEEN 3 AND 32),
    CHECK (length(display_name) BETWEEN 1 AND 80)
);

CREATE TABLE user_avatars (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/webp')),
    bytes BLOB NOT NULL CHECK (length(bytes) <= 262144),
    updated_at_ms INTEGER NOT NULL
);

CREATE TABLE webauthn_credentials (
    credential_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key BLOB NOT NULL,
    sign_count INTEGER NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
    transports_json TEXT NOT NULL DEFAULT '[]',
    created_at_ms INTEGER NOT NULL,
    last_used_at_ms INTEGER
);

CREATE INDEX webauthn_credentials_user_id_idx ON webauthn_credentials(user_id);

CREATE TABLE auth_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_digest BLOB NOT NULL UNIQUE,
    expires_at_ms INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    last_seen_at_ms INTEGER NOT NULL
);

CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions(expires_at_ms);

CREATE TABLE auth_recovery_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_digest BLOB NOT NULL UNIQUE,
    created_at_ms INTEGER NOT NULL,
    used_at_ms INTEGER
);

CREATE INDEX auth_recovery_codes_user_id_idx ON auth_recovery_codes(user_id);

CREATE TABLE friendships (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (user_id, friend_id),
    CHECK (user_id < friend_id)
);

CREATE TABLE friend_requests (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    responded_at_ms INTEGER,
    CHECK (sender_id <> recipient_id)
);

CREATE INDEX friend_requests_recipient_idx ON friend_requests(recipient_id, responded_at_ms, created_at_ms);
CREATE UNIQUE INDEX friend_requests_pending_pair_idx
    ON friend_requests(sender_id, recipient_id)
    WHERE responded_at_ms IS NULL;

CREATE TABLE game_sessions (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    name TEXT,
    join_code TEXT NOT NULL COLLATE NOCASE UNIQUE,
    player_count INTEGER NOT NULL CHECK (player_count IN (3, 4)),
    status TEXT NOT NULL CHECK (status IN ('open', 'active', 'closed')),
    rules_json TEXT NOT NULL,
    state_version INTEGER NOT NULL DEFAULT 0 CHECK (state_version >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    closed_at_ms INTEGER,
    CHECK (length(join_code) BETWEEN 6 AND 12)
);

CREATE INDEX game_sessions_owner_idx ON game_sessions(owner_user_id, created_at_ms DESC);
CREATE INDEX game_sessions_status_idx ON game_sessions(status, updated_at_ms DESC);

CREATE TABLE session_members (
    session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    seat_index INTEGER,
    joined_at_ms INTEGER NOT NULL,
    PRIMARY KEY (session_id, user_id),
    UNIQUE (session_id, seat_index),
    CHECK (seat_index IS NULL OR seat_index BETWEEN 0 AND 3)
);

CREATE INDEX session_members_user_idx ON session_members(user_id, joined_at_ms DESC);

CREATE TABLE games (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK (ordinal > 0),
    recorded_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    played_at_ms INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    UNIQUE (session_id, ordinal)
);

CREATE INDEX games_session_idx ON games(session_id, ordinal);

CREATE TABLE game_results (
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    final_score INTEGER NOT NULL,
    rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 4),
    score_difference INTEGER NOT NULL,
    score_points_milli INTEGER NOT NULL,
    rank_bonus_milli INTEGER NOT NULL,
    points_milli INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    PRIMARY KEY (game_id, user_id)
);

CREATE INDEX game_results_user_idx ON game_results(user_id, created_at_ms DESC);

CREATE TABLE player_rankings (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    period TEXT NOT NULL CHECK (period IN ('all', 'weekly', 'monthly', 'yearly')),
    period_start_ms INTEGER NOT NULL,
    games_played INTEGER NOT NULL DEFAULT 0 CHECK (games_played >= 0),
    total_points_milli INTEGER NOT NULL DEFAULT 0,
    top_finishes INTEGER NOT NULL DEFAULT 0 CHECK (top_finishes >= 0),
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (user_id, period, period_start_ms)
);

CREATE INDEX player_rankings_period_idx
    ON player_rankings(period, period_start_ms, total_points_milli DESC);

CREATE TABLE idempotency_keys (
    key TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL
);

CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys(expires_at_ms);
