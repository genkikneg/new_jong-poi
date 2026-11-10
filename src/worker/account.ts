export async function deleteAccount(
	db: D1Database,
	userId: string,
	nowMs = Date.now(),
): Promise<void> {
	const deletedPublicId = `deleted_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
	await db.batch([
		db.prepare("UPDATE game_sessions SET status = 'closed', closed_at_ms = COALESCE(closed_at_ms, ?), updated_at_ms = ? WHERE status <> 'closed' AND id IN (SELECT session_id FROM session_members WHERE user_id = ?)").bind(nowMs, nowMs, userId),
		db.prepare("DELETE FROM game_draft_entries WHERE session_id IN (SELECT session_id FROM session_members WHERE user_id = ?)").bind(userId),
		db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId),
		db.prepare("DELETE FROM auth_recovery_codes WHERE user_id = ?").bind(userId),
		db.prepare("DELETE FROM webauthn_credentials WHERE user_id = ?").bind(userId),
		db.prepare("DELETE FROM webauthn_challenges WHERE user_id = ?").bind(userId),
		db.prepare("DELETE FROM password_login_challenges WHERE user_id = ?").bind(userId),
		db.prepare("DELETE FROM friend_requests WHERE sender_id = ? OR recipient_id = ?").bind(userId, userId),
		db.prepare("DELETE FROM friendships WHERE user_id = ? OR friend_id = ?").bind(userId, userId),
		db.prepare("DELETE FROM user_avatars WHERE user_id = ?").bind(userId),
		db.prepare("UPDATE users SET user_id = ?, display_name = '退会済みユーザー', legacy_password_hash = NULL, legacy_login_id = NULL, updated_at_ms = ? WHERE id = ?").bind(deletedPublicId, nowMs, userId),
	]);
}
