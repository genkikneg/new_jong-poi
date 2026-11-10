import { Hono } from "hono";
import { deleteAccount } from "./account";
import {
	AvatarInputError,
	deleteAvatar,
	getAvatar,
	readAvatarBody,
	saveAvatar,
} from "./avatar";
import { getWebAuthnConfig } from "./auth/config";
import {
	beginPasskeyLogin,
	completePasskeyLogin,
	LoginError,
} from "./auth/login";
import {
	beginPasswordLogin,
	completePasswordLogin,
	PasswordLoginError,
} from "./auth/password";
import {
	beginPasskeyMigration,
	completePasskeyMigration,
	getPasskeyMigrationStatus,
	PasskeyMigrationError,
} from "./auth/passkey-migration";
import {
	beginPasskeyRegistration,
	RegistrationInputError,
} from "./auth/register";
import {
	completePasskeyRegistration,
	RegistrationVerificationError,
} from "./auth/register-verify";
import {
	buildExpiredSessionCookie,
	buildSessionCookie,
	findAuthenticatedSessionFromRequest,
	readSessionToken,
	revokeSession,
} from "./auth/session";
import { isDatabaseAvailable } from "./database-health";
import {
	acceptFriendRequest,
	cancelFriendRequest,
	FriendInputError,
	getFriend,
	getUserDetail,
	listFriends,
	sendFriendRequest,
} from "./friends";
import { GameDraftError, listGameDraft, saveGameDraft } from "./game-draft";
import { isRankingPeriod, listRankings } from "./rankings";
import { ProfileInputError, updateProfile } from "./profile";
import { isAllowedApiRequest, isSameOriginRequest } from "./security";
import { getPlayerStats } from "./stats";
import {
	GameConfirmationError,
	SessionCloseError,
	SessionRoom,
} from "./session-room";
import {
	createSession,
	getSessionDetail,
	joinSessionByCode,
	listUserHistory,
	listUserSessions,
	SessionInputError,
	SessionJoinError,
	SessionNotFoundError,
} from "./sessions";

const app = new Hono<{ Bindings: Env }>();


app.use("/api/*", async (c, next) => {
	if (!isAllowedApiRequest(c.req.raw)) {
		return c.json({ error: "cross_site_request" }, 403);
	}
	await next();
});

app.get("/api/health", async (c) => {
	try {
		const databaseAvailable = await isDatabaseAvailable(c.env.DB);
		if (!databaseAvailable) {
			return c.json(
				{
					service: "jong-poi",
					status: "unavailable",
					database: "unavailable",
				},
				503,
			);
		}

		return c.json({
			service: "jong-poi",
			status: "ok",
			database: "ok",
		});
	} catch {
		return c.json(
			{
				service: "jong-poi",
				status: "unavailable",
				database: "unavailable",
			},
			503,
		);
	}
});

app.get("/api/me", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) {
		return c.json({ error: "unauthenticated" }, 401);
	}

	return c.json({ user: session.user });
});

app.post("/api/auth/logout", async (c) => {
	const token = readSessionToken(c.req.header("Cookie") ?? null);
	if (token) await revokeSession(c.env.DB, token);
	c.header("Set-Cookie", buildExpiredSessionCookie());
	return c.body(null, 204);
});

app.patch("/api/me", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	try {
		const body = await c.req.json<{ displayName?: unknown; userId?: unknown }>();
		return c.json({ user: await updateProfile(c.env.DB, session.user.id, body) });
	} catch (error) {
		if (error instanceof ProfileInputError) {
			return c.json({ error: error.code.toLowerCase() }, 400);
		}
		return c.json({ error: "profile_unavailable" }, 503);
	}
});

app.delete("/api/me", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	try {
		await deleteAccount(c.env.DB, session.user.id);
		c.header("Set-Cookie", buildExpiredSessionCookie());
		return c.body(null, 204);
	} catch {
		return c.json({ error: "account_deletion_unavailable" }, 503);
	}
});

