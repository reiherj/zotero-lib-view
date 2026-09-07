# Library Grid View

A Zotero plugin that renders a grid view of item covers.

## Development

```sh
npm install
npm run dev
```

`npm run dev` builds the plugin, links it into your Zotero profile, launches
Zotero, and then rebuilds + restarts Zotero on every change under `src/` or
`addon/`.

| Script | Does |
| --- | --- |
| `npm run dev` | Build, link, launch, then watch and restart on change |
| `npm run build` | Build `build/` once |
| `npm run link` | Write the extension proxy file into the Zotero profile (Zotero must be closed) |
| `npm start` | Restart Zotero against the current build |
| `npm run stop` | Quit Zotero |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run clean` | Remove `build/` |

Zotero's own debug output is appended to `zotero.log` in the project root.

Override the defaults with environment variables if your setup differs:

- `ZOTERO_BIN` — path to the Zotero binary
  (default `/Applications/Zotero.app/Contents/MacOS/zotero`)
- `ZOTERO_PROFILE_DIR` — profile directory (default: the profile marked
  `Default=1` in `~/Library/Application Support/Zotero/profiles.ini`)

## Layout

```
addon/          Static assets copied to build/, with __placeholders__ substituted
src/
  bootstrap.ts  Zotero's entry points — transpiled, never bundled
  index.ts      Bundle entry; assigns the global the bootstrap scope declares
  lib-view.ts   Plugin logic
  preferences.ts
scripts/        Build, link and Zotero-process tooling (run with tsx)
build/          Build output — the plugin Zotero actually loads
```

Plugin identity (id, name, ref, preference prefix) lives in the `config` block
of `package.json` and flows into both the TypeScript sources (as esbuild
`define` constants like `__ADDON_NAME__`) and the static files in `addon/`
(as `__addonName__`-style placeholders).

### Two build modes, on purpose

`bootstrap.js` and `preferences.js` are **transpiled but not bundled**. Zotero
evaluates them as classic scripts and looks up their top-level declarations by
name, which an esbuild IIFE wrapper would hide. Everything else is bundled into
`lib-view.js`, which `bootstrap.js` pulls in with `Services.scriptloader`.

### Manifest requirements

Zotero 9 rejects a plugin outright — no error, no entry in `extensions.json` —
unless `applications.zotero` contains **all** of `id`, `update_url` and
`strict_max_version` (see `Extension.sys.mjs`). The proxy filename in the
profile's `extensions/` directory must also match `id` exactly.

## Status

The window decoration is still the make-it-red placeholder (red rows plus a
View-menu toggle). It stays until the grid lands, as a visible check that the
stylesheet, Fluent locale and menu wiring all reach the main window.
Replace `LibViewPlugin.addToWindow()` to build the real thing.
