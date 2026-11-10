const baseUrl = (process.env.JONG_POI_STAGING_URL ?? "https://jong-poi-next.misoon.net").replace(/\/$/, "");
const sessionToken = process.env.JONG_POI_SESSION_TOKEN;

async function request(path, authenticated = false) {
	const headers = { Accept: "application/json" };
	if (authenticated && sessionToken) headers.Cookie = `jong_poi_session=${sessionToken}`;
	const response = await fetch(`${baseUrl}${path}`, { headers, redirect: "error" });
	if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
	return response;
}

const page = await request("/");
if (!page.headers.get("content-type")?.includes("text/html")) {
	throw new Error("/: expected HTML");
}
const health = await (await request("/api/health")).json();
if (health.status !== "ok" || health.database !== "ok") {
	throw new Error("/api/health: unhealthy response");
}
console.log("Public staging checks passed.");

if (sessionToken) {
	for (const path of ["/api/me", "/api/sessions", "/api/history", "/api/rankings?period=all"]) {
		const response = await request(path, true);
		if (!response.headers.get("content-type")?.includes("application/json")) {
			throw new Error(`${path}: expected JSON`);
		}
	}
	console.log("Authenticated staging checks passed.");
} else {
	console.log("Authenticated checks skipped (JONG_POI_SESSION_TOKEN is not set).");
}
