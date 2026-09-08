/**
 * Cover resolution.
 *
 * Zotero has no cover field, so a cover has to be derived from what the item
 * already carries. Providers are tried in order. The first hit wins and an item
 * with no hit gets a generated placeholder. Adding a source (a remote lookup by
 * ISBN, say) means adding one function to `PROVIDERS`.
 *
 * Results are cached in memory and, for rendered PDF pages, on disk under the
 * Zotero data directory. Rendering a page is far too slow to repeat on every
 * scroll, let alone every restart.
 */
const IMAGE_CONTENT_TYPES = new Set([
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
	"image/avif",
	"image/tiff",
]);

const PDF_RENDER_WIDTH = 400;
const PDF_JPEG_QUALITY = 0.82;

export interface CoverContext {
	/** A window is needed for its canvas and for pdf.js. The sandbox has no DOM. */
	window: Window;
	rootURI: string;
}

/** Resolved covers, keyed by item id. `null` means "checked, nothing found". */
const cache = new Map<number, string | null>();

const cacheDir = (): string => {
	return PathUtils.join((Zotero as any).DataDirectory.dir, __ADDON_REF__, "covers");
};

const cachePath = (itemID: number): string => {
	return PathUtils.join(cacheDir(), `${itemID}.jpg`);
};

const attachmentsOf = (item: any): any[] => {
	return Zotero.Items.get(item.getAttachments()) as unknown as any[];
};

const fileURLIfImage = async (attachment: any): Promise<string | null> => {
	if (!IMAGE_CONTENT_TYPES.has(attachment.attachmentContentType)) return null;
	const path = await attachment.getFilePathAsync();
	return path ? PathUtils.toFileURI(path) : null;
};

/** The item is itself an image attachment. */
const ownFile = async (item: any): Promise<string | null> => {
	return item.isAttachment() ? fileURLIfImage(item) : null;
};

/** An image attached to the item, a cover the user saved themselves. */
const attachedImage = async (item: any): Promise<string | null> => {
	if (!item.isRegularItem()) return null;
	for (const attachment of attachmentsOf(item)) {
		const url = await fileURLIfImage(attachment);
		if (url) return url;
	}
	return null;
};

const renderDocuments = new WeakMap<Window, Promise<Document>>();

/**
 * pdf.js appends SVG filter elements to `document.body` when a page uses a soft
 * mask. The Zotero pane is a XUL document with no body, so rendering there
 * throws and those covers silently fall back to a placeholder. A hidden
 * about:blank iframe gives pdf.js a document that has one.
 */
const renderDocument = (context: CoverContext): Promise<Document> => {
	let promise = renderDocuments.get(context.window);
	if (promise) return promise;

	promise = new Promise<Document>((resolve, reject) => {
		const iframe = context.window.document.createElementNS(
			"http://www.w3.org/1999/xhtml",
			"iframe",
		) as HTMLIFrameElement;
		iframe.id = `${__ADDON_REF__}-render-frame`;
		iframe.setAttribute("src", "about:blank");
		iframe.style.cssText =
			"position:absolute;width:0;height:0;border:0;visibility:hidden";

		const timer = context.window.setTimeout(
			() => reject(new Error("render frame timed out")),
			5000,
		);
		const ready = () => {
			const doc = iframe.contentDocument;
			if (!doc?.body) return false;
			context.window.clearTimeout(timer);
			resolve(doc);
			return true;
		};

		context.window.document.documentElement.appendChild(iframe);
		// An about:blank iframe in a XUL document is usable as soon as it is in
		// the tree and does not reliably fire `load`. Waiting on that event alone
		// hangs forever. Check first, and keep the listener only as a fallback.
		if (!ready()) {
			iframe.addEventListener("load", () => ready(), { once: true });
		}
	});
	renderDocuments.set(context.window, promise);
	return promise;
};

const PDFJS_GLOBAL = `${__ADDON_REF__}_pdfjs`;
const pdfjsPromises = new WeakMap<Window, Promise<any>>();

/**
 * pdf.js is Zotero's own copy, loaded into the window by addon/pdf-bridge.mjs.
 * It cannot be imported into the plugin sandbox: the browser build reads
 * `window` and `navigator` at import time and neither exists there.
 */
const loadPdfjs = (context: CoverContext): Promise<any> => {
	const window = context.window as any;
	if (window[PDFJS_GLOBAL]) return Promise.resolve(window[PDFJS_GLOBAL]);

	let promise = pdfjsPromises.get(context.window);
	if (promise) return promise;

	promise = new Promise((resolve, reject) => {
		const timer = window.setTimeout(
			() => reject(new Error("pdf.js bridge timed out")),
			15000,
		);
		window.addEventListener(
			`${__ADDON_REF__}:pdfjs-ready`,
			() => {
				window.clearTimeout(timer);
				resolve(window[PDFJS_GLOBAL]);
			},
			{ once: true },
		);
		// createElementNS, not createElement: the Zotero pane is a XUL document,
		// where createElement("script") makes an inert XUL element.
		const script = window.document.createElementNS(
			"http://www.w3.org/1999/xhtml",
			"script",
		) as HTMLScriptElement;
		script.id = `${__ADDON_REF__}-pdf-bridge`;
		script.type = "module";
		script.src = `${context.rootURI}pdf-bridge.mjs?v=${Date.now()}`;
		script.addEventListener("error", () => reject(new Error("pdf.js bridge failed to load")));
		window.document.documentElement.appendChild(script);
	});
	pdfjsPromises.set(context.window, promise);
	return promise;
};

