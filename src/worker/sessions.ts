import type { ScoringRules } from "../domain/scoring";

export type SessionPlayerCount = 3 | 4;

export interface SessionSummary {
	id: string;
	name: string | null;
	joinCode: string;
	playerCount: SessionPlayerCount;
	memberCount: number;
	status: "open" | "active" | "closed";
	createdAtMs: number;
}

export interface SessionMember {
	id: string;
	userId: string;
	displayName: string;
	seatIndex: number | null;
	avatarUpdatedAtMs: number | null;
}

export interface GameResultSummary {
	userId: string;
	displayName: string;
	finalScore: number;
	rank: number;
	pointsMilli: number;
}

export interface GameSummary {
	id: string;
	ordinal: number;
	recordedAtMs: number;
	recordedByUserId: string;
	results: GameResultSummary[];
}

export interface SessionDetail extends SessionSummary {
	ownerUserId: string;
	stateVersion: number;
	rules: ScoringRules;
	members: SessionMember[];
	games: GameSummary[];
}

export interface SessionHistoryItem {
	id: string;
	name: string | null;
	playerCount: SessionPlayerCount;
	closedAtMs: number;
	totalPointsMilli: number;
	rank: number | null;
	gameCount: number;
	members: SessionMember[];
}

interface SessionSummaryRow {
	id: string;
	name: string | null;
	join_code: string;
	player_count: SessionPlayerCount;
	member_count: number;
	status: SessionSummary["status"];
	created_at_ms: number;
}

interface SessionDetailRow extends Omit<SessionSummaryRow, "member_count"> {
	owner_user_id: string;
	member_count: number;
	state_version: number;
	rules_json: string;
}

interface SessionHistoryRow {
	id: string;
	name: string | null;
	player_count: SessionPlayerCount;
	closed_at_ms: number;
	game_id: string | null;
	result_user_id: string | null;
	points_milli: number | null;
}

interface SessionMemberRow {
	id: string;
	user_id: string;
	display_name: string;
	seat_index: number | null;
	avatar_updated_at_ms: number | null;
}

interface GameResultRow {
	game_id: string;
	ordinal: number;
	played_at_ms: number;
	recorded_by_user_id: string;
	user_id: string | null;
	display_name: string | null;
	final_score: number | null;
	rank: number | null;
	points_milli: number | null;
}

export class SessionInputError extends Error {
	constructor() {
		super("Session input is invalid.");
		this.name = "SessionInputError";
	}
}

export class SessionJoinError extends Error {
	constructor() {
		super("Session cannot be joined.");
		this.name = "SessionJoinError";
	}
}

export class SessionNotFoundError extends Error {
	constructor() {
		super("Session was not found for this user.");
		this.name = "SessionNotFoundError";
	}
}

const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function defaultRules(playerCount: SessionPlayerCount): ScoringRules {
	return playerCount === 4
		? {
				playerCount,
				baseScore: 25_000,
				scoreMultiplierBasisPoints: 1_000,
				rankBonusesMilli: { 1: 20_000, 2: 10_000, 3: 0, 4: -30_000 },
			}
		: {
				playerCount,
				baseScore: 35_000,
				scoreMultiplierBasisPoints: 1_000,
				rankBonusesMilli: { 1: 10_000, 2: 0, 3: -10_000 },
			};
}

function newJoinCode(): string {
	const values = crypto.getRandomValues(new Uint8Array(8));
	return [...values].map((value) => JOIN_CODE_ALPHABET[value % JOIN_CODE_ALPHABET.length]).join("");
}

function mapSummary(row: SessionSummaryRow): SessionSummary {
	return {
		id: row.id,
		name: row.name,
		joinCode: row.join_code,
		playerCount: row.player_count,
		memberCount: row.member_count,
		status: row.status,
		createdAtMs: row.created_at_ms,
	};
}

