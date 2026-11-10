import { describe, expect, it } from "vitest";
import { SessionCloseError, SessionRoom } from "./session-room";

function roomFor(
	ownerUserId: string,
	requestLog: string[],
	sentMessages: string[] = [],
): SessionRoom {
	const database = {
		prepare: (sql: string) => ({
			bind: () => ({
				first: async () => ({
					id: "session-1",
					owner_user_id: ownerUserId,
					status: "active",
					player_count: 4,
					rules_json: "{}",
					state_version: 2,
				}),
				run: async () => {
					requestLog.push(sql);
					return { meta: { changes: 1 } };
				},
			}),
		}),
	} as unknown as D1Database;

	return new SessionRoom(
		{
			id: { name: "session-1" },
			getWebSockets: () => [{ send: (message: string) => sentMessages.push(message) }],
		} as unknown as DurableObjectState,
		{ DB: database } as Env,
	);
}

describe("SessionRoom.closeSession", () => {
	it("closes a session only when its owner requests it", async () => {
		const requests: string[] = [];
		const sentMessages: string[] = [];
		await roomFor("owner-1", requests, sentMessages).closeSession("owner-1");

		expect(requests).toHaveLength(1);
		expect(requests[0]).toContain("SET status = 'closed'");
		expect(JSON.parse(sentMessages[0])).toEqual(expect.objectContaining({
			type: "session.closed",
			sessionId: "session-1",
			version: 3,
		}));
	});

	it("does not issue a write for a non-owner", async () => {
		const requests: string[] = [];
		await expect(roomFor("owner-1", requests).closeSession("member-2")).rejects.toEqual(
			expect.objectContaining<Partial<SessionCloseError>>({ code: "NOT_SESSION_OWNER" }),
		);
		expect(requests).toHaveLength(0);
	});

	it("serializes a burst of concurrent close commands and writes only once", async () => {
		let status: "active" | "closed" = "active";
		let writes = 0;
		const database = {
			prepare: () => ({
				bind: () => ({
					first: async () => {
						const observedStatus = status;
						await Promise.resolve();
						return { id: "session-1", owner_user_id: "owner-1", status: observedStatus, player_count: 4, rules_json: "{}", state_version: writes };
					},
					run: async () => { status = "closed"; writes += 1; return { meta: { changes: 1 } }; },
				}),
			}),
		} as unknown as D1Database;
		const room = new SessionRoom({ id: { name: "session-1" }, getWebSockets: () => [] } as unknown as DurableObjectState, { DB: database } as Env);

		await Promise.all(Array.from({ length: 25 }, () => room.closeSession("owner-1")));
		expect(writes).toBe(1);
	});
});

describe("SessionRoom WebSocket authorization", () => {
	it("rejects a connection when the user is not a session member", async () => {
		const database = {
			prepare: () => ({ bind: () => ({ first: async () => null }) }),
		} as unknown as D1Database;
		const room = new SessionRoom({ id: { name: "session-1" } } as unknown as DurableObjectState, { DB: database } as Env);
		const response = await room.fetch(new Request("https://internal/ws", {
			headers: { Upgrade: "websocket", "X-Jong-Poi-User-Id": "outsider" },
		}));
		expect(response.status).toBe(403);
	});
});
