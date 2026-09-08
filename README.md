# Library Grid View

A Zotero plugin that shows your library as a grid of covers instead of a list of
rows. Covers are rendered from the first page of each item's PDF attachment, so
a shelf of books looks like a shelf.

Early work in progress. There is no packaged release yet, so you run it from
source.

## Requirements

- Zotero 7.0 or newer (developed against 9.0.6)
- Node.js 20+
- macOS. The scripts drive Zotero with `osascript` and `pgrep`, so other
  platforms need `scripts/zotero.ts` adapted.

## Develop

```sh
npm install
npm run dev
```

That builds the plugin, links it into your Zotero profile, launches Zotero and
then watches `src/` and `addon/`. Most saves reload the plugin in place in a few
milliseconds, and changes to `bootstrap.ts`, the manifest or the default prefs
restart Zotero instead. Debug output is appended to `zotero.log`.

Nothing is copied into the profile. `npm run link` writes a proxy file naming
the absolute path to `build/`, so Zotero loads the build directory in place.
Zotero has to be closed while that happens, and `npm run dev` takes care of the
ordering.

| Script | Does |
| --- | --- |
| `npm run dev` | Build, link, launch, watch |
| `npm run build` | Build `build/` once |
| `npm run link` | Write the proxy file (Zotero must be closed) |
| `npm run reload` | Reload the plugin in a running Zotero |
| `npm start` / `npm run stop` | Restart or quit Zotero |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run clean` | Remove `build/` |

Override `ZOTERO_BIN`, `ZOTERO_PROFILE_DIR` or `ZOTERO_PORT` if your setup
differs. `ZOTERO_JSCONSOLE=1` also opens the Browser Console.

## Layout

```
addon/     Static assets copied to build/, with __placeholders__ substituted
src/       Plugin sources, bundled to lib-view.js by esbuild
scripts/   Build, link and Zotero-process tooling (run with tsx)
build/     Build output, the plugin Zotero actually loads
```

## Things worth knowing

The `config` block in `package.json` holds the plugin id, name and pref prefix.
Everything else picks them up, so renaming means editing that one block.

`src/bootstrap.ts` and `src/preferences.ts` are transpiled but not bundled.
Zotero evaluates them as classic scripts and looks up their top-level names, so
an esbuild wrapper would hide them.

The grid overlays `#zotero-items-pane` rather than replacing the item tree.
Zotero keeps owning sorting, filtering, search and selection, and a
MutationObserver on the tree tells the grid when to refresh.

Rendered covers are cached as JPEGs under `<data directory>/lib-view/covers/`
and only invalidated when an attachment changes.

A manifest missing `id`, `update_url` or `strict_max_version` under
`applications.zotero` makes Zotero drop the plugin with no error and no log
line.

## Todo

- Keyboard navigation in the grid
- Cover lookups by ISBN or DOI for items without a PDF
- Evict cached covers when items are deleted
- Package an XPI and publish a real `updates.json`
