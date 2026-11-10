import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Pure domain tests intentionally run in Node, without starting the Workers
 * Vite plugin. Worker/D1 tests will get their own Cloudflare Vitest setup.
 */
export default defineConfig({
	resolve: {
		alias: {
			"cloudflare:workers": fileURLToPath(
				new URL("./src/test/cloudflare-workers.ts", import.meta.url),
			),
		},
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
