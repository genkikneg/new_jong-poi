import { describe, expect, it } from "vitest";
import { isAllowedApiRequest, isSameOriginRequest } from "./security";

describe("same-origin request protection", () => {
	it("allows reads and same-origin writes", () => {
		expect(isAllowedApiRequest(new Request("https://jong-poi-next.misoon.net/api/me"))).toBe(true);
		expect(isAllowedApiRequest(new Request("https://jong-poi-next.misoon.net/api/me/avatar", {
			method: "PUT",
			headers: { Origin: "https://jong-poi-next.misoon.net", "Sec-Fetch-Site": "same-origin" },
		}))).toBe(true);
	});

	it("rejects missing, malformed, and cross-site origins for writes", () => {
		expect(isAllowedApiRequest(new Request("https://jong-poi-next.misoon.net/api/me/avatar", { method: "DELETE" }))).toBe(false);
		expect(isAllowedApiRequest(new Request("https://jong-poi-next.misoon.net/api/me/avatar", {
			method: "PUT",
			headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
		}))).toBe(false);
		expect(isSameOriginRequest(new Request("https://jong-poi-next.misoon.net/ws/sessions/1", {
			headers: { Origin: "not a url" },
		}))).toBe(false);
	});
});
