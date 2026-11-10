import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
	AVATAR_MAX_BYTES,
	AvatarInputError,
	deleteAvatar,
	getAvatar,
	readAvatarBody,
	saveAvatar,
	validateAvatar,
} from "./avatar";

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP_BYTES = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

function sqliteDatabase(sqlite: DatabaseSync): D1Database {
	return {
		prepare: (sql: string) => ({
			bind: (...values: unknown[]) => ({
				first: async () => sqlite.prepare(sql).get(...values),
				run: async () => {
					sqlite.prepare(sql).run(...values);
					return { success: true };
				},
			}),
		}),
	} as unknown as D1Database;
}

describe("validateAvatar", () => {
	it("accepts PNG and WebP signatures", () => {
		expect(validateAvatar("image/png", PNG_BYTES)).toBe("image/png");
		expect(validateAvatar("image/webp", WEBP_BYTES)).toBe("image/webp");
	});

	it("rejects MIME spoofing and files over the application limit", () => {
		expect(() => validateAvatar("image/png", WEBP_BYTES)).toThrowError(AvatarInputError);
		expect(() => validateAvatar("image/jpeg", PNG_BYTES)).toThrowError(AvatarInputError);
		expect(() => validateAvatar("image/png", new Uint8Array(AVATAR_MAX_BYTES + 1))).toThrowError(AvatarInputError);
	});

	it("stops reading a streamed body after the size limit", async () => {
		const request = new Request("https://example.test/api/me/avatar", {
			method: "PUT",
			body: new Uint8Array(AVATAR_MAX_BYTES + 1),
		});
		await expect(readAvatarBody(request)).rejects.toEqual(
			expect.objectContaining({ code: "FILE_TOO_LARGE" }),
		);
	});
});

describe("avatar persistence", () => {
	it("inserts, replaces, reads, and deletes a user's avatar", async () => {
		const sqlite = new DatabaseSync(":memory:");
		sqlite.exec(readFileSync(new URL("../../migrations/0001_initial_schema.sql", import.meta.url), "utf8"));
		sqlite.prepare("INSERT INTO users (id, user_id, display_name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)")
			.run("user-1", "tester", "テスト", 1, 1);
		const db = sqliteDatabase(sqlite);

		await saveAvatar(db, "user-1", "image/png", PNG_BYTES, 100);
		await expect(getAvatar(db, "user-1")).resolves.toEqual({
			contentType: "image/png",
			bytes: PNG_BYTES,
			updatedAtMs: 100,
		});
		await saveAvatar(db, "user-1", "image/webp", WEBP_BYTES, 200);
		await expect(getAvatar(db, "user-1")).resolves.toEqual({
			contentType: "image/webp",
			bytes: WEBP_BYTES,
			updatedAtMs: 200,
		});
		await deleteAvatar(db, "user-1");
		await expect(getAvatar(db, "user-1")).resolves.toBeNull();
		sqlite.close();
	});
});
