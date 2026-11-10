import { rankingPeriodStartMs, type RankingPeriod } from "./rankings";

export interface PlayerStats {
	period: RankingPeriod;
	summary: { totalGames: number; totalSessions: number; totalPointsMilli: number; averagePointsMilli: number | null; averageRank: number | null; topRateBasisPoints: number | null; topTwoRateBasisPoints: number | null; lastRateBasisPoints: number | null; };
	rankCounts: Record<number, number>;
	recentGames: { id: string; ordinal: number; playedAtMs: number; sessionName: string | null; playerCount: 3 | 4; rank: number; finalScore: number; pointsMilli: number; }[];
	trend: { playedAtMs: number; cumulativePointsMilli: number; rank: number; pointsMilli: number }[];
}

interface StatRow { id: string; ordinal: number; played_at_ms: number; session_name: string | null; player_count: 3 | 4; rank: number; final_score: number; points_milli: number; session_id: string; }

export async function getPlayerStats(db: D1Database, userId: string, period: RankingPeriod, nowMs = Date.now(), includeOpenSessions = false): Promise<PlayerStats> {
	const result = await db.prepare(
		`SELECT game.id, game.ordinal, game.played_at_ms, session.name AS session_name, session.player_count,
				result.rank, result.final_score, result.points_milli, session.id AS session_id
		 FROM game_results AS result
		 INNER JOIN games AS game ON game.id = result.game_id
		 INNER JOIN game_sessions AS session ON session.id = game.session_id
		 WHERE result.user_id = ? AND (? = 1 OR session.status = 'closed') AND game.played_at_ms >= ?
		 ORDER BY game.played_at_ms DESC, game.id DESC
		 LIMIT 500`,
	).bind(userId, includeOpenSessions ? 1 : 0, rankingPeriodStartMs(period, nowMs)).all<StatRow>();
	const rows = [...result.results].reverse();
	const totalGames = rows.length;
	const totalPointsMilli = rows.reduce((sum, row) => sum + row.points_milli, 0);
	const rankCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
	for (const row of rows) rankCounts[row.rank] = (rankCounts[row.rank] ?? 0) + 1;
	const totalSessions = new Set(rows.map((row) => row.session_id)).size;
	const lastCount = rows.filter((row) => row.rank === row.player_count).length;
	let cumulativePointsMilli = rows.slice(0, -50).reduce((sum, row) => sum + row.points_milli, 0);
	const trend = rows.slice(-50).map((row) => ({ playedAtMs: row.played_at_ms, rank: row.rank, pointsMilli: row.points_milli, cumulativePointsMilli: cumulativePointsMilli += row.points_milli }));
	return {
		period,
		summary: {
			totalGames, totalSessions, totalPointsMilli,
			averagePointsMilli: totalGames ? Math.trunc(totalPointsMilli / totalGames) : null,
			averageRank: totalGames ? Math.round((rows.reduce((sum, row) => sum + row.rank, 0) / totalGames) * 100) / 100 : null,
			topRateBasisPoints: totalGames ? Math.trunc((rankCounts[1] * 10_000) / totalGames) : null,
			topTwoRateBasisPoints: totalGames ? Math.trunc(((rankCounts[1] + rankCounts[2]) * 10_000) / totalGames) : null,
			lastRateBasisPoints: totalGames ? Math.trunc((lastCount * 10_000) / totalGames) : null,
		},
		rankCounts,
		recentGames: rows.slice(-10).reverse().map((row) => ({ id: row.id, ordinal: row.ordinal, playedAtMs: row.played_at_ms, sessionName: row.session_name, playerCount: row.player_count, rank: row.rank, finalScore: row.final_score, pointsMilli: row.points_milli })),
		trend,
	};
}
