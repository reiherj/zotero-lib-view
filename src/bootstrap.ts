/**
 * Bootstrap scope. Zotero loads this file directly, so it must stay a classic
 * script: no imports, no exports. esbuild transpiles it without bundling, which
 * keeps these top-level function declarations where Zotero can find them.
 * All real logic lives in src/index.ts, bundled to lib-view.js.
 */

/**
 * Declared here rather than in a .d.ts so the `var` survives into
 * build/bootstrap.js: lib-view.js is evaluated in this scope and assigns to it,
 * which would throw under the "use strict" esbuild emits if it were undeclared.
 */
var LibView: import("./lib-view.ts").LibViewPlugin | undefined;

function log(msg: string) {
	Zotero.debug(`${__ADDON_NAME__}: ${msg}`);
}

function install() {
	log(`Installed ${__ADDON_VERSION__}`);
}

async function startup({ id, version, rootURI }: BootstrapData) {
	log(`Starting ${__ADDON_VERSION__}`);

	Zotero.PreferencePanes.register({
		pluginID: __ADDON_ID__,
		src: `${rootURI}preferences.xhtml`,
		scripts: [`${rootURI}preferences.js`],
	});

	Services.scriptloader.loadSubScript(`${rootURI}${__ADDON_REF__}.js`);
	LibView!.init({ id, version, rootURI });
	LibView!.addToAllWindows();
	await LibView!.main();
}

function onMainWindowLoad({ window }: { window: Window }) {
	LibView?.addToWindow(window);
}

function onMainWindowUnload({ window }: { window: Window }) {
	LibView?.removeFromWindow(window);
}

function shutdown() {
	log("Shutting down");
	LibView?.removeFromAllWindows();
	LibView = undefined;
}

function uninstall() {
	log("Uninstalled");
}
