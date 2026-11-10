import { describe, expect, it } from "vitest";
import app from "./index";

function databaseWithHealthValue(value: number | null): D1Database {
	return {
		prepare: () => ({
			first: async () => (value === null ? null : { value }),
		}),
	} as unknown as D1Database;
}

describe("GET /api/health", () => {
	it("reports healthy only when D1 responds to the health query", async () => {
		const response = await app.request("https://example.test/api/health", undefined, {
			DB: databaseWithHealthValue(1),
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			service: "jong-poi",
			status: "ok",
			database: "ok",
		});
	});

	it("does not expose a D1 failure to callers", async () => {
		const unavailableDatabase = {
			prepare: () => {
				throw new Error("D1 connection failed");
			},
		} as unknown as D1Database;

		const response = await app.request("https://example.test/api/health", undefined, {
			DB: unavailableDatabase,
		});

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			service: "jong-poi",
			status: "unavailable",
			database: "unavailable",
		});
	});

	it("returns JSON for an unknown API route", async () => {
		const response = await app.request("https://example.test/api/unknown", undefined, {
			DB: databaseWithHealthValue(1),
		});

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "not_found" });
	});
});

describe("GET /api/me", () => {
	it("requires an authenticated session", async () => {
		const response = await app.request("https://example.test/api/me", undefined, {
			DB: databaseWithHealthValue(1),
		});

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "unauthenticated" });
	});
});

describe("request security", () => {
	it("rejects cross-site mutations before they reach authentication or D1", async () => {
		const database = {
			prepare: () => { throw new Error("D1 should not be queried"); },
		} as unknown as D1Database;
		const response = await app.request("https://jong-poi-next.misoon.net/api/auth/login/options", {
			method: "POST",
			headers: { "Content-Type": "application/json", Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
			body: JSON.stringify({ userId: "tester" }),
		}, { DB: database });

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "cross_site_request" });
	});

	it("requires authentication for avatar reads and same-origin writes", async () => {
		const env = { DB: databaseWithHealthValue(1) };
		const read = await app.request("https://example.test/api/users/user-1/avatar", undefined, env);
		const write = await app.request("https://example.test/api/me/avatar", {
			method: "PUT",
			headers: { Origin: "https://example.test", "Content-Type": "image/png" },
			body: new Uint8Array([1]),
		}, env);

		expect(read.status).toBe(401);
		expect(write.status).toBe(401);
	});
});
