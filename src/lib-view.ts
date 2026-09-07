/**
 * Main plugin logic. Bundled by esbuild into build/lib-view.js and loaded from
 * bootstrap.js via Services.scriptloader.
 *
 * The current window decoration is a placeholder smoke test carried over from
 * the make-it-red example: it proves the stylesheet, Fluent locale and menu
 * wiring all reach the main window. Replace addToWindow() with the cover grid.
 */
export class LibViewPlugin {
	id: string | null = null;
	version: string | null = null;
	rootURI: string | null = null;
	initialized = false;
	addedElementIDs: string[] = [];

	init({ id, version, rootURI }: BootstrapData) {
		if (this.initialized) return;
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this.initialized = true;
	}

	log(msg: string) {
		Zotero.debug(`${__ADDON_NAME__}: ${msg}`);
	}

	addToWindow(window: Window) {
		const doc = window.document;

		const link = doc.createElement("link");
		link.id = `${__ADDON_REF__}-stylesheet`;
		link.type = "text/css";
		link.rel = "stylesheet";
		link.href = `${this.rootURI}style.css`;
		doc.documentElement.appendChild(link);
		this.storeAddedElement(link);

		// Fluent localization; the file is auto-registered from build/locale/
		(window as any).MozXULElement.insertFTLIfNeeded(`${__ADDON_REF__}.ftl`);

		const menuitem = (doc as any).createXULElement("menuitem");
		menuitem.id = `${__ADDON_REF__}-green-instead`;
		menuitem.setAttribute("type", "checkbox");
		menuitem.setAttribute("data-l10n-id", `${__ADDON_REF__}-green-instead`);
		menuitem.addEventListener("command", () => {
			this.toggleGreen(window, menuitem.checked);
		});
		doc.getElementById("menu_viewPopup")!.appendChild(menuitem);
		this.storeAddedElement(menuitem);
	}

	addToAllWindows() {
		for (const win of Zotero.getMainWindows()) {
			if (!(win as any).ZoteroPane) continue;
			this.addToWindow(win as unknown as Window);
		}
	}

	storeAddedElement(elem: Element) {
		if (!elem.id) {
			throw new Error("Element must have an id");
		}
		this.addedElementIDs.push(elem.id);
	}

	removeFromWindow(window: Window) {
		const doc = window.document;
		for (const id of this.addedElementIDs) {
			doc.getElementById(id)?.remove();
		}
		doc.querySelector(`[href="${__ADDON_REF__}.ftl"]`)?.remove();
	}

	removeFromAllWindows() {
		for (const win of Zotero.getMainWindows()) {
			if (!(win as any).ZoteroPane) continue;
			this.removeFromWindow(win as unknown as Window);
		}
	}

	toggleGreen(window: Window, enabled: boolean) {
		window.document.documentElement.toggleAttribute(
			"data-lib-view-green",
			enabled,
		);
	}

	async main() {
		const columns = Zotero.Prefs.get(`${__PREFS_PREFIX__}.columns`, true);
		this.log(`Grid ready — columns: ${columns}`);
	}
}
