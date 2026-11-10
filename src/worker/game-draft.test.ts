import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { GameDraftError, listGameDraft, saveGameDraft } from "./game-draft";

describe("game draft", () => {
	it("lets a member submit and change only their own score", async () => {
		const sqlite = new DatabaseSync(":memory:");
		sqlite.exec(readFileSync(new URL("../../migrations/0001_initial_schema.sql", import.meta.url), "utf8"));
		sqlite.exec(readFileSync(new URL("../../migrations/0004_game_draft_entries.sql", import.meta.url), "utf8"));
		for (const id of ["owner", "friend", "outsider"]) sqlite.prepare("INSERT INTO users (id, user_id, display_name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, 1, 1)").run(id, id, id);
		sqlite.prepare("INSERT INTO game_sessions (id, owner_user_id, join_code, player_count, status, rules_json, created_at_ms, updated_at_ms) VALUES ('session', 'owner', 'ABCDEFGH', 3, 'active', '{}', 1, 1)").run();
		for (const [index, id] of ["owner", "friend"].entries()) sqlite.prepare("INSERT INTO session_members (session_id, user_id, seat_index, joined_at_ms) VALUES ('session', ?, ?, 1)").run(id, index);
		const db = { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({
			first: async () => sqlite.prepare(sql).get(...values),
			all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
			run: async () => sqlite.prepare(sql).run(...values),
		}) }) } as unknown as D1Database;
		await saveGameDraft(db, "session", "owner", 40000, 1);
		await saveGameDraft(db, "session", "owner", 42000, null);
		await expect(listGameDraft(db, "session", "friend")).resolves.toEqual([{ userId: "owner", finalScore: 42000, rank: null }]);
		await expect(saveGameDraft(db, "session", "outsider", 30000, null)).rejects.toMatchObject<Partial<GameDraftError>>({ code: "NOT_A_MEMBER" });
		sqlite.close();
	});
});
