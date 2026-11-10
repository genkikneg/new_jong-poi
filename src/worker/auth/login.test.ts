import { describe, expect, it } from "vitest";
import { beginPasskeyLogin } from "./login";

describe("passkey login", () => {
	it("starts account-discovery login without a user ID", async () => {
		let inserted: unknown[] = [];
		const db = {
			prepare: () => ({
				bind: (...values: unknown[]) => ({
					run: async () => { inserted = values; },
				}),
			}),
		} as unknown as D1Database;

		const result = await beginPasskeyLogin(db, {
			rpId: "example.test",
			origin: "https://example.test",
		});

		expect(result.options.rpId).toBe("example.test");
		expect(result.options.allowCredentials).toEqual([]);
		expect(inserted.slice(3, 6)).toEqual(["", "", ""]);
	});
});
