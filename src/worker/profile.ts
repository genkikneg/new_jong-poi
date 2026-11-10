import type { AuthenticatedUser } from "./auth/session";

interface ProfileRow {
	id: string;
	user_id: string;
	display_name: string;
	avatar_updated_at_ms: number | null;
}

export class ProfileInputError extends Error {
	constructor(readonly code: "INVALID_DISPLAY_NAME" | "USER_ID_IMMUTABLE") {
		super(code);
		this.name = "ProfileInputError";
	}
}

function normaliseDisplayName(value: unknown): string {
	if (typeof value !== "string") throw new ProfileInputError("INVALID_DISPLAY_NAME");
	const normalized = value.trim();
	if (normalized.length < 1 || normalized.length > 80) throw new ProfileInputError("INVALID_DISPLAY_NAME");
	return normalized;
}

export async function updateProfile(
	db: D1Database,
	userId: string,
	input: { displayName?: unknown; userId?: unknown },
	nowMs = Date.now(),
): Promise<AuthenticatedUser> {
	const displayName = normaliseDisplayName(input.displayName);
	if (input.userId !== undefined) throw new ProfileInputError("USER_ID_IMMUTABLE");

	await db.prepare(
		"UPDATE users SET display_name = ?, updated_at_ms = ? WHERE id = ?",
	).bind(displayName, nowMs, userId).run();
	const row = await db.prepare(
		`SELECT user.id, user.user_id, user.display_name, avatar.updated_at_ms AS avatar_updated_at_ms
		 FROM users AS user LEFT JOIN user_avatars AS avatar ON avatar.user_id = user.id
		 WHERE user.id = ? LIMIT 1`,
	).bind(userId).first<ProfileRow>();
	if (!row) throw new Error("Profile user disappeared.");
	return { id: row.id, userId: row.user_id, displayName: row.display_name, avatarUpdatedAtMs: row.avatar_updated_at_ms };
}
