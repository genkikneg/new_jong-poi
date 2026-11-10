import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import bcrypt from "bcryptjs";

const suffix = Date.now().toString(36);
const email = `legacy-test-${suffix}@example.invalid`;
const password = `Jp-${randomBytes(12).toString("base64url")}!`;
const passwordHash = await bcrypt.hash(password, 12);
const internalId = randomUUID();
const temporaryPublicId = `legacy_${randomBytes(6).toString("hex")}`;
const nowMs = Date.now();
const escapeSql = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sql = `INSERT INTO users
  (id, user_id, display_name, created_at_ms, updated_at_ms, legacy_password_hash, legacy_login_id)
VALUES
  (${escapeSql(internalId)}, ${escapeSql(temporaryPublicId)}, '旧ユーザーテスト', ${nowMs}, ${nowMs}, ${escapeSql(passwordHash)}, ${escapeSql(email)});
`;

const directory = await mkdtemp(join(tmpdir(), "jong-poi-legacy-seed-"));
const sqlPath = join(directory, "seed.sql");

try {
	await writeFile(sqlPath, sql, { encoding: "utf8", mode: 0o600 });
	await chmod(sqlPath, 0o600);
	const result = spawnSync(
		"npx",
		["wrangler", "d1", "execute", "jong-poi-development", "--remote", "--env", "staging", "--file", sqlPath],
		{ cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	);
	if (result.status !== 0) {
		process.stderr.write(result.stderr || result.stdout || "D1への登録に失敗しました。\n");
		process.exitCode = result.status ?? 1;
	} else {
		console.log("ステージング用の旧ユーザーを作成しました。");
		console.log(`ログインID: ${email}`);
		console.log(`パスワード: ${password}`);
		console.log("この認証情報はテスト後に使用できなくなります（パスキー移行時に削除されます）。");
	}
} finally {
	await rm(directory, { recursive: true, force: true });
}
