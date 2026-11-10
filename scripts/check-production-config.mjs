import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../wrangler.json", import.meta.url), "utf8");
let insideBlockComment = false;
const withoutComments = source.split("\n").filter((line) => {
	const trimmed = line.trim();
	if (!insideBlockComment && trimmed.startsWith("/*")) {
		insideBlockComment = !trimmed.endsWith("*/");
		return false;
	}
	if (insideBlockComment) {
		if (trimmed.endsWith("*/")) insideBlockComment = false;
		return false;
	}
	return !trimmed.startsWith("//");
}).join("\n");
const config = JSON.parse(withoutComments);
const productionDatabaseId = config.d1_databases?.[0]?.database_id;
const stagingDatabaseId = config.env?.staging?.d1_databases?.[0]?.database_id;

if (!productionDatabaseId || !stagingDatabaseId) {
	console.error("Production deploy blocked: production and staging D1 bindings must both be configured.");
	process.exit(1);
}
if (productionDatabaseId === stagingDatabaseId) {
	console.error("Production deploy blocked: production and staging still reference the same D1 database. See OPERATIONS.md.");
	process.exit(1);
}

console.log("Production D1 is separated from staging.");
