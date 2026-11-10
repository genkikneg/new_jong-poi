export type RankingPeriod = "all" | "year" | "month";

export interface RankingPlayer {
	id: string;
	userId: string;
	displayName: string;
	gamesPlayed: number;
	totalPointsMilli: number;
	averagePointsMilli: number;
	topFinishes: number;
	topRateBasisPoints: number;
	avatarUpdatedAtMs: number | null;
}

interface RankingRow {
	id: string;
	user_id: string;
	display_name: string;
	games_played: number;
	total_points_milli: number;
	top_finishes: number;
	avatar_updated_at_ms: number | null;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;

export function isRankingPeriod(value: string | undefined): value is RankingPeriod {
	return value === "all" || value === "year" || value === "month";
}

export function rankingPeriodStartMs(period: RankingPeriod, nowMs = Date.now()): number {
	if (period === "all") return 0;
	const jst = new Date(nowMs + JST_OFFSET_MS);
	const year = jst.getUTCFullYear();
	const month = period === "month" ? jst.getUTCMonth() : 0;
	return Date.UTC(year, month, 1) - JST_OFFSET_MS;
}

export async function listRankings(
	db: D1Database,
	period: RankingPeriod,
	nowMs = Date.now(),
): Promise<RankingPlayer[]> {
	const result = await db
		.prepare(
			`SELECT user.id, user.user_id, user.display_name, avatar.updated_at_ms AS avatar_updated_at_ms,
					COUNT(*) AS games_played,
					COALESCE(SUM(result.points_milli), 0) AS total_points_milli,
					SUM(CASE WHEN result.rank = 1 THEN 1 ELSE 0 END) AS top_finishes
			 FROM game_results AS result
			 INNER JOIN games AS game ON game.id = result.game_id
			 INNER JOIN game_sessions AS session ON session.id = game.session_id
			 INNER JOIN users AS user ON user.id = result.user_id
			 LEFT JOIN user_avatars AS avatar ON avatar.user_id = user.id
			 WHERE session.status = 'closed' AND game.played_at_ms >= ?
			 GROUP BY user.id, user.user_id, user.display_name, avatar.updated_at_ms
			 HAVING COUNT(*) >= 5
			 ORDER BY total_points_milli DESC, user.id ASC
			 LIMIT 200`,
		)
		.bind(rankingPeriodStartMs(period, nowMs))
		.all<RankingRow>();

	return result.results.map((row) => ({
		id: row.id,
		userId: row.user_id,
		displayName: row.display_name,
		gamesPlayed: row.games_played,
		totalPointsMilli: row.total_points_milli,
		averagePointsMilli: Math.trunc(row.total_points_milli / row.games_played),
		topFinishes: row.top_finishes,
		topRateBasisPoints: Math.trunc((row.top_finishes * 10_000) / row.games_played),
		avatarUpdatedAtMs: row.avatar_updated_at_ms,
	}));
}