app.put("/api/me/avatar", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);

	try {
		const contentType = c.req.header("Content-Type")?.split(";", 1)[0]?.trim() ?? "";
		const updatedAtMs = await saveAvatar(
			c.env.DB,
			session.user.id,
			contentType,
			await readAvatarBody(c.req.raw),
		);
		return c.json({ avatarUpdatedAtMs: updatedAtMs });
	} catch (error) {
		if (error instanceof AvatarInputError) {
			const status = error.code === "FILE_TOO_LARGE" ? 413 : error.code === "UNSUPPORTED_TYPE" ? 415 : 400;
			return c.json({ error: error.code.toLowerCase() }, status);
		}
		return c.json({ error: "avatar_unavailable" }, 503);
	}
});

app.delete("/api/me/avatar", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	await deleteAvatar(c.env.DB, session.user.id);
	return c.body(null, 204);
});

app.get("/api/users/:userId/avatar", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	const avatar = await getAvatar(c.env.DB, c.req.param("userId"));
	if (!avatar) return c.json({ error: "avatar_not_found" }, 404);

	const etag = `W/"${avatar.updatedAtMs}"`;
	if (c.req.header("If-None-Match") === etag) {
		return new Response(null, { status: 304, headers: { ETag: etag } });
	}
	return new Response(avatar.bytes.slice().buffer, {
		headers: {
			"Content-Type": avatar.contentType,
			"Cache-Control": "private, max-age=300",
			"X-Content-Type-Options": "nosniff",
			ETag: etag,
		},
	});
});

app.post("/api/auth/register/options", async (c) => {
	try {
		const body = await c.req.json<{ userId?: unknown; displayName?: unknown }>();
		if (typeof body.userId !== "string" || typeof body.displayName !== "string") {
			return c.json({ error: "invalid_registration_input" }, 400);
		}

		const result = await beginPasskeyRegistration(
			c.env.DB,
			getWebAuthnConfig(c.env),
			{ userId: body.userId, displayName: body.displayName },
		);

		return c.json(result, 201);
	} catch (error) {
		if (error instanceof RegistrationInputError) {
			return c.json({ error: error.code.toLowerCase() }, error.code === "USER_ID_TAKEN" ? 409 : 400);
		}

		return c.json({ error: "registration_unavailable" }, 503);
	}
});

app.post("/api/auth/register/verify", async (c) => {
	try {
		const body = await c.req.json<{ challengeId?: unknown; response?: unknown }>();
		if (typeof body.challengeId !== "string" || typeof body.response !== "object" || body.response === null) {
			return c.json({ error: "invalid_registration_response" }, 400);
		}

		const result = await completePasskeyRegistration(
			c.env.DB,
			getWebAuthnConfig(c.env),
			body.challengeId,
			body.response as Parameters<typeof completePasskeyRegistration>[3],
		);

		c.header("Set-Cookie", buildSessionCookie(result.session.token, result.session.expiresAtMs));
		return c.json({ user: result.user }, 201);
	} catch (error) {
		if (error instanceof RegistrationVerificationError) {
			return c.json({ error: "invalid_registration_response" }, 400);
		}

		return c.json({ error: "registration_unavailable" }, 503);
	}
});

app.post("/api/auth/login/options", async (c) => {
	try {
		return c.json(
			await beginPasskeyLogin(c.env.DB, getWebAuthnConfig(c.env)),
		);
	} catch (error) {
		if (error instanceof LoginError) {
			return c.json({ error: "invalid_login" }, 400);
		}

		return c.json({ error: "login_unavailable" }, 503);
	}
});

app.post("/api/auth/login/verify", async (c) => {
	try {
		const body = await c.req.json<{ challengeId?: unknown; response?: unknown }>();
		if (typeof body.challengeId !== "string" || typeof body.response !== "object" || body.response === null) {
			return c.json({ error: "invalid_login" }, 400);
		}

		const result = await completePasskeyLogin(
			c.env.DB,
			getWebAuthnConfig(c.env),
			body.challengeId,
			body.response as Parameters<typeof completePasskeyLogin>[3],
		);

		c.header("Set-Cookie", buildSessionCookie(result.session.token, result.session.expiresAtMs));
		return c.json({ user: result.user });
	} catch (error) {
		if (error instanceof LoginError) {
			return c.json({ error: "invalid_login" }, 400);
		}

		return c.json({ error: "login_unavailable" }, 503);
	}
});

