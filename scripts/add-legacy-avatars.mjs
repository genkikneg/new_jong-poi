import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve(process.argv[2] || ".migration-work");
const importPath = resolve(process.argv[3] || ".migration-work/legacy-import.sql");
const files = readdirSync(directory).filter((name) => /^avatar-\d+\.png$/.test(name)).sort();
let sql = readFileSync(importPath, "utf8");
const importedAtMs = Date.now();

const inserts = files.map((name) => {
	const legacyId = name.match(/^avatar-(\d+)\.png$/)?.[1];
	const bytes = readFileSync(resolve(directory, name));
	if (!legacyId || bytes.length > 262144) throw new Error(`${name} はD1のアバター制限を超えています。`);
	return `INSERT INTO user_avatars (user_id, content_type, bytes, updated_at_ms) VALUES ('legacy-user-${legacyId}', 'image/png', X'${bytes.toString("hex")}', ${importedAtMs});`;
});

sql += inserts.join("\n") + "\n";
writeFileSync(importPath, sql, { mode: 0o600 });
console.log(JSON.stringify({ importedAvatars: files.length, files }, null, 2));
