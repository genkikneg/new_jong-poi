import { DurableObject } from "cloudflare:workers";
import {
	calculateGameResults,
	calculateRanks,
	ScoringValidationError,
	type CalculatedGameResult,
	type ScoringRules,
} from "../domain/scoring";
import {
	fingerprintConfirmGameCommand,
	type ConfirmGameCommand,
	validateConfirmGameCommand,
} from "./game-command";

interface SessionRow {
	id: string;
	owner_user_id: string;
	status: "open" | "active" | "closed";
	player_count: 3 | 4;
	rules_json: string;
	state_version: number;
}

interface MemberRow {
	user_id: string;
}

interface LatestGameRow {
	ordinal: number | null;
}

interface IdempotencyRow {
	scope: string;
	request_fingerprint: string | null;
	result_json: string | null;
}

interface SessionVersionRow {
	state_version: number;
}

type SessionEventType = "session.member_joined" | "session.draft_updated" | "session.game_confirmed" | "session.closed";

interface SessionSocketAttachment {
	userId: string;
}

export interface ConfirmedGame {
	id: string;
	ordinal: number;
	recordedAtMs: number;
	results: CalculatedGameResult[];
	sessionVersion: number;
}

export class GameConfirmationError extends Error {
	constructor(
		readonly code:
			| "SESSION_NOT_FOUND"
			| "NOT_A_MEMBER"
			| "SESSION_CLOSED"
			| "SESSION_NOT_READY"
			| "INVALID_RULES"
			| "INVALID_SCORES"
			| "IDEMPOTENCY_CONFLICT",
	) {
		super(code);
		this.name = "GameConfirmationError";
	}
}

export class SessionCloseError extends Error {
	constructor(readonly code: "SESSION_NOT_FOUND" | "NOT_SESSION_OWNER") {
		super(code);
		this.name = "SessionCloseError";
	}
}

function parseRules(value: string, playerCount: 3 | 4): ScoringRules | null {
	try {
		const parsed = JSON.parse(value) as Partial<ScoringRules>;
		if (
			parsed.playerCount !== playerCount ||
			!Number.isSafeInteger(parsed.baseScore) ||
			!Number.isSafeInteger(parsed.scoreMultiplierBasisPoints) ||
			typeof parsed.rankBonusesMilli !== "object" ||
			parsed.rankBonusesMilli === null ||
			Object.values(parsed.rankBonusesMilli).some((value) => !Number.isSafeInteger(value))
		) {
			return null;
		}

		return parsed as ScoringRules;
	} catch {
		return null;
	}
}

function parseStoredResult(value: string | null): ConfirmedGame | null {
	if (value === null) {
		return null;
	}

	try {
		const parsed = JSON.parse(value) as ConfirmedGame;
		return typeof parsed.id === "string" && Number.isSafeInteger(parsed.ordinal)
			? parsed
			: null;
	} catch {
		return null;
	}
}

/**
 * One instance is addressed by one game-session ID. The in-memory queue prevents
 * D1 I/O from interleaving two read/allocate/write result commands in that room.
 */
