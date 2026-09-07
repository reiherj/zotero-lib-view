/** Build-time constants injected by esbuild (see scripts/build.ts). */
declare const __ADDON_ID__: string;
declare const __ADDON_NAME__: string;
declare const __ADDON_REF__: string;
declare const __ADDON_VERSION__: string;
declare const __PREFS_PREFIX__: string;

interface BootstrapData {
	id: string;
	version: string;
	rootURI: string;
}
