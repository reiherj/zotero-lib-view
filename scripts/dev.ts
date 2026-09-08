import { watch } from "node:fs";
import { join, relative } from "node:path";
import { build } from "./build.ts";
import { addonDir, root, srcDir } from "./config.ts";
import { link } from "./link.ts";
import { reload } from "./reload.ts";
import { restart, stop } from "./zotero.ts";

const DEBOUNCE_MS = 300;

/**
 * A plugin reload re-runs shutdown()/startup(), which re-loads lib-view.js but
 * reuses the existing bootstrap sandbox. These files are only read outside that
 * cycle, so changing them needs a full Zotero restart.
 */
const NEEDS_RESTART = new Set([
	join(srcDir, "bootstrap.ts"),
	join(addonDir, "manifest.json"),
	join(addonDir, "prefs.js"),
]);

const pending = new Set<string>();

const flush = async () => {
	const changed = [...pending];
	pending.clear();

	try {
		await build({ dev: true });
	} catch (error) {
		console.error("Build failed; leaving Zotero alone.\n", error);
		return;
	}

	const forced = changed.filter((path) => NEEDS_RESTART.has(path));
	if (forced.length === 0) {
		const start = Date.now();
		if (await reload()) {
			console.log(`Reloaded in ${Date.now() - start}ms`);
			return;
		}
		console.log("Reload endpoint unreachable; restarting instead");
	} else {
		console.log(
			`${forced.map((p) => relative(root, p)).join(", ")} changed; restarting`,
		);
	}
	await restart();
};

// Zotero rewrites prefs.js on exit, so it must be closed before we link.
await stop();
await build({ dev: true });
link();
await restart();

let timer: NodeJS.Timeout | undefined;
let running = false;

const schedule = (path: string) => {
	console.log(`Changed: ${relative(root, path)}`);
	pending.add(path);
	clearTimeout(timer);
	timer = setTimeout(async () => {
		if (running) return;
		running = true;
		try {
			while (pending.size > 0) await flush();
		} finally {
			running = false;
		}
	}, DEBOUNCE_MS);
};

for (const dir of [srcDir, addonDir]) {
	watch(dir, { recursive: true }, (_event, filename) => {
		// Editors write temp siblings (.!12345!file.ts), so ignore anything hidden.
		if (filename && !filename.split("/").some((p) => p.startsWith("."))) {
			schedule(join(dir, filename));
		}
	});
}

console.log(
	`\nWatching ${relative(root, srcDir)}/ and ${relative(root, addonDir)}/ — Ctrl-C to stop.`,
);
