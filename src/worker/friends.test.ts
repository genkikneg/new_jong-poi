import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { acceptFriendRequest, getFriend, getUserDetail, listFriends, sendFriendRequest } from "./friends";

type Bound = { sql: string; values: unknown[] };
function database(sqlite: DatabaseSync): D1Database {
	const bind = (sql: string, values: unknown[]) => ({
		__sql: sql, __values: values,
		first: async () => sqlite.prepare(sql).get(...values),
		all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
		run: async () => { const result = sqlite.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
	});
	return {
		prepare: (sql: string) => ({ bind: (...values: unknown[]) => bind(sql, values) }),
		batch: async (statements: unknown[]) => statements.map((statement) => { const bound = statement as Bound; if (!bound.__sql) throw new Error(JSON.stringify(statement)); const result = sqlite.prepare(bound.__sql).run(...bound.__values); return { meta: { changes: Number(result.changes) } }; }),
	} as unknown as D1Database;
}

describe("friends", () => {
	it("sends, accepts, and lists a friend request", async () => {
		const sqlite = new DatabaseSync(":memory:");
		sqlite.exec(readFileSync(new URL("../../migrations/0001_initial_schema.sql", import.meta.url), "utf8"));
		sqlite.prepare("INSERT INTO users (id, user_id, display_name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)").run("a-user", "alice", "Alice", 1, 1);
		sqlite.prepare("INSERT INTO users (id, user_id, display_name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)").run("b-user", "bob", "Bob", 1, 1);
		const db = database(sqlite);
		await expect(getUserDetail(db, "a-user", "b-user")).resolves.toMatchObject({ relation: "none", user: { userId: "bob" } });
		await expect(getFriend(db, "a-user", "b-user")).resolves.toBeNull();
		await sendFriendRequest(db, "a-user", "bob", 100);
		await expect(getUserDetail(db, "a-user", "b-user")).resolves.toMatchObject({ relation: "pending_outgoing" });
		await expect(getUserDetail(db, "b-user", "a-user")).resolves.toMatchObject({ relation: "pending_incoming" });
		const pending = await listFriends(db, "b-user");
		expect(pending.incoming).toHaveLength(1);
		await acceptFriendRequest(db, "b-user", pending.incoming[0].id, 200);
		await expect(listFriends(db, "a-user")).resolves.toMatchObject({ friends: [{ id: "b-user", userId: "bob", displayName: "Bob", totalPointsMilli: 0 }], incoming: [], outgoing: [] });
		await expect(getFriend(db, "a-user", "b-user")).resolves.toMatchObject({ id: "b-user", userId: "bob", displayName: "Bob", totalPointsMilli: 0 });
		await expect(getUserDetail(db, "a-user", "b-user")).resolves.toMatchObject({ relation: "friend" });
		sqlite.prepare("INSERT INTO game_sessions (id, owner_user_id, join_code, player_count, status, rules_json, created_at_ms, updated_at_ms) VALUES ('open-session', 'a-user', 'ABCDEFGH', 4, 'active', '{}', 1, 1)").run();
		sqlite.prepare("INSERT INTO games (id, session_id, ordinal, recorded_by_user_id, played_at_ms, created_at_ms) VALUES ('open-game', 'open-session', 1, 'a-user', 2, 2)").run();
		sqlite.prepare("INSERT INTO game_results (game_id, user_id, final_score, rank, score_difference, score_points_milli, rank_bonus_milli, points_milli, created_at_ms) VALUES ('open-game', 'b-user', 28000, 2, 0, 0, 0, 3000, 2)").run();
		await expect(getUserDetail(db, "a-user", "b-user")).resolves.toMatchObject({ user: { totalPointsMilli: 3000 } });
		sqlite.close();
	});
});
