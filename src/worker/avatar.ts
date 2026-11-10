export const AVATAR_MAX_BYTES = 256 * 1024;

export type AvatarContentType = "image/png" | "image/webp";

export interface StoredAvatar {
	contentType: AvatarContentType;
	bytes: Uint8Array;
	updatedAtMs: number;
}

interface AvatarRow {
	content_type: string;
	bytes: number[] | ArrayBuffer | Uint8Array;
	updated_at_ms: number;
}

export class AvatarInputError extends Error {
	constructor(readonly code: "UNSUPPORTED_TYPE" | "EMPTY_FILE" | "FILE_TOO_LARGE" | "INVALID_IMAGE") {
		super(code);
		this.name = "AvatarInputError";
	}
}

function isPng(bytes: Uint8Array): boolean {
	const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function isWebp(bytes: Uint8Array): boolean {
	return bytes.length >= 12 &&
		String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
		String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

export function validateAvatar(contentType: string, bytes: Uint8Array): AvatarContentType {
	if (contentType !== "image/png" && contentType !== "image/webp") {
		throw new AvatarInputError("UNSUPPORTED_TYPE");
	}
	if (bytes.length === 0) throw new AvatarInputError("EMPTY_FILE");
	if (bytes.length > AVATAR_MAX_BYTES) throw new AvatarInputError("FILE_TOO_LARGE");
	if ((contentType === "image/png" && !isPng(bytes)) || (contentType === "image/webp" && !isWebp(bytes))) {
		throw new AvatarInputError("INVALID_IMAGE");
	}
	return contentType;
}

export async function readAvatarBody(request: Request): Promise<Uint8Array> {
	const declaredLength = Number(request.headers.get("Content-Length"));
	if (Number.isFinite(declaredLength) && declaredLength > AVATAR_MAX_BYTES) {
		throw new AvatarInputError("FILE_TOO_LARGE");
	}
	if (!request.body) throw new AvatarInputError("EMPTY_FILE");

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		totalBytes += value.byteLength;
		if (totalBytes > AVATAR_MAX_BYTES) {
			await reader.cancel();
			throw new AvatarInputError("FILE_TOO_LARGE");
		}
		chunks.push(value);
	}

	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export async function saveAvatar(
	db: D1Database,
	userId: string,
	contentType: string,
	bytes: Uint8Array,
	nowMs = Date.now(),
): Promise<number> {
	const validatedType = validateAvatar(contentType, bytes);
	await db.prepare(
		`INSERT INTO user_avatars (user_id, content_type, bytes, updated_at_ms)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET
			content_type = excluded.content_type,
			bytes = excluded.bytes,
			updated_at_ms = excluded.updated_at_ms`,
	).bind(userId, validatedType, bytes, nowMs).run();
	return nowMs;
}

export async function getAvatar(db: D1Database, userId: string): Promise<StoredAvatar | null> {
	const row = await db.prepare(
		"SELECT content_type, bytes, updated_at_ms FROM user_avatars WHERE user_id = ? LIMIT 1",
	).bind(userId).first<AvatarRow>();
	if (!row || (row.content_type !== "image/png" && row.content_type !== "image/webp")) return null;

	const bytes = row.bytes instanceof Uint8Array
		? row.bytes
		: row.bytes instanceof ArrayBuffer
			? new Uint8Array(row.bytes)
			: Uint8Array.from(row.bytes);
	return { contentType: row.content_type, bytes, updatedAtMs: row.updated_at_ms };
}

export async function deleteAvatar(db: D1Database, userId: string): Promise<void> {
	await db.prepare("DELETE FROM user_avatars WHERE user_id = ?").bind(userId).run();
}
