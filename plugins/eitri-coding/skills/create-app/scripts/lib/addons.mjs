// Installs create-app's add-ons into a VTEX template repo: what the template
// lacks to reproduce a store (catalog badges, review ratings, countdown, video
// stories and tabbed shelves). Each step is idempotent (a marker says it is
// done) and anchored on the template's own code: when an anchor is missing the
// step becomes a `todo` with what to do by hand, never a guess.
//
// applyAddons(repo) → { applied: [..], skipped: [..], todo: [..] }
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs"
import { join, dirname, relative, basename } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const ADDONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "addons", "vtex")

/** Mini-apps of the repo by role (the template folder's last word: shared, home, pdp, account, cart, checkout). */
function miniApps(repo) {
    const apps = {}
    for (const entry of [".", ...readdirSync(repo)]) {
        const dir = join(repo, entry)
        const conf = join(dir, "eitri-app.conf.js")
        if (!statSync(dir).isDirectory() || !existsSync(conf)) continue
        const text = readFileSync(conf, "utf8")
        apps[basename(dir === repo ? repo : dir).split("-").pop()] = { dir, conf: text, slug: /'slug'\s*:\s*'([^']+)'/.exec(text)?.[1] }
    }
    return apps
}

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) walk(path, out)
        else out.push(path)
    }
    return out
}

/** Adds names to the file's `import { … } from 'module'` (or a new import line after the last import). */
function addNamedImports(text, module, names) {
    const quoted = module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const existing = new RegExp(`import \\{([^}]*)\\} from '${quoted}'`).exec(text)
    if (existing) {
        const current = existing[1].split(",").map((n) => n.trim()).filter(Boolean)
        const missing = names.filter((n) => !current.includes(n))
        if (!missing.length) return text
        return text.replace(existing[0], `import { ${[...current, ...missing].join(", ")} } from '${module}'`)
    }
    return addImportLine(text, `import { ${names.join(", ")} } from '${module}'`)
}

function addImportLine(text, line) {
    if (text.includes(line)) return text
    const imports = [...text.matchAll(/^import .*$/gm)]
    if (!imports.length) return `${line}\n${text}`
    const last = imports.at(-1)
    const at = last.index + last[0].length
    return `${text.slice(0, at)}\n${line}${text.slice(at)}`
}

/** Appended to the home's ProductService by the legacy search step. */
const LEGACY_SEARCH_FLAG = `
/** appConfigs.legacySearchFacets: the store's GraphQL search ignores selectedFacets (create-app's legacy search add-on). */
const legacySearchOn = async () => {
	try {
		const configs = await Eitri.environment.getRemoteConfigs()
		return configs?.appConfigs?.legacySearchFacets === true
	} catch (e) {
		console.warn('legacySearchFacets: remote config unavailable', e)
		return false
	}
}
`

