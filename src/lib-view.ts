import { registerReloadEndpoint, unregisterReloadEndpoint } from "./dev-reload.ts";
import { clearCovers, forgetCoversFor } from "./grid/covers.ts";
import { GridView } from "./grid/grid-view.ts";

const ENABLED_PREF = `${__PREFS_PREFIX__}.gridEnabled`;
const TILE_WIDTH_PREF = `${__PREFS_PREFIX__}.tileWidth`;

export class LibViewPlugin {
	id: string | null = null;
	version: string | null = null;
	rootURI: string | null = null;
	initialized = false;

	private grids = new Map<Window, GridView>();
	/**
	 * Cached rather than read per-use: during a dev reload Zotero clears and
	 * re-applies the plugin's default prefs, so two reads moments apart can
	 * disagree. The user pref, once written, is authoritative.
	 */
	private enabled = false;
	private addedElementIDs: string[] = [];
	private notifierID: string | null = null;

	init({ id, version, rootURI }: BootstrapData) {
		if (this.initialized) return;
		this.id = id;
		this.version = version;
		this.rootURI = rootURI;
		this.enabled = Zotero.Prefs.get(ENABLED_PREF, true) === true;
		this.initialized = true;
	}

	log(msg: string) {
		Zotero.debug(`${__ADDON_NAME__}: ${msg}`);
	}

	get gridEnabled(): boolean {
		return this.enabled;
	}

	get tileWidth(): number {
		return Number(Zotero.Prefs.get(TILE_WIDTH_PREF, true)) || 150;
	}

	addToWindow(window: Window) {
		const doc = window.document;

		const link = doc.createElement("link");
		link.id = `${__ADDON_REF__}-stylesheet`;
		link.type = "text/css";
		// Cache-busted so a dev reload picks up edited CSS.
		link.href = `${this.rootURI}style.css?v=${Date.now()}`;
		link.rel = "stylesheet";
		doc.documentElement.appendChild(link);
		this.storeAddedElement(link);

		(window as any).MozXULElement.insertFTLIfNeeded(`${__ADDON_REF__}.ftl`);

		const menuitem = (doc as any).createXULElement("menuitem");
		menuitem.id = `${__ADDON_REF__}-view-menuitem`;
		menuitem.setAttribute("type", "checkbox");
		menuitem.setAttribute("data-l10n-id", `${__ADDON_REF__}-toggle`);
		menuitem.checked = this.gridEnabled;
		menuitem.addEventListener("command", () => {
			this.setGridEnabled(menuitem.checked);
		});
		doc.getElementById("menu_viewPopup")?.appendChild(menuitem);
		this.storeAddedElement(menuitem);

		const grid = new GridView(window, this.rootURI!, (msg) => this.log(msg));
		grid.attach(this.gridEnabled);
		grid.setTileWidth(this.tileWidth);
		this.grids.set(window, grid);

		// The toolbar button reports through the window so one code path drives
		// both it and the View menu item.
		window.addEventListener(`${__ADDON_REF__}:toggle`, ((event: CustomEvent) => {
			this.setGridEnabled(event.detail.enabled);
		}) as EventListener);
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
		this.grids.get(window)?.detach();
		this.grids.delete(window);
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

	/** Single source of truth: persist, then push to every window. */
	setGridEnabled(enabled: boolean) {
		this.enabled = enabled;
		Zotero.Prefs.set(ENABLED_PREF, enabled, true);
		for (const [window, grid] of this.grids) {
			grid.setEnabled(enabled);
			const menuitem = window.document.getElementById(
				`${__ADDON_REF__}-view-menuitem`,
			) as any;
			if (menuitem) menuitem.checked = enabled;
		}
	}

	shutdown() {
		if (__DEV__) unregisterReloadEndpoint();
		if (this.notifierID) Zotero.Notifier.unregisterObserver(this.notifierID);
		this.notifierID = null;
		clearCovers();
		this.removeFromAllWindows();
	}

	async main() {
		if (__DEV__) registerReloadEndpoint((msg) => this.log(msg));

		// Attachment changes can add or remove a cover, so drop the cached
		// resolution for the affected items and let the grid re-read it.
		this.notifierID = Zotero.Notifier.registerObserver(
			{
				notify: (_event: string, _type: string, ids: (number | string)[]) => {
					forgetCoversFor(ids);
				},
			},
			["item"],
			__ADDON_REF__,
		) as unknown as string;

		this.log(`Grid ready — ${this.gridEnabled ? "on" : "off"}, tile ${this.tileWidth}px`);
	}
}
