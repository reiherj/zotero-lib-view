import { placeholderHue, resolveCover } from "./covers.ts";

const CHUNK_SIZE = 120;
const REFRESH_DEBOUNCE_MS = 120;

/**
 * The grid for one main window.
 *
 * The grid is an overlay on `#zotero-items-pane` rather than a replacement for
 * the item tree. The tree stays in the DOM, laid out and updating underneath —
 * which means Zotero keeps owning sorting, filtering, the quick search and the
 * selection, and this class only has to mirror the result. It also gives us a
 * dependency-free way to know when anything changed: a MutationObserver on the
 * tree fires whenever Zotero re-renders its rows, so no Zotero internals are
 * patched and nothing needs restoring on shutdown.
 */
export class GridView {
	private grid: HTMLElement | null = null;
	private toggle: any = null;
	private observer: MutationObserver | null = null;
	private covers: IntersectionObserver | null = null;
	private sentinel: IntersectionObserver | null = null;
	private refreshTimer: number | undefined;
	private rendered = 0;
	private items: any[] = [];
	private enabled = false;

	constructor(
		private window: Window,
		private rootURI: string,
		private log: (msg: string) => void,
	) {}

	private get doc() {
		return this.window.document;
	}

	private get pane() {
		return this.doc.getElementById("zotero-items-pane");
	}

	attach(enabled: boolean) {
		const pane = this.pane;
		const toolbar = this.doc.getElementById("zotero-items-toolbar");
		if (!pane || !toolbar) {
			this.log("Items pane not found; grid not attached");
			return;
		}

		this.toggle = (this.doc as any).createXULElement("toolbarbutton");
		this.toggle.id = `${__ADDON_REF__}-toggle`;
		this.toggle.className = "zotero-tb-button";
		this.toggle.setAttribute("type", "checkbox");
		this.toggle.setAttribute("tabindex", "-1");
		this.toggle.setAttribute("data-l10n-id", `${__ADDON_REF__}-toggle`);
		this.toggle.addEventListener("command", () => {
			this.window.dispatchEvent(
				new this.window.CustomEvent(`${__ADDON_REF__}:toggle`, {
					detail: { enabled: this.toggle.checked },
				}),
			);
		});
		// Sits next to the quick search, where view controls belong.
		toolbar.insertBefore(this.toggle, this.doc.getElementById("zotero-tb-search"));

		this.grid = this.doc.createElement("div");
		this.grid.id = `${__ADDON_REF__}-grid`;
		this.grid.addEventListener("click", (event) => this.onClick(event));
		this.grid.addEventListener("dblclick", (event) => this.onDoubleClick(event));
		pane.appendChild(this.grid);

		this.covers = new this.window.IntersectionObserver(
			(entries: IntersectionObserverEntry[]) => this.loadCovers(entries),
			{ root: this.grid, rootMargin: "200px" },
		);
		this.sentinel = new this.window.IntersectionObserver(
			(entries: IntersectionObserverEntry[]) => {
				if (entries.some((entry) => entry.isIntersecting)) this.renderChunk();
			},
			{ root: this.grid, rootMargin: "400px" },
		);

		const tree = this.doc.getElementById("zotero-items-tree");
		if (tree) {
			const observer = new this.window.MutationObserver(() => this.scheduleRefresh());
			observer.observe(tree, { childList: true, subtree: true });
			this.observer = observer;
		}

		if (__DEV__) {
			this.log(`Attached: toggle=${!!this.toggle} grid=${!!this.grid} tree=${!!tree}`);
		}
		this.setEnabled(enabled);
	}

	detach() {
		this.observer?.disconnect();
		this.covers?.disconnect();
		this.sentinel?.disconnect();
		this.window.clearTimeout(this.refreshTimer);
		this.grid?.remove();
		this.toggle?.remove();
		this.pane?.removeAttribute(`data-${__ADDON_REF__}-active`);
		this.grid = this.toggle = this.observer = this.covers = this.sentinel = null;
	}

	setEnabled(enabled: boolean) {
		this.enabled = enabled;
		if (this.toggle) this.toggle.checked = enabled;
		if (enabled) {
			this.pane?.setAttribute(`data-${__ADDON_REF__}-active`, "true");
			this.refresh();
		} else {
			this.pane?.removeAttribute(`data-${__ADDON_REF__}-active`);
		}
	}

	setTileWidth(width: number) {
		this.grid?.style.setProperty(`--${__ADDON_REF__}-tile`, `${width}px`);
	}

	private scheduleRefresh() {
		if (!this.enabled) return;
		this.window.clearTimeout(this.refreshTimer);
		this.refreshTimer = this.window.setTimeout(
			() => this.refresh(),
			REFRESH_DEBOUNCE_MS,
		);
	}

