-- Keep the old email address private while it is temporarily needed for login.
ALTER TABLE users ADD COLUMN legacy_login_id TEXT COLLATE NOCASE;

CREATE UNIQUE INDEX users_legacy_login_id_unique
    ON users(legacy_login_id)
    WHERE legacy_login_id IS NOT NULL;

-- Protect email-shaped public IDs that were imported before this migration.
UPDATE users
SET legacy_login_id = user_id,
    user_id = 'legacy_' || lower(hex(randomblob(6)))
WHERE instr(user_id, '@') > 1;
