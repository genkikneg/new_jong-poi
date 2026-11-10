import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
	createSession,
	getSessionDetail,
	joinSessionByCode,
	listUserHistory,
	listUserSessions,
	SessionInputError,
	SessionJoinError,
} from "./sessions";

describe("createSession", () => {
	it("creates the session and host membership in one D1 batch", async () => {
		const batches: unknown[][] = [];
		const database = {
			prepare: () => ({ bind: (...values: unknown[]) => ({ values }) }),
			batch: async (statements: unknown[]) => {
				batches.push(statements);
				return [];
			},
		} as unknown as D1Database;

		const session = await createSession(
			database,
			"user-1",
			{ name: "金曜卓", playerCount: 4 },
			1_000,
		);

		expect(session.name).toBe("金曜卓");
		expect(session.playerCount).toBe(4);
		expect(session.memberCount).toBe(1);
		expect(session.joinCode).toMatch(/^[A-Z2-9]{8}$/);
		expect(batches).toHaveLength(1);
		expect(batches[0]).toHaveLength(2);
	});

	it("rejects unsupported player counts without accessing D1", async () => {
		const database = {
			prepare: () => {
				throw new Error("D1 should not be queried");
			},
		} as unknown as D1Database;

		await expect(
			createSession(database, "user-1", { playerCount: 5 }),
		).rejects.toBeInstanceOf(SessionInputError);
	});

	it("stores selected friends and scoring rules with the new session", async () => {
		const batches: { sql: string; values: unknown[] }[][] = [];
		const database = {
			prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ sql, values, all: async () => ({ results: [{ id: "friend-1" }] }) }) }),
			batch: async (statements: { sql: string; values: unknown[] }[]) => { batches.push(statements); return []; },
		} as unknown as D1Database;
		const session = await createSession(database, "owner", {
			playerCount: 3, friendIds: ["friend-1"],
			rules: { baseScore: 30000, scoreMultiplierBasisPoints: 2000, rankBonusesMilli: { 1: 2000000, 2: 0, 3: -2000000 } },
		});
		expect(session.memberCount).toBe(2);
		expect(batches[0]).toHaveLength(3);
		expect(JSON.parse(batches[0][0].values[6] as string)).toMatchObject({ baseScore: 30000, scoreMultiplierBasisPoints: 2000 });
		expect(batches[0][2].values[1]).toBe("friend-1");
	});

	it("rejects rank bonuses whose total is not zero", async () => {
		const database = { prepare: () => { throw new Error("D1 should not be queried"); } } as unknown as D1Database;
		await expect(createSession(database, "owner", {
			playerCount: 3,
			rules: { baseScore: 25000, scoreMultiplierBasisPoints: 1000, rankBonusesMilli: { 1: 2000000, 2: 1000000, 3: 0 } },
		})).rejects.toBeInstanceOf(SessionInputError);
	});

	it("uses 35,000 as the default base score for three players", async () => {
		const batches: { values: unknown[] }[][] = [];
		const database = {
			prepare: () => ({ bind: (...values: unknown[]) => ({ values }) }),
			batch: async (statements: { values: unknown[] }[]) => { batches.push(statements); return []; },
		} as unknown as D1Database;
		await createSession(database, "owner", { playerCount: 3 });
		expect(JSON.parse(batches[0][0].values[6] as string).baseScore).toBe(35000);
	});
});

describe("joinSessionByCode", () => {
	it("rejects malformed invite codes before accessing D1", async () => {
		const database = {
			prepare: () => {
				throw new Error("D1 should not be queried");
			},
		} as unknown as D1Database;

		await expect(joinSessionByCode(database, "user-2", "not-a-code")).rejects.toBeInstanceOf(
			SessionJoinError,
		);
	});

	it("requires D1 to insert exactly one membership", async () => {
		const database = {
			prepare: () => ({
				bind: () => ({ first: async () => null }),
			}),
		} as unknown as D1Database;

		await expect(joinSessionByCode(database, "user-2", "ABCDEFGH")).rejects.toBeInstanceOf(
			SessionJoinError,
		);
	});

	it("returns the session detail route target after a successful join", async () => {
		const database = {
			prepare: () => ({
				bind: () => ({ first: async () => ({ session_id: "session-1" }) }),
			}),
		} as unknown as D1Database;

		await expect(joinSessionByCode(database, "user-2", "ABCDEFGH")).resolves.toBe("session-1");
	});
});

describe("listUserSessions", () => {
	it("only maps the session fields intended for the client", async () => {
		const database = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({
						results: [
							{
								id: "session-1",
								name: "金曜卓",
								join_code: "ABCDEFGH",
								player_count: 4,
								member_count: 2,
								status: "open",
								created_at_ms: 1_000,
							},
						],
					}),
				}),
			}),
		} as unknown as D1Database;

		await expect(listUserSessions(database, "user-1")).resolves.toEqual([
			{
				id: "session-1",
				name: "金曜卓",
				joinCode: "ABCDEFGH",
				playerCount: 4,
				memberCount: 2,
				status: "open",
				createdAtMs: 1_000,
			},
		]);
	});
});