app.post("/api/auth/password/options", async (c) => {
	try {
		const body = await c.req.json<{ userId?: unknown }>();
		if (typeof body.userId !== "string") throw new PasswordLoginError();
		return c.json(await beginPasswordLogin(c.env.DB, body.userId));
	} catch (error) {
		if (error instanceof PasswordLoginError) return c.json({ error: "invalid_login" }, 400);
		return c.json({ error: "login_unavailable" }, 503);
	}
});

app.post("/api/auth/password/verify", async (c) => {
	try {
		const body = await c.req.json<{ challengeId?: unknown; proof?: unknown }>();
		if (typeof body.challengeId !== "string" || typeof body.proof !== "string") throw new PasswordLoginError();
		const result = await completePasswordLogin(c.env.DB, body.challengeId, body.proof);
		c.header("Set-Cookie", buildSessionCookie(result.session.token, result.session.expiresAtMs));
		return c.json({ user: result.user });
	} catch (error) {
		if (error instanceof PasswordLoginError) return c.json({ error: "invalid_login" }, 401);
		return c.json({ error: "login_unavailable" }, 503);
	}
});

app.get("/api/auth/passkey-migration", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	return c.json(await getPasskeyMigrationStatus(c.env.DB, session.user.id));
});

app.post("/api/auth/passkey-migration/options", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	try {
		const body = await c.req.json<{ userId?: unknown }>();
		if (typeof body.userId !== "string") throw new PasskeyMigrationError("INVALID_USER_ID");
		return c.json(await beginPasskeyMigration(c.env.DB, getWebAuthnConfig(c.env), session.user.id, body.userId));
	} catch (error) {
		if (error instanceof PasskeyMigrationError) return c.json({ error: error.code.toLowerCase() }, ["USER_ID_TAKEN", "MIGRATION_NOT_AVAILABLE"].includes(error.code) ? 409 : 400);
		return c.json({ error: "migration_unavailable" }, 503);
	}
});

app.post("/api/auth/passkey-migration/verify", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	try {
		const body = await c.req.json<{ challengeId?: unknown; response?: unknown }>();
		if (typeof body.challengeId !== "string" || typeof body.response !== "object" || body.response === null) throw new PasskeyMigrationError("INVALID_MIGRATION_RESPONSE");
		await completePasskeyMigration(c.env.DB, getWebAuthnConfig(c.env), session.user.id, body.challengeId, body.response as Parameters<typeof completePasskeyMigration>[4]);
		return c.json({ migrated: true });
	} catch (error) {
		if (error instanceof PasskeyMigrationError) return c.json({ error: error.code.toLowerCase() }, error.code === "USER_ID_TAKEN" ? 409 : 400);
		return c.json({ error: "migration_unavailable" }, 503);
	}
});

app.get("/api/sessions", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) {
		return c.json({ error: "unauthenticated" }, 401);
	}

	return c.json({ sessions: await listUserSessions(c.env.DB, session.user.id) });
});

app.get("/api/history", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) {
		return c.json({ error: "unauthenticated" }, 401);
	}

	return c.json({ sessions: await listUserHistory(c.env.DB, session.user.id) });
});

app.get("/api/rankings", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) {
		return c.json({ error: "unauthenticated" }, 401);
	}

	const requestedPeriod = c.req.query("period");
	const period = isRankingPeriod(requestedPeriod) ? requestedPeriod : "all";
	return c.json({ period, rankings: await listRankings(c.env.DB, period) });
});

app.get("/api/stats", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	const requestedPeriod = c.req.query("period");
	const period = isRankingPeriod(requestedPeriod) ? requestedPeriod : "all";
	return c.json({ stats: await getPlayerStats(c.env.DB, session.user.id, period) });
});

