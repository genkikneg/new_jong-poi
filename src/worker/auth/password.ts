import { createSession, type AuthenticatedUser, type NewSession } from "./session";

const CHALLENGE_DURATION_MS = 5 * 60 * 1000;
const DUMMY_BCRYPT_SALT = "$2y$12$JongPoiDummySalt123456";

interface PasswordUserRow {
	id: string;
	password_hash: string | null;
}

interface PasswordChallengeRow {
	user_id: string;
	password_hash: string;
	public_user_id: string;
	display_name: string;
	avatar_updated_at_ms: number | null;
}

export class PasswordLoginError extends Error {}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function bcryptSalt(hash: string | null): string {
	if (!hash || !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) return DUMMY_BCRYPT_SALT;
	return hash.slice(0, 29);
}

export async function passwordProofForHash(passwordHash: string, challenge: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(passwordHash),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(challenge))));
}

export async function beginPasswordLogin(db: D1Database, userId: string, nowMs = Date.now()) {
	const normalized = userId.trim();
	if (!/^[A-Za-z0-9_.@+-]{3,255}$/.test(normalized)) throw new PasswordLoginError();

	const user = await db.prepare(
		`SELECT id, legacy_password_hash AS password_hash
		 FROM users
		 WHERE user_id = ?1 COLLATE NOCASE OR legacy_login_id = ?1 COLLATE NOCASE`,
	).bind(normalized).first<PasswordUserRow>();
	const challenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
	const challengeId = crypto.randomUUID();

	if (user?.password_hash) {
		await db.prepare(
			`INSERT INTO password_login_challenges
			 (id, user_id, challenge, created_at_ms, expires_at_ms)
			 VALUES (?1, ?2, ?3, ?4, ?5)`,
		).bind(challengeId, user.id, challenge, nowMs, nowMs + CHALLENGE_DURATION_MS).run();
	}

	return {
		challengeId,
		challenge,
		salt: bcryptSalt(user?.password_hash ?? null),
	};
}

export async function completePasswordLogin(
	db: D1Database,
	challengeId: string,
	proof: string,
	nowMs = Date.now(),
): Promise<{ user: AuthenticatedUser; session: NewSession }> {
	if (!challengeId || !/^[A-Za-z0-9_-]{43}$/.test(proof)) throw new PasswordLoginError();

	const row = await db.prepare(
		`SELECT c.user_id, u.legacy_password_hash AS password_hash,
		        u.user_id AS public_user_id, u.display_name,
		        avatar.updated_at_ms AS avatar_updated_at_ms,
		        c.challenge
		 FROM password_login_challenges AS c
		 INNER JOIN users AS u ON u.id = c.user_id
		 LEFT JOIN user_avatars AS avatar ON avatar.user_id = u.id
		 WHERE c.id = ?1 AND c.used_at_ms IS NULL AND c.expires_at_ms > ?2`,
	).bind(challengeId, nowMs).first<PasswordChallengeRow & { challenge: string }>();
	if (!row?.password_hash) throw new PasswordLoginError();

	const consumed = await db.prepare(
		"UPDATE password_login_challenges SET used_at_ms = ?2 WHERE id = ?1 AND used_at_ms IS NULL",
	).bind(challengeId, nowMs).run();
	if (!consumed.meta.changes) throw new PasswordLoginError();

	const expected = await passwordProofForHash(row.password_hash, row.challenge);
	const receivedBytes = new TextEncoder().encode(proof);
	const expectedBytes = new TextEncoder().encode(expected);
	if (receivedBytes.length !== expectedBytes.length || !crypto.subtle.timingSafeEqual(receivedBytes, expectedBytes)) {
		throw new PasswordLoginError();
	}

	return {
		user: {
			id: row.user_id,
			userId: row.public_user_id,
			displayName: row.display_name,
			avatarUpdatedAtMs: row.avatar_updated_at_ms,
		},
		session: await createSession(db, row.user_id, nowMs),
	};
}
