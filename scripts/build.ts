import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { addonDir, buildDir, defines, srcDir, substitutions } from "./config.ts";

const TEXT_EXTENSIONS = new Set([".json", ".js", ".mjs", ".xhtml", ".css", ".ftl", ".dtd", ".properties"]);

/** Copy addon/ into build/, substituting __placeholders__ in text files. */
const copyStaticAssets = (dir: string) => {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const from = join(dir, entry.name);
		if (entry.isDirectory()) {
			copyStaticAssets(from);
			continue;
		}
		const to = join(buildDir, relative(addonDir, from));
		mkdirSync(join(to, ".."), { recursive: true });

		const ext = entry.name.slice(entry.name.lastIndexOf("."));
		if (!TEXT_EXTENSIONS.has(ext)) {
			cpSync(from, to);
			continue;
		}
		let text = readFileSync(from, "utf8");
		for (const [key, value] of Object.entries(substitutions)) {
			text = text.replaceAll(key, value);
		}
		writeFileSync(to, text);
	}
};

/**
 * bootstrap.ts and preferences.ts are transpiled without bundling so their
 * top-level declarations stay in the scope Zotero evaluates them in. index.ts
 * is bundled as an IIFE and loaded via Services.scriptloader.
 */
const scriptOptions: esbuild.BuildOptions[] = [
	{
		entryPoints: [join(srcDir, "index.ts")],
		outfile: join(buildDir, "__addonRef__.js"),
		bundle: true,
		format: "iife",
	},
	{
		entryPoints: [join(srcDir, "bootstrap.ts")],
		outfile: join(buildDir, "bootstrap.js"),
		bundle: false,
	},
	{
		entryPoints: [join(srcDir, "preferences.ts")],
		outfile: join(buildDir, "preferences.js"),
		bundle: false,
	},
];

const resolveOutfile = (options: esbuild.BuildOptions, dev: boolean): esbuild.BuildOptions => {
	let outfile = options.outfile!;
	for (const [key, value] of Object.entries(substitutions)) {
		outfile = outfile.replaceAll(key, value);
	}
	return {
		...options,
		outfile,
		target: "firefox115",
		platform: "browser",
		charset: "utf8",
		define: defines(dev),
		logLevel: "warning",
	};
};

export const build = async ({ dev = false } = {}) => {
	rmSync(buildDir, { recursive: true, force: true });
	mkdirSync(buildDir, { recursive: true });
	copyStaticAssets(addonDir);
	await Promise.all(
		scriptOptions.map((o) => esbuild.build(resolveOutfile(o, dev))),
	);
};

if (import.meta.filename === process.argv[1]) {
	const start = Date.now();
	const dev = process.argv.includes("--dev");
	await build({ dev });
	const files: string[] = [];
	const walk = (d: string) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name);
			e.isDirectory() ? walk(p) : files.push(`  ${relative(buildDir, p)} (${statSync(p).size}b)`);
		}
	};
	walk(buildDir);
	console.log(`Built${dev ? " (dev)" : ""} in ${Date.now() - start}ms:\n${files.sort().join("\n")}`);
}
