export const WEBAUTHN_CHALLENGE_TTL_MS = 1000 * 60 * 5;

export type WebAuthnCeremony = "registration" | "authentication";

export interface NewWebAuthnChallenge {
	ceremony: WebAuthnCeremony;
	challenge: string;
	userId: string;
	userName: string;
	displayName: string;
}

export interface StoredWebAuthnChallenge extends NewWebAuthnChallenge {
	id: string;
	createdAtMs: number;
	expiresAtMs: number;
}

interface WebAuthnChallengeRow {
	id: string;
	ceremony: WebAuthnCeremony;
	challenge: string;
	user_id: string;
	user_name: string;
	display_name: string;
	created_at_ms: number;
	expires_at_ms: number;
}

export async function createWebAuthnChallenge(
	db: D1Database,
	input: NewWebAuthnChallenge,
	nowMs = Date.now(),
): Promise<StoredWebAuthnChallenge> {
	const challenge: StoredWebAuthnChallenge = {
		...input,
		id: crypto.randomUUID(),
		createdAtMs: nowMs,
		expiresAtMs: nowMs + WEBAUTHN_CHALLENGE_TTL_MS,
	};

	await db
		.prepare(
			`INSERT INTO webauthn_challenges
				(id, ceremony, challenge, user_id, user_name, display_name, created_at_ms, expires_at_ms)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
		)
		.bind(
			challenge.id,
			challenge.ceremony,
			challenge.challenge,
			challenge.userId,
			challenge.userName,
			challenge.displayName,
			challenge.createdAtMs,
			challenge.expiresAtMs,
		)
		.run();

	return challenge;
}

export async function findActiveWebAuthnChallenge(
	db: D1Database,
	id: string,
	ceremony: WebAuthnCeremony,
	nowMs = Date.now(),
): Promise<StoredWebAuthnChallenge | null> {
	const row = await db
		.prepare(
			`SELECT id, ceremony, challenge, user_id, user_name, display_name, created_at_ms, expires_at_ms
			 FROM webauthn_challenges
			 WHERE id = ?1 AND ceremony = ?2 AND used_at_ms IS NULL AND expires_at_ms > ?3`,
		)
		.bind(id, ceremony, nowMs)
		.first<WebAuthnChallengeRow>();

	if (!row) {
		return null;
	}

	return {
		id: row.id,
		ceremony: row.ceremony,
		challenge: row.challenge,
		userId: row.user_id,
		userName: row.user_name,
		displayName: row.display_name,
		createdAtMs: row.created_at_ms,
		expiresAtMs: row.expires_at_ms,
	};
}
