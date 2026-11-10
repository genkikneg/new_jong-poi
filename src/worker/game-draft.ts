export interface GameDraftEntry {
	userId: string;
	finalScore: number;
	rank: number | null;
}

export class GameDraftError extends Error {
	constructor(readonly code: "SESSION_NOT_FOUND" | "NOT_A_MEMBER" | "SESSION_CLOSED" | "INVALID_SCORE") {
		super(code);
	}
}

interface SessionRow { status: "open" | "active" | "closed"; player_count: 3 | 4; }
interface DraftRow { user_id: string; final_score: number; rank: number | null; }

export async function listGameDraft(db: D1Database, sessionId: string, userId: string): Promise<GameDraftEntry[]> {
	const member = await db.prepare("SELECT 1 AS found FROM session_members WHERE session_id = ? AND user_id = ?").bind(sessionId, userId).first();
	if (!member) throw new GameDraftError("NOT_A_MEMBER");
	const entries = await db.prepare("SELECT user_id, final_score, rank FROM game_draft_entries WHERE session_id = ?").bind(sessionId).all<DraftRow>();
	return entries.results.map((entry) => ({ userId: entry.user_id, finalScore: entry.final_score, rank: entry.rank }));
}

export async function saveGameDraft(db: D1Database, sessionId: string, userId: string, finalScore: number, rank: number | null, nowMs = Date.now()): Promise<void> {
	const session = await db.prepare("SELECT status, player_count FROM game_sessions WHERE id = ?").bind(sessionId).first<SessionRow>();
	if (!session) throw new GameDraftError("SESSION_NOT_FOUND");
	if (session.status === "closed") throw new GameDraftError("SESSION_CLOSED");
	if (!Number.isSafeInteger(finalScore) || finalScore < 0 || finalScore > 1_000_000 || (rank !== null && (!Number.isSafeInteger(rank) || rank < 1 || rank > session.player_count))) throw new GameDraftError("INVALID_SCORE");
	const member = await db.prepare("SELECT 1 AS found FROM session_members WHERE session_id = ? AND user_id = ?").bind(sessionId, userId).first();
	if (!member) throw new GameDraftError("NOT_A_MEMBER");
	await db.prepare(`INSERT INTO game_draft_entries (session_id, user_id, final_score, rank, updated_at_ms)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(session_id, user_id) DO UPDATE SET final_score = excluded.final_score, rank = excluded.rank, updated_at_ms = excluded.updated_at_ms`).bind(sessionId, userId, finalScore, rank, nowMs).run();
}
