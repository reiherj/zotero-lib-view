import { watch } from "node:fs";
import { relative } from "node:path";
import { build } from "./build.ts";
import { addonDir, root, srcDir } from "./config.ts";
import { link } from "./link.ts";
import { restart, stop } from "./zotero.ts";

const DEBOUNCE_MS = 300;

async function rebuildAndRestart() {
	try {
		await build();
	} catch (error) {
		console.error("Build failed; leaving Zotero alone.\n", error);
		return;
	}
	await restart();
}

// Zotero rewrites prefs.js on exit, so it must be closed before we link.
await stop();
await build();
link();
await restart();

let timer: NodeJS.Timeout | undefined;
let running = false;
let queued = false;

function schedule(path: string) {
	console.log(`Changed: ${relative(root, path)}`);
	clearTimeout(timer);
	timer = setTimeout(async () => {
		if (running) {
			queued = true;
			return;
		}
		running = true;
		do {
			queued = false;
			await rebuildAndRestart();
		} while (queued);
		running = false;
	}, DEBOUNCE_MS);
}

for (const dir of [srcDir, addonDir]) {
	watch(dir, { recursive: true }, (_event, filename) => {
		if (filename) schedule(`${dir}/${filename}`);
	});
}

console.log(`\nWatching ${relative(root, srcDir)}/ and ${relative(root, addonDir)}/ — Ctrl-C to stop.`);