describe("listUserHistory", () => {
	it("returns only the signed-in player's closed-session totals", async () => {
		const database = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({
						results: [
							{
								id: "session-1",
								name: "金曜卓",
								player_count: 4,
								closed_at_ms: 2_000,
								game_id: "game-1",
								result_user_id: "user-1",
								points_milli: 32_500,
							},
							{
								id: "session-1",
								name: "金曜卓",
								player_count: 4,
								closed_at_ms: 2_000,
								game_id: "game-2",
								result_user_id: "user-2",
								points_milli: 1_000,
							},
							{
								id: "session-1",
								name: "金曜卓",
								player_count: 4,
								closed_at_ms: 2_000,
								game_id: "game-3",
								result_user_id: "user-2",
								points_milli: 1_000,
							},
						],
					}),
				}),
			}),
		} as unknown as D1Database;

		await expect(listUserHistory(database, "user-1")).resolves.toEqual([
			{
				id: "session-1",
				name: "金曜卓",
				playerCount: 4,
				closedAtMs: 2_000,
				totalPointsMilli: 32_500,
				rank: 1,
				gameCount: 3,
				members: [],
			},
		]);
	});

	it("finds a newly created session immediately after it is closed", async () => {
		const sqlite = new DatabaseSync(":memory:");
		sqlite.exec(
			readFileSync(new URL("../../migrations/0001_initial_schema.sql", import.meta.url), "utf8"),
		);
		sqlite.prepare(
			`INSERT INTO users (id, user_id, display_name, created_at_ms, updated_at_ms)
			 VALUES (?, ?, ?, ?, ?)`,
		).run("user-1", "tester", "テストユーザー", 1_000, 1_000);
		sqlite.prepare(
			`INSERT INTO game_sessions
			 (id, owner_user_id, name, join_code, player_count, status, rules_json,
			  state_version, created_at_ms, updated_at_ms, closed_at_ms)
			 VALUES (?, ?, ?, ?, ?, 'closed', ?, 1, ?, ?, ?)`,
		).run("session-1", "user-1", "テスト卓", "ABCDEFGH", 4, "{}", 1_000, 2_000, 2_000);
		sqlite.prepare(
			`INSERT INTO session_members (session_id, user_id, seat_index, joined_at_ms)
			 VALUES (?, ?, ?, ?)`,
		).run("session-1", "user-1", 0, 1_000);

		const database = {
			prepare: (sql: string) => ({
				bind: (...values: unknown[]) => ({
					all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
				}),
			}),
		} as unknown as D1Database;

		await expect(listUserHistory(database, "user-1")).resolves.toEqual([
			expect.objectContaining({
				id: "session-1",
				name: "テスト卓",
				closedAtMs: 2_000,
				gameCount: 0,
			}),
		]);
		sqlite.close();
	});
});

describe("getSessionDetail", () => {
	it("returns a closed session with no games from the real schema", async () => {
		const sqlite = new DatabaseSync(":memory:");
		sqlite.exec(
			readFileSync(new URL("../../migrations/0001_initial_schema.sql", import.meta.url), "utf8"),
		);
		sqlite.prepare(
			`INSERT INTO users (id, user_id, display_name, created_at_ms, updated_at_ms)
			 VALUES (?, ?, ?, ?, ?)`,
		).run("user-1", "tester", "テストユーザー", 1_000, 1_000);
		sqlite.prepare(
			`INSERT INTO game_sessions
			 (id, owner_user_id, name, join_code, player_count, status, rules_json,
			  state_version, created_at_ms, updated_at_ms, closed_at_ms)
			 VALUES (?, ?, ?, ?, ?, 'closed', ?, 1, ?, ?, ?)`,
		).run("session-1", "user-1", "テスト卓", "ABCDEFGH", 4, "{}", 1_000, 2_000, 2_000);
		sqlite.prepare(
			`INSERT INTO session_members (session_id, user_id, seat_index, joined_at_ms)
			 VALUES (?, ?, ?, ?)`,
		).run("session-1", "user-1", 0, 1_000);

		const database = {
			prepare: (sql: string) => ({
				bind: (...values: unknown[]) => ({
					first: async () => sqlite.prepare(sql).get(...values),
					all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
				}),
			}),
		} as unknown as D1Database;

		await expect(getSessionDetail(database, "user-1", "session-1")).resolves.toEqual(
			expect.objectContaining({
				id: "session-1",
				name: "テスト卓",
				status: "closed",
				memberCount: 1,
				games: [],
			}),
		);
		sqlite.close();
	});

	it("returns members and groups each game's results for a member", async () => {
		const database = {
			prepare: (sql: string) => ({
				bind: () => ({
					first: async () => sql.includes("FROM session_members\n")
						? { is_member: 1 }
						: {
							id: "session-1",
							name: "金曜卓",
							join_code: "ABCDEFGH",
							player_count: 3,
							member_count: 3,
							status: "active",
							rules_json: JSON.stringify({ playerCount: 3, baseScore: 35000, scoreMultiplierBasisPoints: 1000, rankBonusesMilli: { 1: 10000, 2: 0, 3: -10000 } }),
							created_at_ms: 1_000,
							state_version: 2,
						},
					all: async () => {
						if (sql.includes("FROM session_members AS member")) {
							return {
								results: [
									{ id: "a", user_id: "a-id", display_name: "A", seat_index: 0 },
									{ id: "b", user_id: "b-id", display_name: "B", seat_index: 1 },
									{ id: "c", user_id: "c-id", display_name: "C", seat_index: 2 },
								],
							};
						}
						return {
							results: [
								{
									game_id: "game-1", ordinal: 1, played_at_ms: 2_000,
									recorded_by_user_id: "a", user_id: "a", display_name: "A",
									final_score: 30_000, rank: 1, points_milli: 500_000,
								},
							],
						};
					},
				}),
			}),
		} as unknown as D1Database;

		const detail = await getSessionDetail(database, "a", "session-1");
		expect(detail.id).toBe("session-1");
		expect(detail.stateVersion).toBe(2);
		expect(detail.members).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "a", displayName: "A" })]),
		);
		expect(detail.games).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "game-1",
					ordinal: 1,
					results: expect.arrayContaining([expect.objectContaining({ userId: "a", rank: 1 })]),
				}),
			]),
		);
	});
});
