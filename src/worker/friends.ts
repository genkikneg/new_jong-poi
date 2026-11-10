export interface FriendSummary {
	id: string;
	userId: string;
	displayName: string;
	avatarUpdatedAtMs: number | null;
	totalPointsMilli: number;
}

export type UserRelation = "self" | "friend" | "pending_outgoing" | "pending_incoming" | "none";

export async function getUserDetail(db: D1Database, viewerId: string, userId: string): Promise<{ user: FriendSummary; relation: UserRelation } | null> {
	const row = await db.prepare(
		`SELECT user.id, user.user_id, user.display_name, avatar.updated_at_ms AS avatar_updated_at_ms,
			COALESCE(SUM(result.points_milli), 0) AS total_points_milli
		 FROM users AS user
		 LEFT JOIN user_avatars AS avatar ON avatar.user_id = user.id
		 LEFT JOIN game_results AS result ON result.user_id = user.id
		 LEFT JOIN games AS game ON game.id = result.game_id
		 LEFT JOIN game_sessions AS session ON session.id = game.session_id
		 WHERE user.id = ?
		 GROUP BY user.id, user.user_id, user.display_name, avatar.updated_at_ms`,
	).bind(userId).first<FriendRow>();
	if (!row) return null;
	if (viewerId === userId) return { user: mapFriend(row), relation: "self" };
	const friendship = await db.prepare("SELECT 1 AS found FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)").bind(viewerId, userId, userId, viewerId).first();
	if (friendship) return { user: mapFriend(row), relation: "friend" };
	const outgoing = await db.prepare("SELECT 1 AS found FROM friend_requests WHERE sender_id = ? AND recipient_id = ? AND responded_at_ms IS NULL").bind(viewerId, userId).first();
	if (outgoing) return { user: mapFriend(row), relation: "pending_outgoing" };
	const incoming = await db.prepare("SELECT 1 AS found FROM friend_requests WHERE sender_id = ? AND recipient_id = ? AND responded_at_ms IS NULL").bind(userId, viewerId).first();
	return { user: mapFriend(row), relation: incoming ? "pending_incoming" : "none" };
}

export interface FriendRequestSummary {
	id: string;
	createdAtMs: number;
	user: Pick<FriendSummary, "id" | "userId" | "displayName" | "avatarUpdatedAtMs">;
}

interface FriendRow {
	id: string;
	user_id: string;
	display_name: string;
	avatar_updated_at_ms: number | null;
	total_points_milli: number;
}

interface FriendRequestRow {
	id: string;
	created_at_ms: number;
	user_id: string;
	public_user_id: string;
	display_name: string;
	avatar_updated_at_ms: number | null;
}

interface RequestRow { id: string; sender_id: string; recipient_id: string; }

export class FriendInputError extends Error {
	constructor(readonly code: "INVALID_USER_ID" | "USER_NOT_FOUND" | "CANNOT_FRIEND_SELF" | "ALREADY_FRIENDS" | "REQUEST_EXISTS" | "REQUEST_NOT_FOUND") {
		super(code);
		this.name = "FriendInputError";
	}
}

function mapFriend(row: FriendRow): FriendSummary {
	return { id: row.id, userId: row.user_id, displayName: row.display_name, avatarUpdatedAtMs: row.avatar_updated_at_ms, totalPointsMilli: row.total_points_milli };
}

function mapRequest(row: FriendRequestRow): FriendRequestSummary {
	return {
		id: row.id,
		createdAtMs: row.created_at_ms,
		user: { id: row.user_id, userId: row.public_user_id, displayName: row.display_name, avatarUpdatedAtMs: row.avatar_updated_at_ms },
	};
}

export async function listFriends(db: D1Database, userId: string): Promise<{ friends: FriendSummary[]; incoming: FriendRequestSummary[]; outgoing: FriendRequestSummary[] }> {
	const [friends, incoming, outgoing] = await Promise.all([
		db.prepare(
			`SELECT user.id, user.user_id, user.display_name, avatar.updated_at_ms AS avatar_updated_at_ms,
					COALESCE(SUM(CASE WHEN session.status = 'closed' THEN result.points_milli ELSE 0 END), 0) AS total_points_milli
			 FROM friendships AS friendship
			 INNER JOIN users AS user ON user.id = CASE WHEN friendship.user_id = ? THEN friendship.friend_id ELSE friendship.user_id END
			 LEFT JOIN user_avatars AS avatar ON avatar.user_id = user.id
			 LEFT JOIN game_results AS result ON result.user_id = user.id
			 LEFT JOIN games AS game ON game.id = result.game_id
			 LEFT JOIN game_sessions AS session ON session.id = game.session_id
			 WHERE friendship.user_id = ? OR friendship.friend_id = ?
			 GROUP BY user.id, user.user_id, user.display_name, avatar.updated_at_ms
			 ORDER BY user.display_name COLLATE NOCASE ASC`,
		).bind(userId, userId, userId).all<FriendRow>(),
		db.prepare(
			`SELECT request.id, request.created_at_ms, sender.id AS user_id, sender.user_id AS public_user_id,
					sender.display_name, avatar.updated_at_ms AS avatar_updated_at_ms
			 FROM friend_requests AS request
			 INNER JOIN users AS sender ON sender.id = request.sender_id
			 LEFT JOIN user_avatars AS avatar ON avatar.user_id = sender.id
			 WHERE request.recipient_id = ? AND request.responded_at_ms IS NULL
			 ORDER BY request.created_at_ms DESC`,
		).bind(userId).all<FriendRequestRow>(),
		db.prepare(
			`SELECT request.id, request.created_at_ms, recipient.id AS user_id, recipient.user_id AS public_user_id,
					recipient.display_name, avatar.updated_at_ms AS avatar_updated_at_ms
			 FROM friend_requests AS request
			 INNER JOIN users AS recipient ON recipient.id = request.recipient_id
			 LEFT JOIN user_avatars AS avatar ON avatar.user_id = recipient.id
			 WHERE request.sender_id = ? AND request.responded_at_ms IS NULL
			 ORDER BY request.created_at_ms DESC`,
		).bind(userId).all<FriendRequestRow>(),
	]);
	return { friends: friends.results.map(mapFriend), incoming: incoming.results.map(mapRequest), outgoing: outgoing.results.map(mapRequest) };
}

