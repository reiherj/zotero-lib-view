/**
 * Dev-only reload endpoint.
 *
 * Zotero has no public "reload this plugin" API, so the plugin exposes one on
 * Zotero's own HTTP server (127.0.0.1:23119) and `scripts/reload.ts` pokes it.
 *
 * `addon.reload()` disables and re-enables the plugin, which runs shutdown()
 * then startup(). Zotero does *not* tear down the bootstrap sandbox on disable,
 * so bootstrap.js itself is never re-read — but startup() re-loads lib-view.js
 * on every call, so everything bundled there picks up changes. Edits to
 * bootstrap.ts still need a full restart; scripts/dev.ts knows this.
 *
 * The whole module is compiled out of production builds by the __DEV__ define.
 */
const ENDPOINT_PATH = `/${__ADDON_REF__}/reload`;

export function registerReloadEndpoint(log: (msg: string) => void) {
	const endpoints = (Zotero as any).Server?.Endpoints;
	if (!endpoints) {
		log("Zotero.Server unavailable; reload endpoint not registered");
		return;
	}

	endpoints[ENDPOINT_PATH] = class {
		supportedMethods = ["GET"];

		// Must take exactly one parameter: Zotero.Server dispatches on init.length.
		async init(_request: unknown) {
			const { AddonManager } = ChromeUtils.importESModule(
				"resource://gre/modules/AddonManager.sys.mjs",
			);
			const addon = await (AddonManager as any).getAddonByID(__ADDON_ID__);
			if (!addon) {
				return [500, "text/plain", `${__ADDON_ID__} not installed`];
			}

			// Respond before reloading: shutdown() unregisters this endpoint.
			setTimeout(async () => {
				try {
					Services.obs.notifyObservers(null as any, "startupcache-invalidate");
					await addon.reload();
				} catch (e) {
					Zotero.logError(e as Error);
					// reload() disables before it enables; don't leave it off.
					try {
						await addon.enable();
					} catch (enableError) {
						Zotero.logError(enableError as Error);
					}
				}
			}, 0);

			return [200, "text/plain", "reloading"];
		}
	};

	const port = Zotero.Prefs.get("httpServer.port") ?? 23119;
	log(`Reload endpoint: http://127.0.0.1:${port}${ENDPOINT_PATH}`);
}

export function unregisterReloadEndpoint() {
	const endpoints = (Zotero as any).Server?.Endpoints;
	if (endpoints) delete endpoints[ENDPOINT_PATH];
}
