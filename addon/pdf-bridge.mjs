/*
 * Loads Zotero's bundled pdf.js into a main window.
 *
 * pdf.js is the browser build: it reads `window`, `navigator` and `document` at
 * import time, so ChromeUtils.importESModule() into a system scope throws. A
 * module script in the Zotero window has all three.
 */
import * as pdfjs from "resource://zotero/reader/pdf/build/pdf.mjs";

pdfjs.GlobalWorkerOptions.workerSrc =
	"resource://zotero/reader/pdf/build/pdf.worker.mjs";
// Bracket notation: the addon ref contains a hyphen.
window["__addonRef___pdfjs"] = pdfjs;
window.dispatchEvent(new CustomEvent("__addonRef__:pdfjs-ready"));
