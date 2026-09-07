# Library Grid View

A Zotero plugin that renders your library as a grid of item covers instead of a
list of rows.

> **Status: scaffold.** The build, the profile linking and the dev loop all
> work. The grid itself does not exist yet — see [Status](#status).

## Requirements

- Zotero 7.0 or newer (developed against **9.0.6**)
- Node.js 20+ (developed against **24.14.1**)
- macOS. The scripts shell out to `osascript`/`pgrep` to control Zotero; on
  Linux or Windows you'd need to adapt `scripts/zotero.ts`.

## Quick start

```sh
npm install
npm run dev
```

That builds the plugin, links it into your Zotero profile, launches Zotero, and
then watches `src/` and `addon/` — every save rebuilds and restarts Zotero.
Zotero's debug output is appended to `zotero.log` in the project root.

Nothing is copied into the profile. `npm run link` writes an **extension proxy
file** — a text file named after the plugin id whose contents are the absolute
path to `build/`:

```
~/Library/Application Support/Zotero/Profiles/<profile>/extensions/zotero-lib-view@reiher.dev
```

Zotero only rescans that directory when it believes the application changed, so
`link` also strips `extensions.lastAppBuildId` and `extensions.lastAppVersion`
from the profile's `prefs.js`. Zotero must be closed while this happens, or it
overwrites `prefs.js` on exit — `npm run dev` handles the ordering for you.

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Build, link, launch, then watch and restart on change |
| `npm run build` | Build `build/` once |
| `npm run link` | Write the proxy file into the Zotero profile (Zotero must be closed) |
| `npm start` | Restart Zotero against the current build |
| `npm run stop` | Quit Zotero |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run clean` | Remove `build/` |

Override the defaults if your setup differs:

- `ZOTERO_BIN` — path to the Zotero binary
  (default `/Applications/Zotero.app/Contents/MacOS/zotero`)
- `ZOTERO_PROFILE_DIR` — profile directory (default: the profile marked
  `Default=1` in `~/Library/Application Support/Zotero/profiles.ini`)

## Layout

```
addon/            Static assets copied to build/, with __placeholders__ substituted
  manifest.json
  prefs.js        Default preference values
  preferences.xhtml
  style.css
  locale/en-US/lib-view.ftl
src/
  bootstrap.ts    Zotero's entry points — transpiled, never bundled
  index.ts        Bundle entry; assigns the global bootstrap declares
  lib-view.ts     Plugin logic
  preferences.ts  Preference pane script — transpiled, never bundled
  globals.d.ts    Build-time constants and shared types
scripts/          Build, link and Zotero-process tooling (run with tsx)
  config.ts       Paths, identity, profile discovery
  build.ts        esbuild + asset copy
  dev.ts          Watch loop
  link.ts         Proxy file + prefs surgery
  zotero.ts       start / stop / restart
build/            Build output — the plugin Zotero actually loads
```

## How the build works

### Identity lives in one place

The `config` block in `package.json` is the single source of truth:

```json
{
  "addonID": "zotero-lib-view@reiher.dev",
  "addonName": "Library Grid View",
  "addonRef": "lib-view",
  "prefsPrefix": "extensions.lib-view"
}
```

It reaches the code two ways. TypeScript sources get esbuild `define`
constants — `__ADDON_ID__`, `__ADDON_NAME__`, `__ADDON_REF__`,
`__ADDON_VERSION__`, `__PREFS_PREFIX__`, declared in `src/globals.d.ts`. Static
files in `addon/` get textual substitution of `__addonID__`-style placeholders,
which is also how `manifest.json` picks up the version from `package.json`.

Renaming the plugin means editing `package.json` and nothing else.

### Two build modes, on purpose

`bootstrap.ts` and `preferences.ts` are **transpiled but not bundled**. Zotero
evaluates them as classic scripts and looks up their top-level declarations
(`startup`, `shutdown`, `onMainWindowLoad`, …) by name in that scope — an
esbuild IIFE wrapper would hide them. Everything else is bundled into
`lib-view.js`, which `bootstrap.js` loads with `Services.scriptloader`.

One consequence worth knowing before you touch `bootstrap.ts`: esbuild emits
`"use strict"`, and `lib-view.js` reaches back to assign the shared `LibView`
global. Under strict mode that throws `ReferenceError` unless a real `var
LibView` survives into `build/bootstrap.js` — which is why it is declared in
`bootstrap.ts` rather than in a `.d.ts`. Don't move it.

### Preferences

Defaults live in `addon/prefs.js` under the `extensions.lib-view` prefix and are
read with `Zotero.Prefs.get("extensions.lib-view.columns", true)` — the trailing
`true` means "this is a full pref name, don't prepend `extensions.zotero.`".

## Gotchas

Zotero fails silently in most of these cases, so they are worth recognising.

**The plugin doesn't load and nothing appears in the log.** Zotero 9 validates
`applications.zotero` in `Extension.sys.mjs` and treats a missing key as a fatal
manifest error: the plugin is dropped with no entry in `extensions.json` and no
log line. All three of `id`, `update_url` and `strict_max_version` are
required — `update_url` is not optional even for a plugin that will never
self-update.

**The plugin loads but is disabled.** Zotero forces `strictCompatibility` on for
non-beta builds, so `strict_max_version` is enforced against the running
version. The Zotero docs' sample manifests pin `7.1.*`, which is already
incompatible with Zotero 9.

**Nothing happens after editing the manifest.** The proxy filename must match
`applications.zotero.id` exactly. A mismatch looks identical to the plugin not
being found at all.

**Changes don't take effect.** Zotero caches plugin files; `scripts/zotero.ts`
always passes `-purgecaches`. It also passes `-ZoteroDebugText` and `-jsconsole`.

**`prefs.js` edits get reverted.** Zotero rewrites the file on exit. Close it
first.

Note that `strict_max_version` is currently `9.*` and `update_url` points at
`https://reiher.dev/zotero-lib-view/updates.json`, which does not exist yet. A
404 is harmless during development, but both need attention before release.

## Status

`LibViewPlugin.addToWindow()` still carries the placeholder decoration inherited
from Zotero's `make-it-red` sample — red item rows plus a *Make It Green
Instead* toggle in the View menu. It is deliberately still there: it is a
one-glance check that the stylesheet, the Fluent locale and the menu wiring all
reach the main window. Replace it when the grid lands.

### Roadmap

- **Faster reloads.** A full restart is ~15s. `Zotero.Plugins.reload(id)` re-runs
  `shutdown`/`startup` in place; reaching it from outside needs a pref-gated
  debug-bridge endpoint.
- **Decide where the grid mounts.** Zotero 7's item tree is a virtualized React
  list and won't become a grid through CSS. Either a new pane beside the item
  tree, or swapping the items pane contents behind a mode toggle.
- **Cover sources.** Zotero has no cover field. Options are rendering page 1 of
  a PDF attachment, or fetching by ISBN/DOI (Open Library, Google Books), plus a
  cache. This will shape the design more than the rendering will.
- **Packaging.** An XPI zip script and a real `updates.json`.