export async function getFriend(db: D1Database, userId: string, friendId: string): Promise<FriendSummary | null> {
	const row = await db.prepare(
		`SELECT user.id, user.user_id, user.display_name, avatar.updated_at_ms AS avatar_updated_at_ms,
			COALESCE(SUM(CASE WHEN session.status = 'closed' THEN result.points_milli ELSE 0 END), 0) AS total_points_milli
		 FROM friendships AS friendship
		 INNER JOIN users AS user ON user.id = ?
		 LEFT JOIN user_avatars AS avatar ON avatar.user_id = user.id
		 LEFT JOIN game_results AS result ON result.user_id = user.id
		 LEFT JOIN games AS game ON game.id = result.game_id
		 LEFT JOIN game_sessions AS session ON session.id = game.session_id
		 WHERE ((friendship.user_id = ? AND friendship.friend_id = ?) OR (friendship.friend_id = ? AND friendship.user_id = ?))
		 GROUP BY user.id, user.user_id, user.display_name, avatar.updated_at_ms`,
	).bind(friendId, userId, friendId, userId, friendId).first<FriendRow>();
	return row ? mapFriend(row) : null;
}

export async function sendFriendRequest(db: D1Database, senderId: string, inputUserId: unknown, nowMs = Date.now()): Promise<void> {
	if (typeof inputUserId !== "string" || !/^[A-Za-z0-9_-]{3,32}$/.test(inputUserId.trim())) throw new FriendInputError("INVALID_USER_ID");
	const recipient = await db.prepare("SELECT id FROM users WHERE user_id = ? LIMIT 1").bind(inputUserId.trim()).first<{ id: string }>();
	if (!recipient) throw new FriendInputError("USER_NOT_FOUND");
	if (recipient.id === senderId) throw new FriendInputError("CANNOT_FRIEND_SELF");
	const [friendship, request] = await Promise.all([
		db.prepare("SELECT 1 AS found FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?) LIMIT 1").bind(senderId, recipient.id, recipient.id, senderId).first(),
		db.prepare("SELECT 1 AS found FROM friend_requests WHERE responded_at_ms IS NULL AND ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)) LIMIT 1").bind(senderId, recipient.id, recipient.id, senderId).first(),
	]);
	if (friendship) throw new FriendInputError("ALREADY_FRIENDS");
	if (request) throw new FriendInputError("REQUEST_EXISTS");
	await db.prepare("INSERT INTO friend_requests (id, sender_id, recipient_id, created_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?)")
		.bind(crypto.randomUUID(), senderId, recipient.id, nowMs, nowMs + 30 * 24 * 60 * 60 * 1000).run();
}

export async function acceptFriendRequest(db: D1Database, recipientId: string, requestId: string, nowMs = Date.now()): Promise<void> {
	const request = await db.prepare("SELECT id, sender_id, recipient_id FROM friend_requests WHERE id = ? AND recipient_id = ? AND responded_at_ms IS NULL LIMIT 1")
		.bind(requestId, recipientId).first<RequestRow>();
	if (!request) throw new FriendInputError("REQUEST_NOT_FOUND");
	const [firstId, secondId] = request.sender_id < request.recipient_id ? [request.sender_id, request.recipient_id] : [request.recipient_id, request.sender_id];
	await db.batch([
		db.prepare("INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at_ms) VALUES (?, ?, ?)").bind(firstId, secondId, nowMs),
		db.prepare("UPDATE friend_requests SET responded_at_ms = ? WHERE id = ? AND responded_at_ms IS NULL").bind(nowMs, request.id),
	]);
}

export async function cancelFriendRequest(db: D1Database, userId: string, requestId: string, nowMs = Date.now()): Promise<void> {
	const result = await db.prepare(
		"UPDATE friend_requests SET responded_at_ms = ? WHERE id = ? AND responded_at_ms IS NULL AND (sender_id = ? OR recipient_id = ?)",
	).bind(nowMs, requestId, userId, userId).run();
	if (result.meta.changes !== 1) throw new FriendInputError("REQUEST_NOT_FOUND");
}
