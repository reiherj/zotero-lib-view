# Library Grid View

A Zotero plugin that renders your library as a grid of item covers instead of a
list of rows.

Covers are rendered from the first page of each item's PDF attachment, so a
library of books looks like a shelf rather than a list of titles.

## Requirements

- Zotero 7.0 or newer (developed against **9.0.6**)
- Node.js 20+ (developed against **24.14.1**)
- macOS. The scripts shell out to `osascript`/`pgrep` to control Zotero, so on
  Linux or Windows you'd need to adapt `scripts/zotero.ts`.

## Quick start

```sh
npm install
npm run dev
```

That builds the plugin, links it into your Zotero profile, launches Zotero, and
then watches `src/` and `addon/`. Most saves reload the plugin in place in a few
milliseconds. See [Fast reload](#fast-reload). Zotero's debug output is appended
to `zotero.log` in the project root.

Nothing is copied into the profile. `npm run link` writes an **extension proxy
file**, a text file named after the plugin id whose contents are the absolute
path to `build/`:

```
~/Library/Application Support/Zotero/Profiles/<profile>/extensions/zotero-lib-view@reiher.dev
```

Zotero only rescans that directory when it believes the application changed, so
`link` also strips `extensions.lastAppBuildId` and `extensions.lastAppVersion`
from the profile's `prefs.js`. Zotero must be closed while this happens, or it
overwrites `prefs.js` on exit, and `npm run dev` handles the ordering for you.

## Scripts

| Script | Does |
| --- | --- |
| `npm run dev` | Build, link, launch, then watch and restart on change |
| `npm run build` | Build `build/` once |
| `npm run link` | Write the proxy file into the Zotero profile (Zotero must be closed) |
| `npm run reload` | Reload the plugin in a running Zotero without restarting |
| `npm start` | Restart Zotero against the current build |
| `npm run stop` | Quit Zotero |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run clean` | Remove `build/` |

Override the defaults if your setup differs:

- `ZOTERO_BIN`: path to the Zotero binary
  (default `/Applications/Zotero.app/Contents/MacOS/zotero`)
- `ZOTERO_PROFILE_DIR`: profile directory (default is the profile marked
  `Default=1` in `~/Library/Application Support/Zotero/profiles.ini`)
- `ZOTERO_PORT`: Zotero's HTTP server port (default `23119`)
- `ZOTERO_JSCONSOLE=1`: also launch the Browser Console. Off by default because
  the extra window is noisy and can stall the AppleScript quit on restart.

## Layout

```
addon/            Static assets copied to build/, with __placeholders__ substituted
  manifest.json
  prefs.js        Default preference values
  pdf-bridge.mjs  Loads Zotero's pdf.js into a window (see Covers)
  preferences.xhtml
  style.css
  locale/en-US/lib-view.ftl
src/
  bootstrap.ts    Zotero's entry points, transpiled but never bundled
  index.ts        Bundle entry, assigns the global bootstrap declares
  lib-view.ts     Plugin lifecycle, windows, toggle state
  grid/grid-view.ts  The grid overlay for one window
  grid/covers.ts     Cover resolution and caching
  dev-reload.ts   Dev-only reload endpoint, compiled out of release builds
  preferences.ts  Preference pane script, transpiled but never bundled
  globals.d.ts    Build-time constants and shared types
scripts/          Build, link and Zotero-process tooling (run with tsx)
  config.ts       Paths, identity, profile discovery
  build.ts        esbuild + asset copy
  dev.ts          Watch loop
  reload.ts       Pokes the reload endpoint
  link.ts         Proxy file + prefs surgery
  zotero.ts       start / stop / restart
build/            Build output, the plugin Zotero actually loads
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
constants: `__ADDON_ID__`, `__ADDON_NAME__`, `__ADDON_REF__`,
`__ADDON_VERSION__`, `__PREFS_PREFIX__`, declared in `src/globals.d.ts`. Static
files in `addon/` get textual substitution of `__addonID__`-style placeholders,
which is also how `manifest.json` picks up the version from `package.json`.

Renaming the plugin means editing `package.json` and nothing else.

### Two build modes, on purpose

`bootstrap.ts` and `preferences.ts` are **transpiled but not bundled**. Zotero
evaluates them as classic scripts and looks up their top-level declarations
(`startup`, `shutdown`, `onMainWindowLoad`, …) by name in that scope, and an
esbuild IIFE wrapper would hide them. Everything else is bundled into
`lib-view.js`, which `bootstrap.js` loads with `Services.scriptloader`.

One consequence worth knowing before you touch `bootstrap.ts`: esbuild emits
`"use strict"`, and `lib-view.js` reaches back to assign the shared `LibView`
global. Under strict mode that throws `ReferenceError` unless a real `var
LibView` survives into `build/bootstrap.js`, which is why it is declared in
`bootstrap.ts` rather than in a `.d.ts`. Don't move it.

### Fast reload

A full Zotero restart is about 15 seconds. Most saves avoid it: `npm run dev`
rebuilds and then asks the running plugin to reload itself, which lands in
single-digit milliseconds.

Zotero has no public reload API, so the plugin registers one on Zotero's own
HTTP server (`http://127.0.0.1:23119/lib-view/reload`, see `src/dev-reload.ts`).
The handler calls `addon.reload()`, which disables and re-enables the plugin,
running `shutdown()` then `startup()`.

The endpoint exists only in dev builds. `__DEV__` is an esbuild define, so a
production build reduces the call to `if (false)` and drops the module and its
import entirely, and `npm run build` output contains no trace of it.

**What a reload does and does not pick up.** Zotero does not tear down the
plugin's sandbox scope when a plugin is disabled, because `onDisabled` never
calls `_unloadScope`, so `bootstrap.js` is *not* re-read. But `startup()`
re-loads `lib-view.js` every time, so everything bundled there is fresh. Two
supporting details make that reliable: `bootstrap.ts` loads the bundle with
`loadSubScriptWithOptions(..., { ignoreCache: true })` rather than plain
`loadSubScript`, which would serve the previously cached copy, and the
stylesheet `<link>` carries a `?v=<timestamp>` cache-buster.

`scripts/dev.ts` therefore falls back to a full restart when `src/bootstrap.ts`,
`addon/manifest.json` or `addon/prefs.js` changes, and whenever the endpoint is
unreachable, which is what happens when a build has a startup error and the
plugin never re-registers it.

One rough edge worth knowing: `addon.reload()` sets `userDisabled` true and then
false. If it throws in between, the plugin is left disabled and stays that way
across restarts. The handler catches that and calls `addon.enable()`, but if it
ever does get stuck, re-enable it in Tools → Add-ons.

## How the grid works

The toggle lives next to the quick search in the items toolbar, and is mirrored
by a *Grid View* item in the View menu. Both write
`extensions.lib-view.gridEnabled`, which is read back on startup, so the choice
survives restarts. The line view is the default.

### It overlays the tree, it does not replace it

`#lib-view-grid` is absolutely positioned over `#zotero-items-pane`. The item
tree stays in the DOM underneath, laid out and updating. That is deliberate:
Zotero keeps owning sorting, filtering, the quick search and the selection
model, and the grid only mirrors `itemsView.getSortedItems()`.

It also solves change detection without touching Zotero internals. A
MutationObserver on `#zotero-items-tree` fires whenever Zotero re-renders its
rows, whether that is a different collection, a new search, a re-sort or an
added item, so the grid refreshes off Zotero's own work. Nothing is
monkey-patched, and there is nothing to restore on shutdown.

Clicking a tile calls `itemsView.selectItem()` so the item pane follows, and
double-clicking calls `ZoteroPane.viewItems()`. Tiles render in chunks of 120
with an IntersectionObserver sentinel pulling in more on scroll, so a large
library does not build thousands of nodes up front.

### Covers

`src/grid/covers.ts` tries providers in order and takes the first hit:

1. the item is itself an image attachment
2. an image attached to the item, a cover the user saved
3. the first page of a PDF attachment, rendered with pdf.js

Anything with no hit gets a placeholder: the title's first character on a hue
derived from that title, so tiles stay distinguishable and stable across
re-sorts. Adding a source (a lookup by ISBN, say) means adding one function to
`PROVIDERS`.

Renders are deduplicated by item id while in flight, because two tiles scrolling
into view together would otherwise render the same PDF twice and race the cache
write.

Rendered pages are cached as JPEGs under `<data directory>/lib-view/covers/`,
keyed by item id. They are roughly 30KB each, and far too slow to redo on every
scroll or restart. The cache is dropped only when an *attachment* changes.
Invalidating on every item change would throw covers away when you add a tag.

Two things about pdf.js are worth knowing before touching that code. Zotero
already ships it, so the plugin borrows it instead of bundling a copy, but it
is the **browser** build, and it reads `window` and `navigator` at import time.
`ChromeUtils.importESModule()` into the plugin sandbox therefore throws
`ReferenceError: navigator is not defined`. `addon/pdf-bridge.mjs` is injected
into the Zotero window as a module script instead, where those globals exist,
and hands the module back on `window["lib-view_pdfjs"]`. And `getDocument()` has
to be given bytes rather than a URL, because pdf.js resolves a URL against
`window.location`, which the calling scope does not have.

A third: when a page uses a soft mask, pdf.js appends SVG filter elements to
`document.body`. The Zotero pane is a XUL document with no body, so those pages
threw and fell back to placeholders. Rendering happens in a hidden `about:blank`
iframe, passed to `getDocument()` as `ownerDocument`, which has a real body.
That iframe is usable as soon as it is in the tree and does not reliably fire
`load`. Waiting on that event alone hangs forever, so the code checks
`contentDocument` first and keeps a timeout.

The cover slot is a fixed 2:3 box, but the image is only *contained* in it and
sits on the baseline. Book covers are not all 2:3, and `object-fit: cover` was
slicing the edges off the wider ones.

### Preferences

Defaults live in `addon/prefs.js` under the `extensions.lib-view` prefix:
`gridEnabled` (false) and `tileWidth` (150px, exposed in the plugin's
preference pane). They are read with
`Zotero.Prefs.get("extensions.lib-view.tileWidth", true)`, where the trailing
`true` means "this is a full pref name, don't prepend `extensions.zotero.`".

`gridEnabled` is cached in memory on startup rather than re-read per use,
because a dev reload clears and re-applies the plugin's default prefs, so two
reads moments apart can disagree.

## Gotchas

Zotero fails silently in most of these cases, so they are worth recognising.

**The plugin doesn't load and nothing appears in the log.** Zotero 9 validates
`applications.zotero` in `Extension.sys.mjs` and treats a missing key as a fatal
manifest error: the plugin is dropped with no entry in `extensions.json` and no
log line. All three of `id`, `update_url` and `strict_max_version` are
required, and `update_url` is not optional even for a plugin that will never
self-update.

**The plugin loads but is disabled.** Zotero forces `strictCompatibility` on for
non-beta builds, so `strict_max_version` is enforced against the running
version. The Zotero docs' sample manifests pin `7.1.*`, which is already
incompatible with Zotero 9.

**Nothing happens after editing the manifest.** The proxy filename must match
`applications.zotero.id` exactly. A mismatch looks identical to the plugin not
being found at all.

**Changes don't take effect.** Zotero caches plugin files, so
`scripts/zotero.ts` always passes `-purgecaches`. It also passes
`-ZoteroDebugText` and `-jsconsole`.

**`prefs.js` edits get reverted.** Zotero rewrites the file on exit. Close it
first.

**Editing `scripts/` seems to do nothing.** The watcher only watches `src/` and
`addon/`. Changes to the build tooling need `npm run dev` restarted.

Note that `strict_max_version` is currently `9.*` and `update_url` points at
`https://reiher.dev/zotero-lib-view/updates.json`, which does not exist yet. A
404 is harmless during development, but both need attention before release.

## Roadmap

- **Keyboard navigation.** The grid has none: arrow keys still go to the item
  tree underneath. Selection, click and double-click work.
- **More cover sources.** A lookup by ISBN/DOI (Open Library, Google Books)
  would cover items whose PDF first page is a title page rather than a jacket,
  and items with no attachment at all.
- **Cache housekeeping.** Nothing evicts `<data directory>/lib-view/covers/`
  when items are deleted.
- **Packaging.** An XPI zip script and a real `updates.json`.