const readDiskCache = async (itemID: number): Promise<string | null> => {
	try {
		const bytes = await IOUtils.read(cachePath(itemID));
		let binary = "";
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return `data:image/jpeg;base64,${btoa(binary)}`;
	} catch {
		return null;
	}
};

const writeDiskCache = async (itemID: number, dataURL: string) => {
	try {
		await IOUtils.makeDirectory(cacheDir(), { createAncestors: true });
		const base64 = dataURL.slice(dataURL.indexOf(",") + 1);
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		await IOUtils.write(cachePath(itemID), bytes);
	} catch (e) {
		Zotero.logError(e as Error);
	}
};

/** First page of the item's PDF attachment, rendered to a JPEG data URL. */
const pdfFirstPage = async (item: any, context: CoverContext): Promise<string | null> => {
	if (!item.isRegularItem()) return null;

	const cached = await readDiskCache(item.id);
	if (cached) return cached;

	const attachment = attachmentsOf(item).find(
		(a) => a.attachmentContentType === "application/pdf",
	);
	if (!attachment) return null;
	const path = await attachment.getFilePathAsync();
	if (!path) return null;

	const pdfjs = await loadPdfjs(context);
	const renderDoc = await renderDocument(context);
	// Bytes, not a url: pdf.js resolves a url against `window.location`, and the
	// module is imported into a scope that has no window.
	const document = await pdfjs.getDocument({
		data: await IOUtils.read(path),
		ownerDocument: renderDoc,
	}).promise;
	try {
		const page = await document.getPage(1);
		const unscaled = page.getViewport({ scale: 1 });
		const viewport = page.getViewport({
			scale: PDF_RENDER_WIDTH / unscaled.width,
		});

		const canvas = renderDoc.createElement("canvas") as HTMLCanvasElement;
		canvas.width = viewport.width;
		canvas.height = viewport.height;
		await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

		const dataURL = canvas.toDataURL("image/jpeg", PDF_JPEG_QUALITY);
		await writeDiskCache(item.id, dataURL);
		return dataURL;
	} finally {
		document.destroy();
	}
};

const PROVIDERS = [ownFile, attachedImage, pdfFirstPage];

/** Resolutions in progress, so the same PDF is never rendered twice at once. */
const inFlight = new Map<number, Promise<string | null>>();

export const resolveCover = (
	item: any,
	context: CoverContext,
): Promise<string | null> => {
	if (cache.has(item.id)) return Promise.resolve(cache.get(item.id)!);

	const existing = inFlight.get(item.id);
	if (existing) return existing;

	const promise = (async () => {
		let url: string | null = null;
		for (const provider of PROVIDERS) {
			try {
				url = await provider(item, context);
			} catch (e) {
				Zotero.logError(e as Error);
				continue;
			}
			if (url) break;
		}
		cache.set(item.id, url);
		return url;
	})().finally(() => inFlight.delete(item.id));

	inFlight.set(item.id, promise);
	return promise;
};

/** Already-resolved cover, if any, without awaiting. Used to avoid a flash. */
export const cachedCover = (itemID: number): string | null | undefined => {
	return cache.get(itemID);
};

/** Drop the per-window pdf.js bridge and render frame. */
export const disposeWindow = (window: Window) => {
	renderDocuments.delete(window);
	pdfjsPromises.delete(window);
	for (const id of [`${__ADDON_REF__}-render-frame`, `${__ADDON_REF__}-pdf-bridge`]) {
		window.document.getElementById(id)?.remove();
	}
	delete (window as any)[PDFJS_GLOBAL];
};

export const forgetCover = (itemID: number) => {
	cache.delete(itemID);
	IOUtils.remove(cachePath(itemID), { ignoreAbsent: true }).catch(() => {});
};

/**
 * Only attachment changes can change an item's cover. Without this filter every
 * unrelated edit, like adding a tag, would throw away a rendered cover and
 * force a re-render of the PDF.
 */
export const forgetCoversFor = (ids: (number | string)[]) => {
	for (const id of ids) {
		const item = Zotero.Items.get(Number(id)) as any;
		if (!item?.isAttachment?.()) continue;
		forgetCover(item.parentItemID ?? item.id);
	}
};

export const clearCovers = () => {
	cache.clear();
};

/**
 * A stable hue per item, so placeholder tiles are distinguishable and don't
 * change as the library is re-sorted.
 */
export const placeholderHue = (item: any): number => {
	const seed = item.getDisplayTitle?.() ?? String(item.id);
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = (hash * 31 + seed.charCodeAt(i)) | 0;
	}
	return Math.abs(hash) % 360;
};
