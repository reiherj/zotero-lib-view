import { spawn, execFileSync } from "node:child_process";
import { openSync } from "node:fs";
import { join } from "node:path";
import { root, zoteroBin } from "./config.ts";

const PROCESS_PATTERN = "Zotero.app/Contents/MacOS/zotero";
export const logFile = join(root, "zotero.log");

function isRunning(): boolean {
	try {
		execFileSync("pgrep", ["-f", PROCESS_PATTERN], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function stop() {
	if (!isRunning()) return;
	console.log("Stopping Zotero…");
	try {
		execFileSync("osascript", ["-e", 'tell application "Zotero" to quit'], { stdio: "ignore" });
	} catch {
		// Zotero may not be scriptable if it is mid-launch; fall through to SIGTERM.
	}
	for (let i = 0; i < 60; i++) {
		if (!isRunning()) return;
		await sleep(500);
	}
	console.log("Zotero did not quit; sending SIGTERM");
	try {
		execFileSync("pkill", ["-f", PROCESS_PATTERN], { stdio: "ignore" });
	} catch {
		/* already gone */
	}
	for (let i = 0; i < 20; i++) {
		if (!isRunning()) return;
		await sleep(500);
	}
	throw new Error("Could not stop Zotero");
}

export function start() {
	// -purgecaches forces Zotero to re-read the plugin's files rather than
	// serving the previous build from its startup cache.
	const out = openSync(logFile, "a");
	// -jsconsole opens the Browser Console, which is noisy and can stall the
	// AppleScript quit; opt in with ZOTERO_JSCONSOLE=1 when you need it.
	const args = ["-purgecaches", "-ZoteroDebugText"];
	if (process.env.ZOTERO_JSCONSOLE) args.push("-jsconsole");
	const child = spawn(zoteroBin, args, {
		detached: true,
		stdio: ["ignore", out, out],
	});
	child.unref();
	console.log(`Started Zotero (pid ${child.pid}); log: ${logFile}`);
}

export async function restart() {
	await stop();
	start();
}

if (import.meta.filename === process.argv[1]) {
	const command = process.argv[2] ?? "restart";
	if (command === "stop") await stop();
	else if (command === "start") start();
	else if (command === "restart") await restart();
	else {
		console.error(`Usage: tsx scripts/zotero.ts [start|stop|restart]`);
		process.exit(1);
	}
}