export function applyAddons(repo, { features } = {}) {
    const report = { applied: [], skipped: [], todo: [] }
    const apps = miniApps(repo)
    const isVtex = Object.values(apps).some((a) => /eitri-shopping-vtex-shared/.test(a.conf))
    if (!isVtex || !apps.shared) {
        report.skipped.push("no VTEX template mini-apps (shared + eitri-shopping-vtex-shared) in this repo: nothing to add")
        return report
    }
    const shared = apps.shared.slug
    const rel = (path) => relative(repo, path)

    /** Runs fn on a file's text when the marker is not there yet; fn returns the new text or null (anchor missing). */
    const edit = (app, path, marker, what, fn, todo) => {
        if (!apps[app]) return
        const file = join(apps[app].dir, path)
        if (!existsSync(file)) return report.todo.push(`${rel(file)}: missing — ${todo}`)
        const text = readFileSync(file, "utf8")
        if (text.includes(marker)) return report.skipped.push(`${rel(file)}: ${what} already there`)
        const next = fn(text)
        if (next === null || next === text) return report.todo.push(`${rel(file)}: ${todo}`)
        writeFileSync(file, next)
        report.applied.push(`${rel(file)}: ${what}`)
    }

    // 1. New files, per mini-app role; a file the repo already has is kept.
    for (const role of readdirSync(join(ADDONS, "files"))) {
        if (!apps[role]) continue
        for (const source of walk(join(ADDONS, "files", role))) {
            const target = join(apps[role].dir, relative(join(ADDONS, "files", role), source))
            if (existsSync(target)) {
                const same = readFileSync(target, "utf8") === readFileSync(source, "utf8")
                if (!same) report.skipped.push(`${rel(target)}: the repo has its own version, kept`)
                continue
            }
            mkdirSync(dirname(target), { recursive: true })
            copyFileSync(source, target)
            report.applied.push(`${rel(target)}: added`)
        }
    }

    // 2. Shared lib exports.
    for (const line of [
        "export { useProductRating, getProductRating } from './services/ReviewsService'",
        "export { default as ProductRatingStars } from './components/ProductCard/components/ProductRatingStars'",
        "export { default as ProductBadges } from './components/ProductBadges/ProductBadges'",
    ]) {
        edit("shared", "src/export.js", line, `export ${/\{([^}]*)\}/.exec(line)[1].trim()}`, (text) => `${text.replace(/\n?$/, "\n")}${line}\n`, `add: ${line}`)
    }

    // 3. Badges: catalog badges from appConfigs.badges, and teasers that no longer throw without data.
    edit(
        "shared",
        "src/services/BadgesService.js",
        "badgesFor(product, config)",
        "catalog badges (appConfigs.badges) and safe teasers",
        (text) => {
            const start = text.indexOf("export default async function getBadgesForProducts")
            const end = text.indexOf("\nfunction parsePromo(")
            if (start < 0 || end < start) return null
            const body = readFileSync(join(ADDONS, "snippets", "BadgesService.getBadgesForProducts.js"), "utf8")
            let next = `${text.slice(0, start)}${body}${text.slice(end + 1)}`
            next = addImportLine(next, "import { getRemoteAppConfigProperty } from '../utils/getRemoteConfigStyleProperty'")
            return addImportLine(next, "import { badgesFor } from './badgesFromCatalog'")
        },
        "replace getBadgesForProducts with the add-on's (snippets/BadgesService.getBadgesForProducts.js) and import badgesFor",
    )

    // 3b. BadgeRender maps badges without keys (React warns once badges actually render).
    edit(
        "shared",
        "src/components/BadgeRender/BadgeRender.jsx",
        "(badge, index)",
        "keys on the rendered badges",
        (text) => {
            const anchor = /badges\?\.map\(badge => \(\n(\t*)<View>/
            if (!anchor.test(text)) return null
            return text.replace(anchor, (_, indent) => `badges?.map((badge, index) => (\n${indent}<View key={index}>`)
        },
        "give each badge's View a key",
    )

    // 4. Ratings: each card wrapper asks its product's rating, the card shows it under the name.
    const cards = new Set()
    for (const app of ["home", "pdp", "account"]) {
        const path = "src/components/ProductCard/ProductCard.jsx"
        const file = apps[app] && join(apps[app].dir, path)
        if (file && existsSync(file)) {
            const implementation = /const Implementation = (\w+)/.exec(readFileSync(file, "utf8"))?.[1]
            if (implementation) cards.add(implementation)
        }
        edit(
            app,
            path,
            "useProductRating(",
            "rating from the reviews provider",
            (text) =>
                text.includes("const rating = null")
                    ? addNamedImports(text.replace("const rating = null", "const rating = useProductRating(product?.productId)"), shared, ["useProductRating"])
                    : null,
            "set the card's `rating` to useProductRating(product?.productId)",
        )
    }
    for (const card of cards.size ? cards : ["ProductCardFullImage"]) {
        edit(
            "shared",
            `src/components/ProductCard/${card}.jsx`,
            "ProductRatingStars",
            "stars under the product name",
            (text) => {
                const anchor = /(\{name\}<\/Text>\n)(\t*)(<\/View>\n)/
                if (!anchor.test(text)) return null
                const next = text.replace(anchor, (_, nameLine, indent, close) => `${nameLine}${indent}${close}${indent}{props?.rating ? <ProductRatingStars rating={props.rating} className='mt-1' /> : null}\n`)
                return addImportLine(next, "import ProductRatingStars from './components/ProductRatingStars'")
            },
            "render {props?.rating ? <ProductRatingStars rating={props.rating} /> : null} under the product name",
        )
    }
    edit(
        "pdp",
        "src/components/MainDescription/MainDescription.jsx",
        "ProductRatingStars",
        "stars under the product title",
        (text) => {
            const title = /(\{product\??\.productName[^}]*\}<\/Text>\n)(\t*)(<\/View>\n)/
            const hook = /(\n(\t*)const \{ t \} = useTranslation\(\)\n)/
            if (!title.test(text) || !hook.test(text)) return null
            let next = text.replace(hook, (_, line, indent) => `${line}${indent}const rating = useProductRating(product?.productId)\n`)
            next = next.replace(title, (_, nameLine, indent, close) => `${nameLine}${indent}${close}${indent}<ProductRatingStars rating={rating} size={14} className='mt-1' />\n`)
            return addNamedImports(next, shared, ["useProductRating", "ProductRatingStars"])
        },
        "show <ProductRatingStars rating={useProductRating(product?.productId)} /> under the product title",
    )

    edit(
        "pdp",
        "src/components/ImageCarousel/ImageCarousel.jsx",
        "ProductBadges",
        "the product's badges on the gallery",
        (text) => {
            const anchor = /\n(\t*)<Slider\n/
            if (!anchor.test(text)) return null
            const next = text.replace(
                anchor,
                (_, indent) => `\n${indent}<ProductBadges product={props?.product} currentSku={currentSku} className='absolute top-3 left-4 z-10 flex flex-col items-start gap-1' />\n${indent}<Slider\n`,
            )
            return addNamedImports(next, shared, ["ProductBadges"])
        },
        "render <ProductBadges product={product} currentSku={currentSku} /> over the gallery",
    )

    // 4b. Legacy search: a store whose GraphQL search ignores selectedFacets (appConfigs.legacySearchFacets, from
    // analyze-store.mjs) gets its facets as query/map, and its legacy facet lists as the filter's groups.
    edit(
        "home",
        "src/services/ProductService.js",
        "toLegacyOptions(",
        "legacy search: facets as query/map behind appConfigs.legacySearchFacets",
        (text) => {
            const search = /\n(\t+)return await Vtex\.searchGraphql\.productSearch\(options\)/
            const facets = /\n(\t+)const result = await Vtex\.searchGraphql\.facets\(options\)/
            if (!search.test(text) || !facets.test(text)) return null
            let next = text.replace(
                search,
                (_, indent) => `\n${indent}const legacy = (await legacySearchOn()) ? toLegacyOptions(options) : null\n${indent}return await Vtex.searchGraphql.productSearch(legacy ?? options)`,
            )
            next = next.replace(
                facets,
                (_, indent) =>
                    `\n${indent}const legacy = (await legacySearchOn()) ? toLegacyOptions(options) : null\n${indent}const result = legacy\n${indent}\t? { facets: legacyFacetGroups(await Vtex.searchGraphql.facets(legacy, LEGACY_FACETS_RETURN)) }\n${indent}\t: await Vtex.searchGraphql.facets(options)`,
            )
            next = addImportLine(next, "import Eitri from 'eitri-bifrost'")
            next = addImportLine(next, "import { toLegacyOptions, legacyFacetGroups, LEGACY_FACETS_RETURN } from './legacySearch'")
            return `${next.replace(/\n*$/, "\n")}${LEGACY_SEARCH_FLAG}`
        },
        "send selectedFacets as query/map (services/legacySearch.js toLegacyOptions) and read facets through legacyFacetGroups when appConfigs.legacySearchFacets is true",
    )

    // 4c. Banner layouts the DOM home reading produces (lib/domHome.mjs): Mosaic, a new mode that keeps each tile's
    // captured box, and GridList with columns and round tiles (a brand grid).
    edit(
        "home",
        "src/components/CmsComponents/Banner/Banner.jsx",
        "import Mosaic from",
        "the Mosaic banner mode",
        (text) => {
            const anchor = /\n(\t)if \(mode === 'SingleBanner'\) \{/
            if (!anchor.test(text)) return null
            const next = text.replace(anchor, (_, indent) => `\n${indent}if (mode === 'Mosaic') {\n${indent}\treturn (\n${indent}\t\t<Mosaic\n${indent}\t\t\tdata={data}\n${indent}\t\t\tonClick={processActions}\n${indent}\t\t/>\n${indent}\t)\n${indent}}\n${indent}if (mode === 'SingleBanner') {`)
            return addImportLine(next, "import Mosaic from './components/Mosaic'")
        },
        "render data.mode 'Mosaic' with components/Mosaic",
    )
    edit(
        "home",
        "src/components/CmsComponents/Banner/components/GridList.jsx",
        "data?.rounded",
        "GridList columns and round tiles",
        (text) => (text.includes("className='grid grid-cols-2 px-4'") ? readFileSync(join(ADDONS, "snippets", "GridList.jsx"), "utf8") : null),
        "support data.columns and data.rounded in GridList (addons/vtex/snippets/GridList.jsx)",
    )

    // 5. Home sections: schema, component map, translations.
    const schemas = JSON.parse(readFileSync(join(ADDONS, "sections.json"), "utf8"))
    if (apps.home) {
        const schemaFile = join(apps.home.dir, "public", "sections.json")
        if (existsSync(schemaFile)) {
            const current = JSON.parse(readFileSync(schemaFile, "utf8"))
            const missing = schemas.filter((s) => !current.some((c) => c.name === s.name))
            if (missing.length) {
                writeFileSync(schemaFile, `${JSON.stringify([...current, ...missing], null, "\t")}\n`)
                report.applied.push(`${rel(schemaFile)}: CMS schema for ${missing.map((s) => s.name).join(", ")}`)
            }
        } else report.todo.push(`${rel(schemaFile)}: missing — add the CMS schemas of addons/vtex/sections.json`)
        for (const { name } of schemas) {
            const mapFile = join(apps.home.dir, "src", "utils", "getMappedComponent.js")
            if (existsSync(mapFile) && new RegExp(`^\\s*${name}\\s*:`, "m").test(readFileSync(mapFile, "utf8"))) {
                report.skipped.push(`${rel(mapFile)}: ${name} already in the component map`)
                continue
            }
            edit(
                "home",
                "src/utils/getMappedComponent.js",
                `\t${name}: ${name},`,
                `${name} in the component map`,
                (text) => {
                    if (!text.includes("const componentMap = {\n")) return null
                    const next = text.replace("const componentMap = {\n", `const componentMap = {\n\t${name}: ${name},\n`)
                    return addImportLine(next, `import ${name} from '../components/CmsComponents/${name}/${name}'`)
                },
                `map "${name}" to components/CmsComponents/${name}/${name}`,
            )
        }
    }
    const locales = JSON.parse(readFileSync(join(ADDONS, "locales.json"), "utf8"))
    for (const [app, byLanguage] of Object.entries(locales)) {
        const root = apps[app] && join(apps[app].dir, "src", "locales")
        if (!root || !existsSync(root)) continue
        for (const language of readdirSync(root)) {
            const file = join(root, language, "translation.json")
            if (!existsSync(file)) continue
            const keys = byLanguage[language.split("-")[0]] ?? byLanguage.en
            const current = JSON.parse(readFileSync(file, "utf8"))
            let changed = false
            for (const [group, values] of Object.entries(keys)) {
                current[group] ??= {}
                for (const [key, value] of Object.entries(values)) {
                    if (current[group][key] === undefined) {
                        current[group][key] = value
                        changed = true
                    }
                }
            }
            if (changed) {
                writeFileSync(file, `${JSON.stringify(current, null, "\t")}\n`)
                report.applied.push(`${rel(file)}: ${Object.keys(keys).join(", ")} texts`)
            }
        }
    }
    // 6. Home defaults: the store's home (analyze-store.mjs → home.cmsSections) while the CMS is empty, and the
    //    template's CMS views made safe for it (they destructure getCmsContent's null answer and crash or hang).
    if (apps.home) {
        const defaults = join(apps.home.dir, "src", "utils", "defaultHome.js")
        const wanted = defaultHomeModule(features?.home?.cmsSections ?? [])
        const current = existsSync(defaults) ? readFileSync(defaults, "utf8") : null
        if (current !== null && !isGeneratedDefaultHome(current)) report.skipped.push(`${rel(defaults)}: edited by hand, kept (compare it with home.cmsSections)`)
        else if (current !== wanted) {
            // Missing, or still exactly what an earlier run generated: a new analysis replaces it.
            mkdirSync(dirname(defaults), { recursive: true })
            writeFileSync(defaults, wanted)
            report.applied.push(`${rel(defaults)}: ${features?.home?.cmsSections?.length ?? 0} captured home section(s) as the default`)
        }
        const importDefaults = (text, names) => addNamedImports(text, "../utils/defaultHome", names)
        edit(
            "home",
            "src/views/Home.jsx",
            "sectionsOrDefault(",
            "the captured home while the CMS has none",
            (text) => {
                const anchor = /const \{ sections \} = await getCmsContent\('home', '([^']*)'\)\n(\t*)return sections/
                if (!anchor.test(text)) return null
                const next = text.replace(anchor, (_, page, indent) => `const page = await getCmsContent('home', '${page}')\n${indent}return sectionsOrDefault(page?.sections, DEFAULT_HOME_SECTIONS)`)
                return importDefaults(next, ["DEFAULT_HOME_SECTIONS", "sectionsOrDefault"])
            },
            "use sectionsOrDefault(page?.sections, DEFAULT_HOME_SECTIONS) where the home reads getCmsContent's sections",
        )
        edit(
            "home",
            "src/views/Categories.jsx",
            "sectionsOrDefault(",
            "the live category tree while the CMS has none",
            (text) => {
                const anchor = /(\t*)const \{ sections \} = await getCmsContent\('categories', '([^']*)'\)\n\t*setCmsContent\(sections\)\n\t*setIsLoading\(false\)/
                if (!anchor.test(text)) return null
                const next = text.replace(
                    anchor,
                    (_, i, page) =>
                        `${i}try {\n${i}\tconst page = await getCmsContent('categories', '${page}')\n${i}\tsetCmsContent(sectionsOrDefault(page?.sections, DEFAULT_CATEGORIES_SECTIONS))\n${i}} catch (e) {\n${i}\tconsole.warn('Categories: CMS unavailable, using the category tree', e)\n${i}\tsetCmsContent(DEFAULT_CATEGORIES_SECTIONS)\n${i}} finally {\n${i}\tsetIsLoading(false)\n${i}}`,
                )
                return importDefaults(next, ["DEFAULT_CATEGORIES_SECTIONS", "sectionsOrDefault"])
            },
            "use sectionsOrDefault(page?.sections, DEFAULT_CATEGORIES_SECTIONS) where Categories reads getCmsContent's sections",
        )
        edit(
            "home",
            "src/views/LandingPage.jsx",
            "sectionsOrDefault(",
            "the biggest discounts when the CMS has no such landing page",
            (text) => {
                const anchor = /const \{ sections \} = await getCmsContent\('landingPage', (\w+)\)\n(\t*)setCmsContent\(sections\)/
                if (!anchor.test(text)) return null
                const next = text.replace(
                    anchor,
                    (_, name, indent) => `const page = ${name} ? await getCmsContent('landingPage', ${name}) : null\n${indent}setCmsContent(sectionsOrDefault(page?.sections, DEFAULT_LANDING_SECTIONS))`,
                )
                return importDefaults(next, ["DEFAULT_LANDING_SECTIONS", "sectionsOrDefault"])
            },
            "use sectionsOrDefault(page?.sections, DEFAULT_LANDING_SECTIONS) where LandingPage reads getCmsContent's sections",
        )
        edit(
            "home",
            "src/views/LandingPage.jsx",
            "tabIndex !== undefined",
            "no back arrow when opened from its bottom tab",
            (text) => {
                const line = "const openInBottomBar = !!props?.location?.state?.openInBottomBar"
                if (!text.includes(line)) return null
                return text.replace(line, `${line} || props?.location?.state?.tabIndex !== undefined`)
            },
            "treat a page opened with { tabIndex } (its bottom tab) as openInBottomBar",
        )
    }
    return report
}

