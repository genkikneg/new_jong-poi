import { describe, expect, it } from "vitest";
import {
	buildExpiredSessionCookie,
	buildSessionCookie,
	findAuthenticatedSession,
	hashSessionToken,
	readSessionToken,
	SESSION_COOKIE_NAME,
} from "./session";

function bytesOf(value: ArrayBuffer): number[] {
	return [...new Uint8Array(value)];
}

describe("session cookies", () => {
	it("reads only the session cookie from a cookie header", () => {
		expect(
			readSessionToken(`theme=dark; ${SESSION_COOKIE_NAME}=token-value; locale=ja`),
		).toBe("token-value");
		expect(readSessionToken(null)).toBeNull();
	});

	it("uses secure HTTP-only attributes", () => {
		const cookie = buildSessionCookie("token-value", Date.now() + 60_000);
		expect(cookie).toContain(`${SESSION_COOKIE_NAME}=token-value`);
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("Secure");
		expect(cookie).toContain("SameSite=Lax");
		expect(buildExpiredSessionCookie()).toContain("Max-Age=0");
	});
});

describe("session lookup", () => {
	it("hashes the token before sending it to D1", async () => {
		const digest = await hashSessionToken("token-value");
		const expected = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode("token-value"),
		);

		expect(bytesOf(digest)).toEqual(bytesOf(expected));
	});

	it("maps an active session and its user", async () => {
		const database = {
			prepare: () => ({
				bind: () => ({
					first: async () => ({
						session_id: "session-1",
						user_id: "user-1",
						public_user_id: "genki",
						display_name: "元希",
					}),
				}),
			}),
		} as unknown as D1Database;

		expect(await findAuthenticatedSession(database, "token-value")).toEqual({
			id: "session-1",
			user: {
				id: "user-1",
				userId: "genki",
				displayName: "元希",
			},
		});
	});
});