export class SessionRoom extends DurableObject<Env> {
	private writeTail: Promise<void> = Promise.resolve();

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
			return new Response("WebSocket upgrade required.", { status: 426 });
		}

		const sessionId = this.ctx.id.name;
		const userId = request.headers.get("X-Jong-Poi-User-Id");
		if (!sessionId || !userId) {
			return new Response("Forbidden.", { status: 403 });
		}

		const membership = await this.env.DB.prepare(
			"SELECT 1 AS is_member FROM session_members WHERE session_id = ? AND user_id = ? LIMIT 1",
		)
			.bind(sessionId, userId)
			.first<{ is_member: number }>();
		if (!membership) {
			return new Response("Forbidden.", { status: 403 });
		}

		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({ userId } satisfies SessionSocketAttachment);

		return new Response(null, { status: 101, webSocket: client });
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const previous = this.writeTail;
		let release: (() => void) | undefined;
		this.writeTail = new Promise<void>((resolve) => {
			release = resolve;
		});

		return previous
			.catch(() => undefined)
			.then(operation)
			.finally(() => release?.());
	}

	async confirmGame(command: ConfirmGameCommand): Promise<ConfirmedGame> {
		return this.enqueue(() => this.confirmGameExclusive(command));
	}

	async confirmDraftGame(requesterUserId: string, idempotencyKey: string): Promise<ConfirmedGame> {
		return this.enqueue(async () => {
			const sessionId = this.ctx.id.name;
			if (!sessionId) throw new GameConfirmationError("SESSION_NOT_FOUND");
			const session = await this.env.DB.prepare("SELECT owner_user_id, player_count FROM game_sessions WHERE id = ?").bind(sessionId).first<{ owner_user_id: string; player_count: number }>();
			if (!session) throw new GameConfirmationError("SESSION_NOT_FOUND");
			if (session.owner_user_id !== requesterUserId) throw new GameConfirmationError("NOT_A_MEMBER");
			const previous = await this.env.DB.prepare("SELECT scope, result_json FROM idempotency_keys WHERE key = ?").bind(idempotencyKey).first<{ scope: string; result_json: string | null }>();
			if (previous) {
				const result = parseStoredResult(previous.result_json);
				if (previous.scope !== `game-confirm:${sessionId}` || !result) throw new GameConfirmationError("IDEMPOTENCY_CONFLICT");
				return result;
			}
			const draft = await this.env.DB.prepare("SELECT user_id, final_score, rank FROM game_draft_entries WHERE session_id = ?").bind(sessionId).all<{ user_id: string; final_score: number; rank: number | null }>();
			if (draft.results.length !== session.player_count) throw new GameConfirmationError("SESSION_NOT_READY");
			const scores = draft.results.map((entry) => ({ userId: entry.user_id, finalScore: entry.final_score }));
			const ranks = calculateRanks(scores);
			if (draft.results.some((entry) => entry.rank !== null && entry.rank !== ranks.get(entry.user_id))) throw new GameConfirmationError("INVALID_SCORES");
			return this.confirmGameExclusive({ requesterUserId, idempotencyKey, scores }, true);
		});
	}

	async notifyDraftUpdated(): Promise<void> {
		this.broadcast("session.draft_updated", 0);
	}

	async closeSession(requesterUserId: string): Promise<void> {
		return this.enqueue(() => this.closeSessionExclusive(requesterUserId));
	}

	async notifyMemberJoined(): Promise<void> {
		const sessionId = this.ctx.id.name;
		if (!sessionId) return;
		const session = await this.env.DB.prepare(
			"SELECT state_version FROM game_sessions WHERE id = ?",
		)
			.bind(sessionId)
			.first<SessionVersionRow>();
		if (session) this.broadcast("session.member_joined", session.state_version);
	}

	webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
		if (message === "ping") socket.send("pong");
	}

	webSocketClose(socket: WebSocket, code: number, reason: string): void {
		socket.close(code, reason);
	}

	webSocketError(socket: WebSocket): void {
		socket.close(1011, "WebSocket error");
	}

	private broadcast(type: SessionEventType, version: number): void {
		const sessionId = this.ctx.id.name;
		if (!sessionId) return;
		const payload = JSON.stringify({
			type,
			sessionId,
			version,
			occurredAt: Date.now(),
		});
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(payload);
			} catch {
				// A disconnected socket is removed by the runtime.
			}
		}
	}

	private async closeSessionExclusive(requesterUserId: string): Promise<void> {
		const sessionId = this.ctx.id.name;
		if (!sessionId) {
			throw new SessionCloseError("SESSION_NOT_FOUND");
		}

		const session = await this.env.DB.prepare(
			`SELECT id, owner_user_id, status, player_count, rules_json, state_version
			 FROM game_sessions WHERE id = ?1`,
		)
			.bind(sessionId)
			.first<SessionRow>();
		if (!session) {
			throw new SessionCloseError("SESSION_NOT_FOUND");
		}
		if (session.owner_user_id !== requesterUserId) {
			throw new SessionCloseError("NOT_SESSION_OWNER");
		}
		if (session.status === "closed") {
			return;
		}

		const nowMs = Date.now();
		await this.env.DB.prepare(
			`UPDATE game_sessions
			 SET status = 'closed', closed_at_ms = ?2, updated_at_ms = ?2,
				 state_version = state_version + 1
			 WHERE id = ?1`,
		)
			.bind(sessionId, nowMs)
			.run();
		this.broadcast("session.closed", session.state_version + 1);
	}

	private async confirmGameExclusive(command: ConfirmGameCommand, clearDraft = false): Promise<ConfirmedGame> {
		validateConfirmGameCommand(command);
		const sessionId = this.ctx.id.name;
		if (!sessionId) {
			throw new GameConfirmationError("SESSION_NOT_FOUND");
		}

		const nowMs = Date.now();
		const scope = `game-confirm:${sessionId}`;
		const fingerprint = fingerprintConfirmGameCommand(command);
		const existing = await this.env.DB.prepare(
			"SELECT scope, request_fingerprint, result_json FROM idempotency_keys WHERE key = ?1",
		)
			.bind(command.idempotencyKey)
			.first<IdempotencyRow>();
		if (existing) {
			const stored = parseStoredResult(existing.result_json);
			if (existing.scope !== scope || existing.request_fingerprint !== fingerprint || !stored) {
				throw new GameConfirmationError("IDEMPOTENCY_CONFLICT");
			}
			return stored;
		}

		const session = await this.env.DB.prepare(
			`SELECT id, owner_user_id, status, player_count, rules_json, state_version
			 FROM game_sessions WHERE id = ?1`,
		)
			.bind(sessionId)
			.first<SessionRow>();
		if (!session) {
			throw new GameConfirmationError("SESSION_NOT_FOUND");
		}
		if (session.status === "closed") {
			throw new GameConfirmationError("SESSION_CLOSED");
		}

		const members = await this.env.DB.prepare(
			"SELECT user_id FROM session_members WHERE session_id = ?1 ORDER BY seat_index ASC",
		)
			.bind(sessionId)
			.all<MemberRow>();
		const memberIds = members.results.map((member) => member.user_id);
		if (!memberIds.includes(command.requesterUserId)) {
			throw new GameConfirmationError("NOT_A_MEMBER");
		}
		if (memberIds.length !== session.player_count) {
			throw new GameConfirmationError("SESSION_NOT_READY");
		}

		const rules = parseRules(session.rules_json, session.player_count);
		if (!rules) {
			throw new GameConfirmationError("INVALID_RULES");
		}

		let results: CalculatedGameResult[];
		try {
			results = calculateGameResults(rules, memberIds, command.scores);
		} catch (error) {
			if (error instanceof ScoringValidationError) {
				throw new GameConfirmationError("INVALID_SCORES");
			}
			throw error;
		}

		const latest = await this.env.DB.prepare(
			"SELECT MAX(ordinal) AS ordinal FROM games WHERE session_id = ?1",
		)
			.bind(sessionId)
			.first<LatestGameRow>();
		const game: ConfirmedGame = {
			id: crypto.randomUUID(),
			ordinal: (latest?.ordinal ?? 0) + 1,
			recordedAtMs: nowMs,
			results,
			sessionVersion: session.state_version + 1,
		};

		await this.env.DB.batch([
			this.env.DB.prepare(
				`INSERT INTO idempotency_keys
				 (key, scope, request_fingerprint, result_json, created_at_ms, expires_at_ms)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
			)
				.bind(
					command.idempotencyKey,
					scope,
					fingerprint,
					JSON.stringify(game),
					nowMs,
					nowMs + 24 * 60 * 60 * 1_000,
				),
			this.env.DB.prepare(
				`INSERT INTO games (id, session_id, ordinal, recorded_by_user_id, played_at_ms, created_at_ms)
				 VALUES (?1, ?2, ?3, ?4, ?5, ?5)`,
			)
				.bind(game.id, sessionId, game.ordinal, command.requesterUserId, nowMs),
			...game.results.map((result) =>
				this.env.DB
					.prepare(
						`INSERT INTO game_results
						 (game_id, user_id, final_score, rank, score_difference, score_points_milli,
						  rank_bonus_milli, points_milli, created_at_ms)
						 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
					)
					.bind(
						game.id,
						result.userId,
						result.finalScore,
						result.rank,
						result.scoreDifference,
						result.scorePointsMilli,
						result.rankBonusMilli,
						result.pointsMilli,
						nowMs,
					),
			),
			this.env.DB.prepare(
				`UPDATE game_sessions
				 SET status = 'active', state_version = ?2, updated_at_ms = ?3
				 WHERE id = ?1`,
			)
				.bind(sessionId, game.sessionVersion, nowMs),
			...(clearDraft ? [this.env.DB.prepare("DELETE FROM game_draft_entries WHERE session_id = ?").bind(sessionId)] : []),
		]);
		this.broadcast("session.game_confirmed", game.sessionVersion);

		return game;
	}
}
