import { LibViewPlugin } from "./lib-view.ts";

// Assigns the `var LibView` declared in bootstrap.js. Services.scriptloader
// evaluates this bundle in the bootstrap scope, so a bare assignment lands
// on that binding.
LibView = new LibViewPlugin();
