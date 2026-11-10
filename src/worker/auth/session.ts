export const SESSION_COOKIE_NAME = "jong_poi_session";
export const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30;

export interface AuthenticatedUser {
	id: string;
	userId: string;
	displayName: string;
	avatarUpdatedAtMs?: number | null;
}

export interface AuthenticatedSession {
	id: string;
	user: AuthenticatedUser;
}

interface AuthenticatedSessionRow {
	session_id: string;
	user_id: string;
	public_user_id: string;
	display_name: string;
	avatar_updated_at_ms: number | null;
}

export interface NewSession {
	id: string;
	token: string;
	expiresAtMs: number;
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function hashSessionToken(token: string): Promise<ArrayBuffer> {
	return crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
}

export function readSessionToken(cookieHeader: string | null): string | null {
	if (!cookieHeader) {
		return null;
	}

	for (const cookie of cookieHeader.split(";")) {
		const [name, ...valueParts] = cookie.trim().split("=");
		if (name === SESSION_COOKIE_NAME && valueParts.length === 1) {
			return valueParts[0] || null;
		}
	}

	return null;
}

export function buildSessionCookie(token: string, expiresAtMs: number): string {
	const maxAgeSeconds = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
	return [
		`${SESSION_COOKIE_NAME}=${token}`,
		`Max-Age=${maxAgeSeconds}`,
		"Path=/",
		"HttpOnly",
		"Secure",
		"SameSite=Lax",
	].join("; ");
}

export function buildExpiredSessionCookie(): string {
	return [
		`${SESSION_COOKIE_NAME}=`,
		"Max-Age=0",
		"Path=/",
		"HttpOnly",
		"Secure",
		"SameSite=Lax",
	].join("; ");
}

export async function createSession(
	db: D1Database,
	userId: string,
	nowMs = Date.now(),
): Promise<NewSession> {
	const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
	const token = bytesToBase64Url(tokenBytes);
	const id = crypto.randomUUID();
	const expiresAtMs = nowMs + SESSION_DURATION_MS;

	await db
		.prepare(
			`INSERT INTO auth_sessions
				(id, user_id, token_digest, expires_at_ms, created_at_ms, last_seen_at_ms)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
		)
		.bind(
			id,
			userId,
			await hashSessionToken(token),
			expiresAtMs,
			nowMs,
		)
		.run();

	return { id, token, expiresAtMs };
}

export async function findAuthenticatedSession(
	db: D1Database,
	token: string,
	nowMs = Date.now(),
): Promise<AuthenticatedSession | null> {
	const row = await db
		.prepare(
			`SELECT
				s.id AS session_id,
				u.id AS user_id,
				u.user_id AS public_user_id,
				u.display_name,
				avatar.updated_at_ms AS avatar_updated_at_ms
			 FROM auth_sessions AS s
			 INNER JOIN users AS u ON u.id = s.user_id
			 LEFT JOIN user_avatars AS avatar ON avatar.user_id = u.id
			 WHERE s.token_digest = ?1 AND s.expires_at_ms > ?2`,
		)
		.bind(await hashSessionToken(token), nowMs)
		.first<AuthenticatedSessionRow>();

	if (!row) {
		return null;
	}

	return {
		id: row.session_id,
		user: {
			id: row.user_id,
			userId: row.public_user_id,
			displayName: row.display_name,
			avatarUpdatedAtMs: row.avatar_updated_at_ms,
		},
	};
}

export async function findAuthenticatedSessionFromRequest(
	db: D1Database,
	request: Request,
	nowMs = Date.now(),
): Promise<AuthenticatedSession | null> {
	const token = readSessionToken(request.headers.get("Cookie"));
	return token ? findAuthenticatedSession(db, token, nowMs) : null;
}

export async function revokeSession(db: D1Database, token: string): Promise<void> {
	await db
		.prepare("DELETE FROM auth_sessions WHERE token_digest = ?1")
		.bind(await hashSessionToken(token))
		.run();
}
