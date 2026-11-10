import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const sshHost = process.env.LEGACY_SSH_HOST || "genki";
const dbContainer = process.env.LEGACY_DB_CONTAINER || "jong-poi-db-1";
const output = resolve(process.argv[2] || ".migration-work/legacy-import.sql");

const query = `
SELECT JSON_OBJECT('type','user','id',id,'name',name,'login_id',user_id,'password_hash',password,'created_at',created_at,'updated_at',updated_at) FROM users;
SELECT JSON_OBJECT('type','friend_request','id',id,'sender_id',sender_id,'recipient_id',recipient_id,'status',status,'created_at',created_at,'updated_at',updated_at) FROM friend_requests;
SELECT JSON_OBJECT('type','friendship','id',id,'user_id',user_id,'friend_id',friend_id,'created_at',created_at) FROM friendships;
SELECT JSON_OBJECT('type','session','id',id,'owner_id',owner_id,'name',name,'player_count',player_count,'status',status,'join_code',join_code,'rule_base',rule_base,'rule_k',rule_k,'rule_rank_bonus',rule_rank_bonus,'created_at',created_at,'updated_at',updated_at,'closed_at',closed_at) FROM mahjong_sessions;
SELECT JSON_OBJECT('type','member','session_id',session_id,'user_id',user_id,'seat_index',seat_index,'joined_at',joined_at,'created_at',created_at) FROM session_members;
SELECT JSON_OBJECT('type','game','id',id,'session_id',session_id,'created_by',created_by,'ordinal',ordinal,'played_at',played_at,'created_at',created_at) FROM games;
SELECT JSON_OBJECT('type','result','game_id',game_id,'user_id',user_id,'final_score',final_score,'rank',\`rank\`,'points',points,'score_diff',score_diff,'score_diff_scaled',score_diff_scaled,'rank_bonus',rank_bonus,'created_at',created_at) FROM game_results;
SELECT JSON_OBJECT('type','draft_entry','session_id',e.session_id,'user_id',e.user_id,'final_score',e.final_score,'rank',e.\`rank\`,'updated_at',e.updated_at,'created_at',e.created_at) FROM session_game_draft_entries e;
`;

