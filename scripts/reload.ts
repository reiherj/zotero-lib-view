import { reloadURL } from "./config.ts";

/**
 * Ask the running plugin to reload itself. Returns false if Zotero isn't up, if
 * the endpoint is missing (a previous build failed to start), or if the request
 * times out — callers should fall back to a full restart.
 */
export async function reload(): Promise<boolean> {
	try {
		const response = await fetch(reloadURL, {
			signal: AbortSignal.timeout(3000),
		});
		return response.ok;
	} catch {
		return false;
	}
}

if (import.meta.filename === process.argv[1]) {
	if (await reload()) {
		console.log("Reloaded");
	} else {
		console.error(`No reload endpoint at ${reloadURL}`);
		process.exit(1);
	}
}
