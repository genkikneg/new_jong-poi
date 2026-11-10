import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { deleteAccount } from "./account";

interface Bound { __sql: string; __values: unknown[]; }

function database(sqlite: DatabaseSync): D1Database {
	return {
		prepare: (sql: string) => ({ bind: (...values: unknown[]) => ({ __sql: sql, __values: values }) }),
		batch: async (statements: unknown[]) => statements.map((statement) => {
			const bound = statement as Bound;
			const result = sqlite.prepare(bound.__sql).run(...bound.__values);
			return { meta: { changes: Number(result.changes) } };
		}),
	} as unknown as D1Database;
}

describe("account deletion", () => {
	it("removes authentication and personal data while preserving anonymized game history", async () => {
		const sqlite = new DatabaseSync(":memory:");
		for (const migration of ["0001_initial_schema.sql", "0002_webauthn_challenges.sql", "0003_game_result_idempotency.sql", "0004_game_draft_entries.sql", "0005_legacy_password_login.sql", "0006_private_legacy_login_id.sql"]) {
			sqlite.exec(readFileSync(new URL(`../../migrations/${migration}`, import.meta.url), "utf8"));
		}
		sqlite.prepare("INSERT INTO users (id,user_id,display_name,created_at_ms,updated_at_ms,legacy_password_hash,legacy_login_id) VALUES ('deleted-user','public-id','名前',1,1,'hash','mail@example.com'),('other-user','other','相手',1,1,NULL,NULL)").run();
		sqlite.prepare("INSERT INTO webauthn_credentials (credential_id,user_id,public_key,transports_json,created_at_ms) VALUES ('credential','deleted-user',X'01','[]',1)").run();
		sqlite.prepare("INSERT INTO auth_sessions (id,user_id,token_digest,expires_at_ms,created_at_ms,last_seen_at_ms) VALUES ('auth','deleted-user',X'02',999,1,1)").run();
		sqlite.prepare("INSERT INTO friendships (user_id,friend_id,created_at_ms) VALUES ('deleted-user','other-user',1)").run();
		sqlite.prepare("INSERT INTO game_sessions (id,owner_user_id,join_code,player_count,status,rules_json,created_at_ms,updated_at_ms) VALUES ('session','deleted-user','ABCDEFGH',4,'active','{}',1,1)").run();
		sqlite.prepare("INSERT INTO session_members (session_id,user_id,seat_index,joined_at_ms) VALUES ('session','deleted-user',0,1),('session','other-user',1,1)").run();
		sqlite.prepare("INSERT INTO games (id,session_id,ordinal,recorded_by_user_id,played_at_ms,created_at_ms) VALUES ('game','session',1,'deleted-user',1,1)").run();
		sqlite.prepare("INSERT INTO game_results (game_id,user_id,final_score,rank,score_difference,score_points_milli,rank_bonus_milli,points_milli,created_at_ms) VALUES ('game','deleted-user',30000,1,5000,500,1000,1500,1)").run();

		await deleteAccount(database(sqlite), "deleted-user", 100);

		expect(sqlite.prepare("SELECT user_id,display_name,legacy_password_hash,legacy_login_id FROM users WHERE id='deleted-user'").get()).toMatchObject({ display_name: "退会済みユーザー", legacy_password_hash: null, legacy_login_id: null });
		expect(sqlite.prepare("SELECT user_id FROM users WHERE id='deleted-user'").get()).toMatchObject({ user_id: expect.stringMatching(/^deleted_/) });
		expect(sqlite.prepare("SELECT COUNT(*) count FROM webauthn_credentials WHERE user_id='deleted-user'").get()).toMatchObject({ count: 0 });
		expect(sqlite.prepare("SELECT COUNT(*) count FROM auth_sessions WHERE user_id='deleted-user'").get()).toMatchObject({ count: 0 });
		expect(sqlite.prepare("SELECT COUNT(*) count FROM friendships").get()).toMatchObject({ count: 0 });
		expect(sqlite.prepare("SELECT status,closed_at_ms FROM game_sessions WHERE id='session'").get()).toMatchObject({ status: "closed", closed_at_ms: 100 });
		expect(sqlite.prepare("SELECT COUNT(*) count FROM game_results WHERE user_id='deleted-user'").get()).toMatchObject({ count: 1 });
		sqlite.close();
	});
});