export async function createSession(
	db: D1Database,
	ownerUserId: string,
	input: { name?: string; playerCount?: number; friendIds?: string[]; rules?: { baseScore: number; scoreMultiplierBasisPoints: number; rankBonusesMilli: Record<number, number> } },
	nowMs = Date.now(),
): Promise<SessionSummary> {
	const name = input.name?.trim() || null;
	if (name !== null && name.length > 80) {
		throw new SessionInputError();
	}

	const playerCount = input.playerCount ?? 4;
	if (playerCount !== 3 && playerCount !== 4) {
		throw new SessionInputError();
	}
	const friendIds = input.friendIds ?? [];
	if (!Array.isArray(friendIds) || friendIds.length > playerCount - 1 || new Set(friendIds).size !== friendIds.length || friendIds.some((id) => typeof id !== "string" || id === ownerUserId)) throw new SessionInputError();
	if (friendIds.length) {
		const friends = await db.prepare(`SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END AS id FROM friendships WHERE user_id = ? OR friend_id = ?`).bind(ownerUserId, ownerUserId, ownerUserId).all<{ id: string }>();
		if (friendIds.some((id) => !friends.results.some((friend) => friend.id === id))) throw new SessionInputError();
	}
	if (input.rules && (typeof input.rules.rankBonusesMilli !== "object" || input.rules.rankBonusesMilli === null || Array.isArray(input.rules.rankBonusesMilli))) throw new SessionInputError();
	const rules: ScoringRules = input.rules ? { playerCount, ...input.rules } : defaultRules(playerCount);
	if (!Number.isSafeInteger(rules.baseScore) || rules.baseScore < 0 || rules.baseScore > 1_000_000 || !Number.isSafeInteger(rules.scoreMultiplierBasisPoints) || rules.scoreMultiplierBasisPoints < 10 || Array.from({ length: playerCount }, (_, index) => rules.rankBonusesMilli[index + 1]).some((bonus) => !Number.isSafeInteger(bonus) || Math.abs(bonus) > 100_000_000)) throw new SessionInputError();
	if (Array.from({ length: playerCount }, (_, index) => rules.rankBonusesMilli[index + 1]).reduce((total, bonus) => total + bonus, 0) !== 0) throw new SessionInputError();

	for (let attempts = 0; attempts < 3; attempts += 1) {
		const id = crypto.randomUUID();
		const joinCode = newJoinCode();

		try {
			await db.batch([
				db
					.prepare(
						`INSERT INTO game_sessions
							(id, owner_user_id, name, join_code, player_count, status, rules_json, created_at_ms, updated_at_ms)
						 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)`,
					)
					.bind(id, ownerUserId, name, joinCode, playerCount, friendIds.length === playerCount - 1 ? "active" : "open", JSON.stringify(rules), nowMs),
				db
					.prepare(
						"INSERT INTO session_members (session_id, user_id, seat_index, joined_at_ms) VALUES (?1, ?2, 0, ?3)",
					)
					.bind(id, ownerUserId, nowMs),
				...friendIds.map((friendId, index) => db.prepare("INSERT INTO session_members (session_id, user_id, seat_index, joined_at_ms) VALUES (?1, ?2, ?3, ?4)").bind(id, friendId, index + 1, nowMs)),
			]);

			return {
				id,
				name,
				joinCode,
				playerCount,
				memberCount: 1 + friendIds.length,
				status: friendIds.length === playerCount - 1 ? "active" : "open",
				createdAtMs: nowMs,
			};
		} catch (error) {
			if (attempts === 2) {
				throw error;
			}
		}
	}

	throw new Error("Session creation did not finish.");
}

export async function joinSessionByCode(
	db: D1Database,
	userId: string,
	joinCode: string,
	nowMs = Date.now(),
): Promise<string> {
	const normalizedCode = joinCode.trim().toUpperCase();
	if (!/^[A-Z2-9]{8}$/.test(normalizedCode)) {
		throw new SessionJoinError();
	}

	const result = await db
		.prepare(
			`INSERT INTO session_members (session_id, user_id, seat_index, joined_at_ms)
			 SELECT session.id, ?2,
				(SELECT COUNT(*) FROM session_members AS members WHERE members.session_id = session.id),
				?3
			 FROM game_sessions AS session
			 WHERE session.join_code = ?1 COLLATE NOCASE
				AND session.status = 'open'
				AND NOT EXISTS (
					SELECT 1 FROM session_members AS existing
					WHERE existing.session_id = session.id AND existing.user_id = ?2
				)
			AND (SELECT COUNT(*) FROM session_members AS members WHERE members.session_id = session.id) < session.player_count
			RETURNING session_id`,
		)
		.bind(normalizedCode, userId, nowMs)
		.first<{ session_id: string }>();

	if (!result) {
		throw new SessionJoinError();
	}

	return result.session_id;
}

