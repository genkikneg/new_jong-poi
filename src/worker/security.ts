const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSameOriginRequest(request: Request): boolean {
	const origin = request.headers.get("Origin");
	if (!origin) return false;
	try {
		return new URL(origin).origin === new URL(request.url).origin;
	} catch {
		return false;
	}
}

export function isAllowedApiRequest(request: Request): boolean {
	if (SAFE_METHODS.has(request.method.toUpperCase())) return true;
	if (request.headers.get("Sec-Fetch-Site") === "cross-site") return false;
	return isSameOriginRequest(request);
}