const fingerprint = (sections) => createHash("sha1").update(JSON.stringify(sections)).digest("hex").slice(0, 12)

/**
 * Whether a defaultHome.js is still what defaultHomeModule wrote: its sections match the fingerprint it
 * was stamped with. (Files from before the fingerprint count only while their list is still empty.)
 */
function isGeneratedDefaultHome(text) {
    const start = "export const DEFAULT_HOME_SECTIONS = "
    const end = "\n\n/** Categories while the CMS has no page"
    const from = text.indexOf(start)
    const to = text.indexOf(end)
    if (from < 0 || to < from) return false
    let sections
    try {
        sections = JSON.parse(text.slice(from + start.length, to))
    } catch {
        return false
    }
    const stamp = /create-app fingerprint ([0-9a-f]{12})/.exec(text)?.[1]
    if (!stamp) return Array.isArray(sections) && sections.length === 0 && defaultHomeModule(sections).replace(/\n\/\/ create-app fingerprint.*/, "") === text
    return stamp === fingerprint(sections) && defaultHomeModule(sections) === text
}

function defaultHomeModule(sections) {
    return `// The store's home captured by create-app (analyze-store.mjs → home.cmsSections), in the CMS sections'
// { id, name, data } shape. Home.jsx renders it while the store's Eitri CMS has no "home" page, or one
// without sections; a published CMS page replaces it. Store copy stays in the store's language.
// create-app fingerprint ${fingerprint(sections)}: a rerun of addons.mjs refreshes this file until it is edited.
export const DEFAULT_HOME_SECTIONS = ${JSON.stringify(sections, null, "\t")}

/** Categories while the CMS has no page: the store's live VTEX category tree. */
export const DEFAULT_CATEGORIES_SECTIONS = [{ id: 'default-categories', name: 'CategoryListVtex', data: { exclusionList: '' } }]

/** A landing page the CMS does not have (the "Ofertas" tab): the catalog by biggest discount. */
export const DEFAULT_LANDING_SECTIONS = [{ id: 'default-offers', name: 'ProductInfiniteScroll', data: { sort: 'discount:desc', showFilters: true } }]

/** The CMS page's sections when it has any, else the fallback. */
export function sectionsOrDefault(sections, fallback) {
	return Array.isArray(sections) && sections.length > 0 ? sections : fallback
}
`
}
