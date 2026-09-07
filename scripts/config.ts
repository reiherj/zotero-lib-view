import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const srcDir = join(root, "src");
export const addonDir = join(root, "addon");
export const buildDir = join(root, "build");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

export const addon = {
	id: pkg.config.addonID as string,
	name: pkg.config.addonName as string,
	ref: pkg.config.addonRef as string,
	prefsPrefix: pkg.config.prefsPrefix as string,
	version: pkg.version as string,
	description: pkg.description as string,
};

/** Placeholders substituted in addon/ static files at build time. */
export const substitutions: Record<string, string> = {
	__addonID__: addon.id,
	__addonName__: addon.name,
	__addonRef__: addon.ref,
	__addonVersion__: addon.version,
	__addonDescription__: addon.description,
	__prefsPrefix__: addon.prefsPrefix,
};

/** Constants injected into TypeScript sources by esbuild. */
export const defines: Record<string, string> = {
	__ADDON_ID__: JSON.stringify(addon.id),
	__ADDON_NAME__: JSON.stringify(addon.name),
	__ADDON_REF__: JSON.stringify(addon.ref),
	__ADDON_VERSION__: JSON.stringify(addon.version),
	__PREFS_PREFIX__: JSON.stringify(addon.prefsPrefix),
};

export const zoteroBin =
	process.env.ZOTERO_BIN ?? "/Applications/Zotero.app/Contents/MacOS/zotero";

/** Resolve the Zotero profile directory, honouring ZOTERO_PROFILE_DIR. */
export function zoteroProfileDir(): string {
	if (process.env.ZOTERO_PROFILE_DIR) return process.env.ZOTERO_PROFILE_DIR;

	const base = join(homedir(), "Library", "Application Support", "Zotero");
	const ini = join(base, "profiles.ini");
	if (!existsSync(ini)) {
		throw new Error(`No Zotero profiles.ini at ${ini}; set ZOTERO_PROFILE_DIR`);
	}

	const sections = readFileSync(ini, "utf8").split(/^\[/m).slice(1);
	let fallback: string | undefined;
	for (const section of sections) {
		const path = section.match(/^Path=(.*)$/m)?.[1];
		if (!path) continue;
		const isRelative = /^IsRelative=1$/m.test(section);
		const full = isRelative ? join(base, path) : path;
		if (/^Default=1$/m.test(section)) return full;
		fallback ??= full;
	}

	if (!fallback) throw new Error(`No profile found in ${ini}`);
	return fallback;
}
