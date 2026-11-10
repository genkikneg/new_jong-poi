import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const sshHost = process.env.LEGACY_SSH_HOST || "genki";
const dbContainer = process.env.LEGACY_DB_CONTAINER || "jong-poi-db-1";
const output = resolve(process.argv[2] || ".migration-work/legacy-name-repair.sql");
const query = "SELECT JSON_OBJECT('id',id,'name',name) FROM users ORDER BY id;";
const remote = `docker exec -i ${dbContainer} sh -lc 'exec mysql --default-character-set=utf8mb4 --raw --batch --skip-column-names -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'`;
const result = spawnSync("ssh", [sshHost, remote], { input: query, encoding: "utf8", maxBuffer: 1024 * 1024 });
if (result.status !== 0) throw new Error(result.stderr || `ssh exited with ${result.status}`);

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const rows = result.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
const sql = rows.map((row) => `UPDATE users SET display_name = ${quote(row.name)} WHERE id = ${quote(`legacy-user-${row.id}`)};`);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, sql.join("\n") + "\n", { mode: 0o600 });
console.log(JSON.stringify({ output, users: rows.length }, null, 2));