export async function listUserSessions(
	db: D1Database,
	userId: string,
): Promise<SessionSummary[]> {
	const result = await db
		.prepare(
			`SELECT session.id, session.name, session.join_code, session.player_count, session.status,
				 session.created_at_ms, COUNT(member.user_id) AS member_count
			 FROM game_sessions AS session
			 INNER JOIN session_members AS mine ON mine.session_id = session.id AND mine.user_id = ?1
			 INNER JOIN session_members AS member ON member.session_id = session.id
			 GROUP BY session.id
			 ORDER BY session.updated_at_ms DESC`,
		)
		.bind(userId)
		.all<SessionSummaryRow>();

	return result.results.map(mapSummary);
}

/** Returns the most recent completed sessions and the caller's totals in each. */
export async function listUserHistory(
	db: D1Database,
	userId: string,
	limit = 50,
): Promise<SessionHistoryItem[]> {
	const boundedLimit = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50;
	const result = await db
		.prepare(
			`WITH recent_sessions AS (
				SELECT session.id, session.name, session.player_count,
					COALESCE(session.closed_at_ms, session.updated_at_ms) AS closed_at_ms
				FROM game_sessions AS session
				INNER JOIN session_members AS membership
					ON membership.session_id = session.id
				WHERE membership.user_id = ? AND session.status = 'closed'
				ORDER BY closed_at_ms DESC, session.id DESC
				LIMIT ?
			)
			SELECT session.id, session.name, session.player_count, session.closed_at_ms,
				game.id AS game_id, result.user_id AS result_user_id, result.points_milli
			FROM recent_sessions AS session
			LEFT JOIN games AS game ON game.session_id = session.id
			LEFT JOIN game_results AS result ON result.game_id = game.id
			ORDER BY session.closed_at_ms DESC, session.id DESC, game.ordinal ASC, result.rank ASC`,
		)
		.bind(userId, boundedLimit)
		.all<SessionHistoryRow>();

	const sessions = new Map<
		string,
		{
			id: string;
			name: string | null;
			playerCount: SessionPlayerCount;
			closedAtMs: number;
			gameIds: Set<string>;
			totals: Map<string, number>;
		}
	>();
	for (const row of result.results) {
		let session = sessions.get(row.id);
		if (!session) {
			session = {
				id: row.id,
				name: row.name,
				playerCount: row.player_count,
				closedAtMs: row.closed_at_ms,
				gameIds: new Set<string>(),
				totals: new Map<string, number>(),
			};
			sessions.set(row.id, session);
		}
		if (row.game_id !== null) session.gameIds.add(row.game_id);
		if (row.result_user_id !== null && row.points_milli !== null) {
			session.totals.set(
				row.result_user_id,
				(session.totals.get(row.result_user_id) ?? 0) + row.points_milli,
			);
		}
	}

	const sessionValues = [...sessions.values()];
	const membersBySession = new Map<string, SessionMember[]>();
	if (sessionValues.length > 0) {
		const placeholders = sessionValues.map(() => "?").join(",");
		const memberRows = await db.prepare(
			`SELECT member.session_id, user.id, user.user_id, user.display_name, member.seat_index,
					avatar.updated_at_ms AS avatar_updated_at_ms
			 FROM session_members AS member
			 INNER JOIN users AS user ON user.id = member.user_id
			 LEFT JOIN user_avatars AS avatar ON avatar.user_id = user.id
			 WHERE member.session_id IN (${placeholders})
			 ORDER BY member.session_id, member.seat_index ASC`,
		).bind(...sessionValues.map((session) => session.id)).all<SessionMemberRow & { session_id: string }>();
		for (const row of memberRows.results) {
			const members = membersBySession.get(row.session_id) ?? [];
			members.push({ id: row.id, userId: row.user_id, displayName: row.display_name, seatIndex: row.seat_index, avatarUpdatedAtMs: row.avatar_updated_at_ms });
			membersBySession.set(row.session_id, members);
		}
	}

	return sessionValues.map((session) => {
		const totalPointsMilli = session.totals.get(userId) ?? 0;
		const rank = session.totals.has(userId)
			? 1 + [...session.totals.values()].filter((total) => total > totalPointsMilli).length
			: null;
		return {
			id: session.id,
			name: session.name,
			playerCount: session.playerCount,
			closedAtMs: session.closedAtMs,
			totalPointsMilli,
			rank,
			gameCount: session.gameIds.size,
			members: membersBySession.get(session.id) ?? [],
		};
	});
}