app.get("/api/friends", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	return c.json(await listFriends(c.env.DB, session.user.id));
});

app.get("/api/friends/:friendId", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	const friend = await getFriend(c.env.DB, session.user.id, c.req.param("friendId"));
	if (!friend) return c.json({ error: "friend_not_found" }, 404);
	return c.json({ friend, stats: await getPlayerStats(c.env.DB, friend.id, "all") });
});

app.get("/api/users/:userId/detail", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	const detail = await getUserDetail(c.env.DB, session.user.id, c.req.param("userId"));
	if (!detail) return c.json({ error: "user_not_found" }, 404);
	return c.json({ ...detail, stats: await getPlayerStats(c.env.DB, detail.user.id, "all", Date.now(), true) });
});


app.post("/api/friend-requests", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	try {
		const body = await c.req.json<{ userId?: unknown }>();
		await sendFriendRequest(c.env.DB, session.user.id, body.userId);
		return c.body(null, 204);
	} catch (error) {
		if (error instanceof FriendInputError) {
			const status = error.code === "INVALID_USER_ID" ? 400 : error.code === "USER_NOT_FOUND" ? 404 : 409;
			return c.json({ error: error.code.toLowerCase() }, status);
		}
		return c.json({ error: "friend_request_unavailable" }, 503);
	}
});

app.patch("/api/friend-requests/:requestId/accept", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	try {
		await acceptFriendRequest(c.env.DB, session.user.id, c.req.param("requestId"));
		return c.body(null, 204);
	} catch (error) {
		if (error instanceof FriendInputError) return c.json({ error: error.code.toLowerCase() }, 404);
		return c.json({ error: "friend_request_unavailable" }, 503);
	}
});

app.delete("/api/friend-requests/:requestId", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	try {
		await cancelFriendRequest(c.env.DB, session.user.id, c.req.param("requestId"));
		return c.body(null, 204);
	} catch (error) {
		if (error instanceof FriendInputError) return c.json({ error: error.code.toLowerCase() }, 404);
		return c.json({ error: "friend_request_unavailable" }, 503);
	}
});

app.get("/api/sessions/:sessionId", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) {
		return c.json({ error: "unauthenticated" }, 401);
	}

	try {
		return c.json({
			session: await getSessionDetail(c.env.DB, session.user.id, c.req.param("sessionId")),
		});
	} catch (error) {
		if (error instanceof SessionNotFoundError) {
			return c.json({ error: "session_not_found" }, 404);
		}
		return c.json({ error: "session_unavailable" }, 503);
	}
});

app.post("/api/sessions", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) {
		return c.json({ error: "unauthenticated" }, 401);
	}

	try {
		const body = await c.req.json<{ name?: unknown; playerCount?: unknown; friendIds?: unknown; rules?: unknown }>();
		if (
			(body.name !== undefined && typeof body.name !== "string") ||
			(body.playerCount !== undefined && typeof body.playerCount !== "number") ||
			(body.friendIds !== undefined && (!Array.isArray(body.friendIds) || body.friendIds.some((id) => typeof id !== "string"))) ||
			(body.rules !== undefined && (typeof body.rules !== "object" || body.rules === null))
		) {
			return c.json({ error: "invalid_session_input" }, 400);
		}

		const created = await createSession(c.env.DB, session.user.id, {
			name: body.name,
			playerCount: body.playerCount,
			friendIds: body.friendIds as string[] | undefined,
			rules: body.rules as Parameters<typeof createSession>[2]["rules"],
		});
		return c.json({ session: created }, 201);
	} catch (error) {
		if (error instanceof SessionInputError) {
			return c.json({ error: "invalid_session_input" }, 400);
		}

		return c.json({ error: "session_unavailable" }, 503);
	}
});