const remote = `docker exec -i ${dbContainer} sh -lc 'exec mysql --default-character-set=utf8mb4 --raw --batch --skip-column-names -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'`;
const result = spawnSync("ssh", [sshHost, remote], { input: query, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
if (result.status !== 0) throw new Error(result.stderr || `ssh exited with ${result.status}`);

const rows = result.stdout.split("\n").filter(Boolean).map((line, index) => {
	try { return JSON.parse(line); }
	catch { throw new Error(`旧DBの出力${index + 1}行目をJSONとして解析できません。`); }
});
const groups = Object.groupBy(rows, (row) => row.type);

const quote = (value) => value === null || value === undefined ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const integer = (value, scale = 1) => Math.round(Number(value) * scale);
const timestamp = (value) => {
	if (!value) return null;
	const iso = String(value).replace(" ", "T") + (String(value).endsWith("Z") ? "" : "Z");
	const parsed = Date.parse(iso);
	if (!Number.isFinite(parsed)) throw new Error(`日時を変換できません: ${value}`);
	return parsed;
};
const userId = (id) => `legacy-user-${id}`;
const sessionId = (id) => `legacy-session-${id}`;
const gameId = (id) => `legacy-game-${id}`;
const sql = [];
const insert = (table, columns, values) => sql.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")});`);

sql.push("PRAGMA foreign_keys = ON;");
for (const table of ["password_login_challenges", "webauthn_challenges", "auth_sessions", "auth_recovery_codes", "webauthn_credentials", "game_draft_entries", "game_results", "games", "session_members", "game_sessions", "friend_requests", "friendships", "user_avatars", "users"]) sql.push(`DELETE FROM ${table};`);

for (const row of groups.user || []) {
	insert("users", ["id","user_id","display_name","created_at_ms","updated_at_ms","legacy_password_hash","legacy_login_id"], [
		quote(userId(row.id)), quote(`legacy_${row.id}`), quote(row.name), timestamp(row.created_at) ?? 0, timestamp(row.updated_at) ?? timestamp(row.created_at) ?? 0, quote(row.password_hash), quote(row.login_id),
	]);
}

const friendshipPairs = new Set();
for (const row of groups.friendship || []) {
	const pair = [userId(row.user_id), userId(row.friend_id)].sort();
	const key = pair.join("|");
	if (friendshipPairs.has(key)) continue;
	friendshipPairs.add(key);
	insert("friendships", ["user_id","friend_id","created_at_ms"], [quote(pair[0]), quote(pair[1]), timestamp(row.created_at) ?? 0]);
}
for (const row of (groups.friend_request || []).filter((request) => request.status === "pending")) {
	const created = timestamp(row.created_at) ?? 0;
	insert("friend_requests", ["id","sender_id","recipient_id","created_at_ms","expires_at_ms","responded_at_ms"], [quote(`legacy-request-${row.id}`), quote(userId(row.sender_id)), quote(userId(row.recipient_id)), created, created + 30 * 86400000, "NULL"]);
}

for (const row of groups.session || []) {
	const bonuses = typeof row.rule_rank_bonus === "string" ? JSON.parse(row.rule_rank_bonus) : row.rule_rank_bonus;
	const rules = { playerCount: Number(row.player_count), baseScore: integer(row.rule_base), scoreMultiplierBasisPoints: integer(row.rule_k, 10000), rankBonusesMilli: Object.fromEntries(Object.entries(bonuses || {}).map(([rank, value]) => [rank, integer(value, 1000)])) };
	const status = row.status === "closed" ? "closed" : "active";
	insert("game_sessions", ["id","owner_user_id","name","join_code","player_count","status","rules_json","state_version","created_at_ms","updated_at_ms","closed_at_ms"], [quote(sessionId(row.id)),quote(userId(row.owner_id)),quote(row.name),quote(row.join_code),integer(row.player_count),quote(status),quote(JSON.stringify(rules)),0,timestamp(row.created_at) ?? 0,timestamp(row.updated_at) ?? timestamp(row.created_at) ?? 0,timestamp(row.closed_at) ?? "NULL"]);
}
for (const row of groups.member || []) insert("session_members", ["session_id","user_id","seat_index","joined_at_ms"], [quote(sessionId(row.session_id)),quote(userId(row.user_id)),row.seat_index ?? "NULL",timestamp(row.joined_at) ?? timestamp(row.created_at) ?? 0]);
for (const row of groups.game || []) insert("games", ["id","session_id","ordinal","recorded_by_user_id","played_at_ms","created_at_ms"], [quote(gameId(row.id)),quote(sessionId(row.session_id)),integer(row.ordinal),quote(userId(row.created_by)),timestamp(row.played_at) ?? timestamp(row.created_at) ?? 0,timestamp(row.created_at) ?? 0]);
for (const row of groups.result || []) insert("game_results", ["game_id","user_id","final_score","rank","score_difference","score_points_milli","rank_bonus_milli","points_milli","created_at_ms"], [quote(gameId(row.game_id)),quote(userId(row.user_id)),integer(row.final_score),integer(row.rank),integer(row.score_diff),integer(row.score_diff_scaled,1000),integer(row.rank_bonus,1000),integer(row.points,1000),timestamp(row.created_at) ?? 0]);
for (const row of groups.draft_entry || []) insert("game_draft_entries", ["session_id","user_id","final_score","rank","updated_at_ms"], [quote(sessionId(row.session_id)),quote(userId(row.user_id)),integer(row.final_score),row.rank ?? "NULL",timestamp(row.updated_at) ?? timestamp(row.created_at) ?? 0]);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, sql.join("\n") + "\n", { mode: 0o600 });
const counts = Object.fromEntries(Object.entries(groups).map(([key, values]) => [key, values.length]));
console.log(JSON.stringify({ output, counts, importedFriendships: friendshipPairs.size, importedPendingRequests: (groups.friend_request || []).filter((row) => row.status === "pending").length }, null, 2));
