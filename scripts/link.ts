import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addon, buildDir, zoteroProfileDir } from "./config.ts";

/**
 * Install the plugin into Zotero as an extension proxy file: a text file named
 * after the addon id whose contents are the absolute path to the built plugin.
 *
 * Zotero only rescans the extensions directory when it thinks the app changed,
 * so we also drop extensions.lastAppBuildId / lastAppVersion from prefs.js.
 * Zotero must be closed while this runs, or it will overwrite prefs.js on exit.
 */
export function link() {
	const profile = zoteroProfileDir();

	const extensionsDir = join(profile, "extensions");
	mkdirSync(extensionsDir, { recursive: true });
	const proxy = join(extensionsDir, addon.id);
	writeFileSync(proxy, buildDir);
	console.log(`Linked ${proxy} -> ${buildDir}`);

	const prefsPath = join(profile, "prefs.js");
	const prefs = readFileSync(prefsPath, "utf8");
	const purged = prefs
		.split("\n")
		.filter((l) => !/extensions\.(lastAppBuildId|lastAppVersion)/.test(l))
		.join("\n");
	if (purged !== prefs) {
		writeFileSync(prefsPath, purged);
		console.log("Cleared extensions.lastAppBuildId/lastAppVersion to force a rescan");
	}
}

if (import.meta.filename === process.argv[1]) {
	link();
}