app.post("/api/sessions/join", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) {
		return c.json({ error: "unauthenticated" }, 401);
	}

	try {
		const body = await c.req.json<{ joinCode?: unknown }>();
		if (typeof body.joinCode !== "string") {
			return c.json({ error: "cannot_join_session" }, 400);
		}

		const sessionId = await joinSessionByCode(c.env.DB, session.user.id, body.joinCode);
		await c.env.SESSION_ROOM.getByName(sessionId).notifyMemberJoined().catch(() => undefined);
		return c.json({ sessionId });
	} catch (error) {
		if (error instanceof SessionJoinError) {
			return c.json({ error: "cannot_join_session" }, 409);
		}

		return c.json({ error: "session_unavailable" }, 503);
	}
});

app.post("/api/sessions/:sessionId/close", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) {
		return c.json({ error: "unauthenticated" }, 401);
	}

	try {
		await c.env.SESSION_ROOM.getByName(c.req.param("sessionId")).closeSession(session.user.id);
		return c.body(null, 204);
	} catch (error) {
		if (error instanceof SessionCloseError) {
			return c.json(
				{ error: error.code.toLowerCase() },
				error.code === "SESSION_NOT_FOUND" ? 404 : 403,
			);
		}

		return c.json({ error: "session_unavailable" }, 503);
	}
});

app.get("/api/sessions/:sessionId/draft", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	try { return c.json({ entries: await listGameDraft(c.env.DB, c.req.param("sessionId"), session.user.id) }); }
	catch (error) { if (error instanceof GameDraftError) return c.json({ error: error.code.toLowerCase() }, 403); throw error; }
});

app.put("/api/sessions/:sessionId/draft", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	const body = await c.req.json<{ finalScore?: unknown; rank?: unknown }>();
	try {
		await saveGameDraft(c.env.DB, c.req.param("sessionId"), session.user.id, body.finalScore as number, body.rank === undefined || body.rank === null ? null : body.rank as number);
		await c.env.SESSION_ROOM.getByName(c.req.param("sessionId")).notifyDraftUpdated();
		return c.body(null, 204);
	} catch (error) { if (error instanceof GameDraftError) return c.json({ error: error.code.toLowerCase() }, error.code === "INVALID_SCORE" ? 400 : 403); throw error; }
});

app.post("/api/sessions/:sessionId/games/confirm", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	const key = c.req.header("Idempotency-Key");
	if (!key) return c.json({ error: "invalid_game_input" }, 400);
	try {
		const game = await c.env.SESSION_ROOM.getByName(c.req.param("sessionId")).confirmDraftGame(session.user.id, key);
		return c.json({ game }, 201);
	} catch (error) {
		if (error instanceof GameConfirmationError) return c.json({ error: error.code.toLowerCase() }, error.code === "SESSION_NOT_FOUND" ? 404 : error.code === "NOT_A_MEMBER" ? 403 : 422);
		return c.json({ error: "game_confirmation_unavailable" }, 503);
	}
});

app.post("/api/sessions/:sessionId/games", async (c) => {
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) return c.json({ error: "unauthenticated" }, 401);
	return c.json({ error: "use_game_draft" }, 410);
});

app.get("/ws/sessions/:sessionId", async (c) => {
	if (!isSameOriginRequest(c.req.raw)) {
		return c.json({ error: "cross_site_request" }, 403);
	}
	const session = await findAuthenticatedSessionFromRequest(c.env.DB, c.req.raw);
	if (!session) {
		return c.json({ error: "unauthenticated" }, 401);
	}

	const sessionId = c.req.param("sessionId");
	try {
		await getSessionDetail(c.env.DB, session.user.id, sessionId);
	} catch (error) {
		if (error instanceof SessionNotFoundError) {
			return c.json({ error: "session_not_found" }, 404);
		}
		return c.json({ error: "session_unavailable" }, 503);
	}

	const headers = new Headers(c.req.raw.headers);
	headers.set("X-Jong-Poi-User-Id", session.user.id);
	return c.env.SESSION_ROOM.getByName(sessionId).fetch(
		new Request(c.req.raw, { headers }),
	);
});

app.notFound((c) => c.json({ error: "not_found" }, 404));

export { SessionRoom };
export default app;
