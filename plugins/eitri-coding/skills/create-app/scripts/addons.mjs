#!/usr/bin/env node
// Installs create-app's add-ons into a wired VTEX template repo and prints
// { applied, skipped, todo } as JSON. Safe to run again: done steps are skipped.
//
//   node addons.mjs apply --repo . [--features .eitri/store-features.json]
//
// What they add (each driven by remote config that analyze-store.mjs proposes):
//   - catalog badges on the product cards: VTEX highlights, specification values, collections (appConfigs.badges)
//   - review ratings on cards and the PDP from the store's provider (appConfigs.reviews)
//   - CMS sections: Countdown, VideoStories, TabbedProductShelf
//   - legacy search: facets as query/map on a store whose GraphQL search ignores them (appConfigs.legacySearchFacets)
//   - banner layouts read from a capture: Mosaic (tiles at their own boxes) and GridList columns / round tiles
//   - the home defaults (src/utils/defaultHome.js, from --features → home.cmsSections) and the template's
//     CMS views made safe while the store's CMS is empty
// A `todo` is a step whose anchor the repo no longer has: do it by hand, as it says.
import { readFileSync } from "node:fs"
import { applyAddons } from "./lib/addons.mjs"

const args = process.argv.slice(2)
const repoAt = args.indexOf("--repo")
if (args[0] !== "apply" || repoAt < 0 || !args[repoAt + 1]) {
    console.error("usage: addons.mjs apply --repo <repo> [--features <store-features.json>]")
    process.exit(2)
}
try {
    const featuresAt = args.indexOf("--features")
    const features = featuresAt >= 0 ? JSON.parse(readFileSync(args[featuresAt + 1], "utf8")) : undefined
    console.log(JSON.stringify(applyAddons(args[repoAt + 1], { features }), null, 2))
} catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
}
