export type Route = "dashboard" | "create" | "join" | "history" | "rankings" | "friends" | "stats" | "profile" | "passkey-migration" | "session" | "not-found";

export function normalisePathname(pathname: string): string {
	const path = pathname.replace(/\/+$/, "");
	return path || "/";
}

export function routeFor(pathname: string): Route {
	if (pathname === "/" || pathname === "/dashboard") return "dashboard";
	if (pathname === "/sessions/create") return "create";
	if (pathname === "/sessions/join") return "join";
	if (pathname === "/sessions/history") return "history";
	if (pathname === "/rankings") return "rankings";
	if (pathname === "/friends") return "friends";
	if (pathname === "/stats") return "stats";
	if (pathname === "/settings" || pathname === "/settings/profile") return "profile";
	if (pathname === "/settings/passkey-migration") return "passkey-migration";
	if (/^\/sessions\/[^/]+$/.test(pathname)) return "session";
	return "not-found";
}

export function sessionIdFor(pathname: string): string | null {
	if (routeFor(pathname) !== "session") return null;
	const match = pathname.match(/^\/sessions\/([^/]+)$/);
	return match ? decodeURIComponent(match[1]) : null;
}
