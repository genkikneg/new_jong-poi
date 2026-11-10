import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { listRankings, rankingPeriodStartMs } from "./rankings";

describe("rankingPeriodStartMs", () => {
	it("uses JST boundaries for yearly and monthly rankings", () => {
		const now = Date.parse("2026-11-06T03:00:00.000Z");
		expect(rankingPeriodStartMs("year", now)).toBe(Date.parse("2025-12-31T15:00:00.000Z"));
		expect(rankingPeriodStartMs("month", now)).toBe(Date.parse("2026-10-31T15:00:00.000Z"));
		expect(rankingPeriodStartMs("all", now)).toBe(0);
	});
});

describe("listRankings", () => {
	it("returns players with at least five completed games and integer metrics", async () => {
		const sqlite = new DatabaseSync(":memory:");
		sqlite.exec(readFileSync(new URL("../../migrations/0001_initial_schema.sql", import.meta.url), "utf8"));
		sqlite.prepare("INSERT INTO users (id, user_id, display_name, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)")
			.run("user-1", "tester", "テスト", 1, 1);
		sqlite.prepare("INSERT INTO game_sessions (id, owner_user_id, name, join_code, player_count, status, rules_json, created_at_ms, updated_at_ms, closed_at_ms) VALUES (?, ?, ?, ?, 4, 'closed', '{}', ?, ?, ?)")
			.run("session-1", "user-1", "卓", "ABCDEFGH", 1, 1, 10);
		for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
			const gameId = `game-${ordinal}`;
			sqlite.prepare("INSERT INTO games (id, session_id, ordinal, recorded_by_user_id, played_at_ms, created_at_ms) VALUES (?, 'session-1', ?, 'user-1', ?, ?)")
				.run(gameId, ordinal, ordinal, ordinal);
			sqlite.prepare("INSERT INTO game_results (game_id, user_id, final_score, rank, score_difference, score_points_milli, rank_bonus_milli, points_milli, created_at_ms) VALUES (?, 'user-1', 30000, 1, 5000, 5000, 20000, 25000, ?)")
				.run(gameId, ordinal);
		}

		const database = {
			prepare: (sql: string) => ({
				bind: (...values: unknown[]) => ({ all: async () => ({ results: sqlite.prepare(sql).all(...values) }) }),
			}),
		} as unknown as D1Database;

		await expect(listRankings(database, "all", 100)).resolves.toEqual([{
			id: "user-1",
			userId: "tester",
			displayName: "テスト",
			gamesPlayed: 5,
			totalPointsMilli: 125_000,
			averagePointsMilli: 25_000,
			topFinishes: 5,
			topRateBasisPoints: 10_000,
			avatarUpdatedAtMs: null,
		}]);
		sqlite.close();
	});
});
