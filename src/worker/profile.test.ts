import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ProfileInputError, updateProfile } from "./profile";

function database(sqlite: DatabaseSync): D1Database {
	return { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({
		first: async () => sqlite.prepare(sql).get(...values),
		run: async () => { sqlite.prepare(sql).run(...values); return { meta: { changes: 1 } }; },
	}) }) } as unknown as D1Database;
}

describe("updateProfile", () => {
	it("updates the display name while keeping the user ID", async () => {
		const sqlite = new DatabaseSync(":memory:");
		sqlite.exec(readFileSync(new URL("../../migrations/0001_initial_schema.sql", import.meta.url), "utf8"));
		sqlite.prepare("INSERT INTO users (id, user_id, display_name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)").run("a", "before", "以前", 1, 1);
		await expect(updateProfile(database(sqlite), "a", { displayName: " 更新後 " }, 100)).resolves.toEqual({ id: "a", userId: "before", displayName: "更新後", avatarUpdatedAtMs: null });
		sqlite.close();
	});

	it("rejects attempts to change the user ID", async () => {
		const sqlite = new DatabaseSync(":memory:");
		sqlite.exec(readFileSync(new URL("../../migrations/0001_initial_schema.sql", import.meta.url), "utf8"));
		for (const id of ["a", "b"]) sqlite.prepare("INSERT INTO users (id, user_id, display_name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)").run(id, `user_${id}`, id, 1, 1);
		await expect(updateProfile(database(sqlite), "a", { userId: "new_id", displayName: "名前" })).rejects.toEqual(expect.objectContaining<Partial<ProfileInputError>>({ code: "USER_ID_IMMUTABLE" }));
		expect(sqlite.prepare("SELECT user_id FROM users WHERE id = 'a'").get()).toMatchObject({ user_id: "user_a" });
		sqlite.close();
	});
});
