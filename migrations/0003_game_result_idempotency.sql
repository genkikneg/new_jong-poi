-- Stores the canonical successful response for a game-result command.
-- This lets a client safely retry a request after a network interruption.

ALTER TABLE idempotency_keys ADD COLUMN request_fingerprint TEXT;
ALTER TABLE idempotency_keys ADD COLUMN result_json TEXT;
