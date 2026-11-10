import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { getPlayerStats } from "./stats";

describe("getPlayerStats", () => {
	it("keeps the cumulative total when the chart shows only the latest 50 games", async () => {
		const sqlite = new DatabaseSync(":memory:");
		sqlite.exec(readFileSync(new URL("../../migrations/0001_initial_schema.sql", import.meta.url), "utf8"));
		sqlite.prepare("INSERT INTO users (id, user_id, display_name, created_at_ms, updated_at_ms) VALUES ('user-1', 'tester', 'テスト', 1, 1)").run();
		sqlite.prepare("INSERT INTO game_sessions (id, owner_user_id, join_code, player_count, status, rules_json, created_at_ms, updated_at_ms, closed_at_ms) VALUES ('session-1', 'user-1', 'ABCDEFGH', 4, 'closed', '{}', 1, 1, 100)").run();
		const insertGame = sqlite.prepare("INSERT INTO games (id, session_id, ordinal, recorded_by_user_id, played_at_ms, created_at_ms) VALUES (?, 'session-1', ?, 'user-1', ?, ?)");
		const insertResult = sqlite.prepare("INSERT INTO game_results (game_id, user_id, final_score, rank, score_difference, score_points_milli, rank_bonus_milli, points_milli, created_at_ms) VALUES (?, 'user-1', 30000, 1, 0, 0, 0, 1000, ?)");
		for (let ordinal = 1; ordinal <= 51; ordinal++) {
			insertGame.run(`game-${ordinal}`, ordinal, ordinal, ordinal);
			insertResult.run(`game-${ordinal}`, ordinal);
		}
		const db = { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ all: async () => ({ results: sqlite.prepare(sql).all(...values) }) }) }) } as unknown as D1Database;
		const stats = await getPlayerStats(db, "user-1", "all", 100);
		expect(stats.summary.totalPointsMilli).toBe(51_000);
		expect(stats.trend).toHaveLength(50);
		expect(stats.trend[0].cumulativePointsMilli).toBe(2_000);
		expect(stats.trend.at(-1)?.cumulativePointsMilli).toBe(51_000);
		sqlite.close();
	});
	it("summarizes only games in closed sessions", async () => {
		const sqlite = new DatabaseSync(":memory:");
		sqlite.exec(readFileSync(new URL("../../migrations/0001_initial_schema.sql", import.meta.url), "utf8"));
		sqlite.prepare("INSERT INTO users (id, user_id, display_name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)").run("user-1", "tester", "テスト", 1, 1);
		sqlite.prepare("INSERT INTO game_sessions (id, owner_user_id, name, join_code, player_count, status, rules_json, created_at_ms, updated_at_ms, closed_at_ms) VALUES (?, ?, ?, ?, 4, 'closed', '{}', ?, ?, ?)").run("session-1", "user-1", "卓", "ABCDEFGH", 1, 1, 10);
		for (const [ordinal, rank, points] of [[1, 1, 25000], [2, 4, -15000]] as const) {
			const gameId = `game-${ordinal}`;
			sqlite.prepare("INSERT INTO games (id, session_id, ordinal, recorded_by_user_id, played_at_ms, created_at_ms) VALUES (?, ?, ?, 'user-1', ?, ?)").run(gameId, "session-1", ordinal, ordinal, ordinal);
			sqlite.prepare("INSERT INTO game_results (game_id, user_id, final_score, rank, score_difference, score_points_milli, rank_bonus_milli, points_milli, created_at_ms) VALUES (?, 'user-1', 30000, ?, 0, 0, 0, ?, ?)").run(gameId, rank, points, ordinal);
		}
		sqlite.prepare("INSERT INTO game_sessions (id, owner_user_id, name, join_code, player_count, status, rules_json, created_at_ms, updated_at_ms) VALUES ('session-open', 'user-1', '進行中', 'HJKLMNPQ', 4, 'active', '{}', 1, 1)").run();
		sqlite.prepare("INSERT INTO games (id, session_id, ordinal, recorded_by_user_id, played_at_ms, created_at_ms) VALUES ('game-open', 'session-open', 1, 'user-1', 3, 3)").run();
		sqlite.prepare("INSERT INTO game_results (game_id, user_id, final_score, rank, score_difference, score_points_milli, rank_bonus_milli, points_milli, created_at_ms) VALUES ('game-open', 'user-1', 40000, 1, 0, 0, 0, 5000, 3)").run();
		const db = { prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ all: async () => ({ results: sqlite.prepare(sql).all(...values) }) }) }) } as unknown as D1Database;
		await expect(getPlayerStats(db, "user-1", "all", 100)).resolves.toMatchObject({ summary: { totalGames: 2, totalSessions: 1, totalPointsMilli: 10_000, averagePointsMilli: 5_000, averageRank: 2.5, topRateBasisPoints: 5_000, lastRateBasisPoints: 5_000 }, rankCounts: { 1: 1, 4: 1 } });
		await expect(getPlayerStats(db, "user-1", "all", 100, true)).resolves.toMatchObject({ summary: { totalGames: 3, totalPointsMilli: 15_000 }, recentGames: [{ id: "game-open" }, { id: "game-2" }, { id: "game-1" }] });
		sqlite.close();
	});
});