	refresh() {
		if (!this.enabled || !this.grid) return;
		const itemsView = (this.window as any).ZoteroPane?.itemsView;
		this.items = itemsView?.getSortedItems?.() ?? [];
		this.grid.replaceChildren();
		this.rendered = 0;
		this.renderChunk();
		if (__DEV__) {
			this.log(`Refreshed: ${this.items.length} items, ${this.rendered} tiles rendered`);
		}
	}

	/**
	 * Render tiles in chunks and pull in more as the user scrolls, so opening a
	 * large library doesn't build thousands of nodes up front.
	 */
	private renderChunk() {
		if (!this.grid) return;
		this.grid.querySelector(`.${__ADDON_REF__}-sentinel`)?.remove();

		const selected = new Set<number>(
			((this.window as any).ZoteroPane?.getSelectedItems?.() ?? []).map(
				(item: any) => item.id as number,
			),
		);
		const end = Math.min(this.rendered + CHUNK_SIZE, this.items.length);
		const fragment = this.doc.createDocumentFragment();
		for (let i = this.rendered; i < end; i++) {
			fragment.appendChild(this.buildTile(this.items[i], selected));
		}
		this.grid.appendChild(fragment);
		this.rendered = end;

		if (this.rendered < this.items.length) {
			const sentinel = this.doc.createElement("div");
			sentinel.className = `${__ADDON_REF__}-sentinel`;
			this.grid.appendChild(sentinel);
			this.sentinel?.observe(sentinel);
		}
	}

	private buildTile(item: any, selected: Set<number>): HTMLElement {
		const tile = this.doc.createElement("div");
		tile.className = `${__ADDON_REF__}-tile`;
		tile.dataset.itemId = String(item.id);
		if (selected.has(item.id)) tile.classList.add("selected");

		const cover = this.doc.createElement("div");
		cover.className = `${__ADDON_REF__}-cover`;
		cover.style.setProperty(`--${__ADDON_REF__}-hue`, String(placeholderHue(item)));
		// The title doubles as the placeholder face when no image is found.
		cover.dataset.initial = (item.getDisplayTitle?.() ?? "?").trim().charAt(0);
		tile.appendChild(cover);

		const title = this.doc.createElement("div");
		title.className = `${__ADDON_REF__}-title`;
		title.textContent = item.getDisplayTitle?.() ?? "";
		tile.appendChild(title);

		const meta = this.doc.createElement("div");
		meta.className = `${__ADDON_REF__}-meta`;
		const creator = item.getField?.("firstCreator") ?? "";
		const year = String(item.getField?.("date") ?? "").match(/\d{4}/)?.[0] ?? "";
		meta.textContent = [creator, year].filter(Boolean).join(" · ");
		tile.appendChild(meta);

		this.covers?.observe(tile);
		return tile;
	}

	/** Covers are read from disk only once a tile is near the viewport. */
	private async loadCovers(entries: IntersectionObserverEntry[]) {
		for (const entry of entries) {
			if (!entry.isIntersecting) continue;
			const tile = entry.target as HTMLElement;
			this.covers?.unobserve(tile);

			const item = Zotero.Items.get(Number(tile.dataset.itemId)) as any;
			if (!item) continue;
			const url = await resolveCover(item, { window: this.window, rootURI: this.rootURI });
			if (!url || !tile.isConnected) continue;

			const cover = tile.querySelector(`.${__ADDON_REF__}-cover`) as HTMLElement;
			const image = this.doc.createElement("img");
			image.src = url;
			image.alt = "";
			image.addEventListener("load", () => cover.classList.add("has-image"));
			cover.appendChild(image);
		}
	}

	private tileFor(event: Event): HTMLElement | null {
		return (event.target as HTMLElement).closest?.(
			`.${__ADDON_REF__}-tile`,
		) as HTMLElement | null;
	}

	private onClick(event: Event) {
		const tile = this.tileFor(event);
		if (!tile) return;
		for (const other of this.grid!.querySelectorAll(".selected")) {
			(other as HTMLElement).classList.remove("selected");
		}
		tile.classList.add("selected");
		// Selecting in the tree keeps the item pane and Zotero's own state in sync.
		(this.window as any).ZoteroPane?.itemsView?.selectItem(Number(tile.dataset.itemId));
	}

	private onDoubleClick(event: Event) {
		const tile = this.tileFor(event);
		if (!tile) return;
		const item = Zotero.Items.get(Number(tile.dataset.itemId));
		if (item) (this.window as any).ZoteroPane?.viewItems([item]);
	}
}
