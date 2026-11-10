import { describe, expect, it } from "vitest";
import { routeFor, sessionIdFor } from "./routing";

describe("client routing", () => {
	it("does not treat reserved session pages as session IDs", () => {
		expect(routeFor("/sessions/history")).toBe("history");
		expect(sessionIdFor("/sessions/history")).toBeNull();
		expect(sessionIdFor("/sessions/create")).toBeNull();
		expect(sessionIdFor("/sessions/join")).toBeNull();
		expect(routeFor("/rankings")).toBe("rankings");
		expect(routeFor("/friends")).toBe("friends");
		expect(routeFor("/stats")).toBe("stats");
		expect(routeFor("/settings/profile")).toBe("profile");
		expect(routeFor("/settings/passkey-migration")).toBe("passkey-migration");
	});

	it("extracts an actual session detail ID", () => {
		expect(sessionIdFor("/sessions/aaa9c596-4196-45f7-afff-37830ae3bdb3"))
			.toBe("aaa9c596-4196-45f7-afff-37830ae3bdb3");
	});
});