/** Returns only a session the requesting user has already joined. */
export async function getSessionDetail(
	db: D1Database,
	userId: string,
	sessionId: string,
): Promise<SessionDetail> {
	const session = await db
		.prepare(
			`SELECT session.id, session.owner_user_id, session.name, session.join_code, session.player_count, session.status, session.rules_json,
					 session.created_at_ms, session.state_version,
					 (SELECT COUNT(*) FROM session_members AS member WHERE member.session_id = session.id) AS member_count
			 FROM game_sessions AS session
			 WHERE session.id = ?
			 LIMIT 1`,
		)
		.bind(sessionId)
		.first<SessionDetailRow>();
	if (!session) {
		throw new SessionNotFoundError();
	}

	const membership = await db
		.prepare(
			`SELECT 1 AS is_member
			 FROM session_members
			 WHERE session_id = ? AND user_id = ?
			 LIMIT 1`,
		)
		.bind(sessionId, userId)
		.first<{ is_member: number }>();
	if (!membership) {
		throw new SessionNotFoundError();
	}

	const [members, gameRows] = await Promise.all([
		db
			.prepare(
				`SELECT user.id, user.user_id, user.display_name, member.seat_index,
						avatar.updated_at_ms AS avatar_updated_at_ms
				 FROM session_members AS member
				 INNER JOIN users AS user ON user.id = member.user_id
				 LEFT JOIN user_avatars AS avatar ON avatar.user_id = user.id
				 WHERE member.session_id = ?
				 ORDER BY member.seat_index ASC`,
			)
			.bind(sessionId)
			.all<SessionMemberRow>(),
		db
			.prepare(
				`SELECT game.id AS game_id, game.ordinal, game.played_at_ms, game.recorded_by_user_id,
						result.user_id, user.display_name, result.final_score, result.rank, result.points_milli
				 FROM games AS game
				 LEFT JOIN game_results AS result ON result.game_id = game.id
				 LEFT JOIN users AS user ON user.id = result.user_id
				 WHERE game.session_id = ?
				 ORDER BY game.ordinal DESC, result.rank ASC, result.user_id ASC`,
			)
			.bind(sessionId)
			.all<GameResultRow>(),
	]);

	const games = new Map<string, GameSummary>();
	for (const row of gameRows.results) {
		let game = games.get(row.game_id);
		if (!game) {
			game = {
				id: row.game_id,
				ordinal: row.ordinal,
				recordedAtMs: row.played_at_ms,
				recordedByUserId: row.recorded_by_user_id,
				results: [],
			};
			games.set(row.game_id, game);
		}

		if (
			row.user_id !== null &&
			row.display_name !== null &&
			row.final_score !== null &&
			row.rank !== null &&
			row.points_milli !== null
		) {
			game.results.push({
				userId: row.user_id,
				displayName: row.display_name,
				finalScore: row.final_score,
				rank: row.rank,
				pointsMilli: row.points_milli,
			});
		}
	}

	return {
		...mapSummary(session),
		ownerUserId: session.owner_user_id,
		stateVersion: session.state_version,
		rules: JSON.parse(session.rules_json) as ScoringRules,
		members: members.results.map((member) => ({
			id: member.id,
			userId: member.user_id,
			displayName: member.display_name,
			seatIndex: member.seat_index,
			avatarUpdatedAtMs: member.avatar_updated_at_ms,
		})),
		games: [...games.values()],
	};
}
