import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { applyAddons } from "../lib/addons.mjs"

// The anchors the add-ons edit, as the VTEX template ships them (eitri-shopping-template, Nov 2026), after wire-app
// renamed the shared lib to "loja-shared".
const SHARED = "loja-shared"
const FILES = {
    "shopping-vtex-template-shared/eitri-app.conf.js": `module.exports = { 'slug': '${SHARED}', 'eitri-app-dependencies': { 'eitri-shopping-vtex-shared': { isEitriAppShared: true, version: '1.18.0' } } }`,
    "shopping-vtex-template-shared/src/export.js": `export { default as Rating } from './components/ProductCard/components/Rating'\nexport { default as getBadgesForProducts } from './services/BadgesService'\n`,
    "shopping-vtex-template-shared/src/services/BadgesService.js": `import Eitri from 'eitri-bifrost'

export default async function getBadgesForProducts(product, currentSku, VtexContext, contentType) {
	const flagContentSections = await getCmsContent(VtexContext, contentType)
	const badge = []
	for (const teaser of sellerDefault?.commertialOffer?.teasers) {
	}
	return badge
}

function parsePromo(text) {
	return null
}

export const getCmsContent = async (Vtex, contentType) => []
`,
    "shopping-vtex-template-shared/src/components/ProductCard/ProductCardFullImage.jsx": `import WishlistIcon from '../WishlistIcon/WishlistIcon'

export default function ProductCardFullImage(props) {
	const { name } = props
	return (
		<View>
					<View className='mt-2 w-full flex justify-between gap-4 h-[40px]'>
						<Text className='line-clamp-2 font-medium text-sm break-words'>{name}</Text>
					</View>

					<View className='flex flex-col gap-2 mt-1'></View>
		</View>
	)
}
`,
    "shopping-vtex-template-shared/src/components/ProductCard/ProductCardDefault.jsx": `export default function ProductCardDefault(props) {
	return <View>{props.name}</View>
}
`,
    "shopping-vtex-template-shared/src/components/BadgeRender/BadgeRender.jsx": `export default function BadgeRender(props) {
	const { badges, className } = props
	return (
		<View className={className}>
			{badges?.map(badge => (
				<View>
					<Text>{badge?.textBadge?.text}</Text>
				</View>
			))}
		</View>
	)
}
`,
    "shopping-vtex-template-home/eitri-app.conf.js": `module.exports = { 'slug': 'loja-home', 'eitri-app-dependencies': { '${SHARED}': {}, 'eitri-shopping-vtex-shared': {} } }`,
    "shopping-vtex-template-home/src/components/ProductCard/ProductCard.jsx": `import { ProductCardFullImage, TrackingService, getBadgesForProducts } from '${SHARED}'

export default function ProductCard({ product, className }) {
	const rating = null
	return null
}
`,
    "shopping-vtex-template-home/src/utils/getMappedComponent.js": `import Banner from '../components/CmsComponents/Banner/Banner'
import VtexAdsBanner from '../components/CmsComponents/VtexAdsBanner/VtexAdsBanner'

const componentMap = {
	MultipleImageBanner: Banner,
	VtexAdsBanner: VtexAdsBanner
}
`,
    "shopping-vtex-template-home/public/sections.json": JSON.stringify([{ name: "MultipleImageBanner", requiredScopes: [], schema: { type: "object", properties: {} } }], null, "\t"),
    "shopping-vtex-template-home/src/locales/pt/translation.json": JSON.stringify({ home: { offers: "Ofertas" } }, null, "\t"),
    "shopping-vtex-template-home/src/locales/en/translation.json": JSON.stringify({ home: { offers: "Offers" } }, null, "\t"),
    "shopping-vtex-template-home/src/services/ProductService.js": `import { Vtex } from 'eitri-shopping-vtex-shared'
import { resolveSortParam } from './helpers/resolveSortParam'

export const getProductsService = async (params, page) => {
	const options = {
		fullText: params?.query || params?.q || '',
		selectedFacets: selectedFacets
	}

	return await Vtex.searchGraphql.productSearch(options)
}

export const getProductsFacetsService = async params => {
	const options = {
		fullText: params?.query || params?.q || '',
		selectedFacets: selectedFacets,
		hideUnavailableItems: true
	}

	const result = await Vtex.searchGraphql.facets(options)

	if (!result || typeof result !== 'object') {
		return { facets: [] }
	}
	return result
}
`,
    "shopping-vtex-template-home/src/components/CmsComponents/Banner/Banner.jsx": "import { View } from 'eitri-luminus'\nimport SliderHero from './components/SliderHero'\nimport BannerList from './components/BannerList'\nimport FitOnScreen from './components/FitOnScreen'\nimport GridList from './components/GridList'\nimport RoundedBannerList from './components/RoundedBannerList'\nimport SingleBanner from './components/SingleBanner'\nimport { processActions } from '../../../services/ResolveCmsActions'\n\nexport default function Banner(props) {\n\tconst { data } = props\n\tconst mode = data.mode\n\n\tif (mode === 'SliderHero') {\n\t\treturn (\n\t\t\t<SliderHero\n\t\t\t\tdata={data}\n\t\t\t\tonClick={processActions}\n\t\t\t/>\n\t\t)\n\t}\n\tif (mode === 'BannerList') {\n\t\treturn (\n\t\t\t<BannerList\n\t\t\t\tdata={data}\n\t\t\t\tonClick={processActions}\n\t\t\t/>\n\t\t)\n\t}\n\tif (mode === 'RoundedBannerList') {\n\t\treturn (\n\t\t\t<RoundedBannerList\n\t\t\t\tdata={data}\n\t\t\t\tonClick={processActions}\n\t\t\t/>\n\t\t)\n\t}\n\tif (mode === 'GridList') {\n\t\treturn (\n\t\t\t<GridList\n\t\t\t\tdata={data}\n\t\t\t\tonClick={processActions}\n\t\t\t/>\n\t\t)\n\t}\n\tif (mode === 'SingleBanner') {\n\t\treturn (\n\t\t\t<SingleBanner\n\t\t\t\tdata={data}\n\t\t\t\tonClick={processActions}\n\t\t\t/>\n\t\t)\n\t}\n\tif (mode === 'FitOnScreen') {\n\t\treturn (\n\t\t\t<View>\n\t\t\t\t<FitOnScreen\n\t\t\t\t\tdata={data}\n\t\t\t\t\tonClick={processActions}\n\t\t\t\t/>\n\t\t\t</View>\n\t\t)\n\t}\n\treturn (\n\t\t<SliderHero\n\t\t\tdata={data}\n\t\t\tonClick={processActions}\n\t\t/>\n\t)\n}\n",
    "shopping-vtex-template-home/src/components/CmsComponents/Banner/components/GridList.jsx": "import { Text, View } from 'eitri-luminus'\nimport SectionTitle from '../../../SectionTitle/SectionTitle'\nexport default function GridList(props) {\n\tconst { data, onClick } = props\n\tconst imagesList = data?.images\n\n\tconst gap = data.gap || 8\n\n\treturn (\n\t\t<View>\n\t\t\t<SectionTitle title={data.mainTitle} />\n\t\t\t<View\n\t\t\t\tstyle={{ gap: `${gap}px` }}\n\t\t\t\tclassName='grid grid-cols-2 px-4'>\n\t\t\t\t{imagesList?.map(image => (\n\t\t\t\t\t<View\n\t\t\t\t\t\tkey={image.imageUrl || image.externalImageUrl}\n\t\t\t\t\t\tonClick={() => onClick(image)}\n\t\t\t\t\t\tclassName='' // Adjust for two items per row with spacing\n\t\t\t\t\t>\n\t\t\t\t\t\t<Image\n\t\t\t\t\t\t\tsrc={image.imageUrl || image.externalImageUrl}\n\t\t\t\t\t\t\tclassName='w-full h-auto rounded'\n\t\t\t\t\t\t/>\n\t\t\t\t\t\t{image.subLabel && (\n\t\t\t\t\t\t\t<Text className='block text-sm font-bold text-center mt-1 text-gray-700'>\n\t\t\t\t\t\t\t\t{image.subLabel}\n\t\t\t\t\t\t\t</Text>\n\t\t\t\t\t\t)}\n\t\t\t\t\t</View>\n\t\t\t\t))}\n\t\t\t</View>\n\t\t</View>\n\t)\n}\n",
    "shopping-vtex-template-pdp/eitri-app.conf.js": `module.exports = { 'slug': 'loja-pdp', 'eitri-app-dependencies': { 'eitri-shopping-vtex-shared': {} } }`,
    "shopping-vtex-template-pdp/src/components/ProductCard/ProductCard.jsx": `import { ProductCardFullImage, TrackingService, getBadgesForProducts } from '${SHARED}'
	const rating = null
`,
    "shopping-vtex-template-pdp/src/components/ImageCarousel/ImageCarousel.jsx": `import { View, Image } from 'eitri-luminus'
import { Slider } from '${SHARED}'

export default function ImageCarousel(props) {
	const { currentSku } = props
	return (
		<View>
			<View
				className='relative'>
				<Slider
					key={currentSku.itemId}>
				</Slider>
			</View>
		</View>
	)
}
`,
    "shopping-vtex-template-pdp/src/components/MainDescription/MainDescription.jsx": `import { useTranslation } from 'eitri-i18n'
import { GenericBox } from '${SHARED}'

export default function MainDescription(props) {
	const { product, currentSku } = props
	const { t } = useTranslation()
	return (
		<GenericBox>
			<View>
				<View onClick={copyCheckoutId}>
					<Text className='text-xl font-bold'>{product.productName}</Text>
				</View>
			</View>
		</GenericBox>
	)
}
`,
}

function repo() {
    const dir = mkdtempSync(join(tmpdir(), "addons-"))
    for (const [path, content] of Object.entries({ ...FILES, ...VIEWS })) {
        mkdirSync(dirname(join(dir, path)), { recursive: true })
        writeFileSync(join(dir, path), content)
    }
    return dir
}
const read = (dir, path) => readFileSync(join(dir, path), "utf8")

test("applies every add-on to a fresh VTEX template and reports nothing left to do", () => {
    const dir = repo()
    const report = applyAddons(dir)
    assert.deepEqual(report.todo, [])
    assert.ok(report.applied.length >= 10, report.applied.join("\n"))

    for (const file of ["services/badgesFromCatalog.js", "services/reviewsProviders.js", "services/ReviewsService.js", "components/ProductCard/components/ProductRatingStars.jsx"]) {
        assert.ok(existsSync(join(dir, "shopping-vtex-template-shared/src", file)), file)
    }
    const exportJs = read(dir, "shopping-vtex-template-shared/src/export.js")
    assert.match(exportJs, /export \{ useProductRating, getProductRating \} from '.\/services\/ReviewsService'/)
    assert.match(exportJs, /ProductRatingStars/)

    const badges = read(dir, "shopping-vtex-template-shared/src/services/BadgesService.js")
    assert.match(badges, /import \{ badgesFor \} from '.\/badgesFromCatalog'/)
    assert.match(badges, /getRemoteAppConfigProperty\('badges'\)/)
    assert.match(badges, /Array\.isArray\(sellerDefault\?\.commertialOffer\?\.teasers\)/, "the teaser loop no longer throws")
    assert.match(badges, /function parsePromo\(text\)/, "the rest of the file is kept")
    assert.match(badges, /export const getCmsContent/)

    const card = read(dir, "shopping-vtex-template-shared/src/components/ProductCard/ProductCardFullImage.jsx")
    assert.match(card, /import ProductRatingStars from '.\/components\/ProductRatingStars'/)
    assert.match(card, /\{name\}<\/Text>\n\t+<\/View>\n\t+\{props\?\.rating \? <ProductRatingStars rating=\{props\.rating\} className='mt-1' \/> : null\}/)

    for (const app of ["home", "pdp"]) {
        const wrapper = read(dir, `shopping-vtex-template-${app}/src/components/ProductCard/ProductCard.jsx`)
        assert.match(wrapper, /const rating = useProductRating\(product\?\.productId\)/)
        assert.match(wrapper, new RegExp(`import \\{ ProductCardFullImage, TrackingService, getBadgesForProducts, useProductRating \\} from '${SHARED}'`))
    }

    const gallery = read(dir, "shopping-vtex-template-pdp/src/components/ImageCarousel/ImageCarousel.jsx")
    assert.match(gallery, /<ProductBadges product=\{props\?\.product\} currentSku=\{currentSku\} className='absolute top-3 left-4 z-10 flex flex-col items-start gap-1' \/>\n\t+<Slider/)
    assert.match(gallery, new RegExp(`import \\{ Slider, ProductBadges \\} from '${SHARED}'`))
    assert.match(read(dir, "shopping-vtex-template-shared/src/export.js"), /export \{ default as ProductBadges \}/)

    const pdp = read(dir, "shopping-vtex-template-pdp/src/components/MainDescription/MainDescription.jsx")
    assert.match(pdp, /const rating = useProductRating\(product\?\.productId\)/)
    assert.match(pdp, /<ProductRatingStars rating=\{rating\}/)
    assert.match(pdp, new RegExp(`import \\{ GenericBox, useProductRating, ProductRatingStars \\} from '${SHARED}'`))

    assert.match(read(dir, "shopping-vtex-template-shared/src/components/BadgeRender/BadgeRender.jsx"), /badges\?\.map\(\(badge, index\) => \(\n\t+<View key=\{index\}>/)

    const map = read(dir, "shopping-vtex-template-home/src/utils/getMappedComponent.js")
    for (const name of ["Countdown", "VideoStories", "TabbedProductShelf"]) {
        assert.match(map, new RegExp(`import ${name} from '../components/CmsComponents/${name}/${name}'`))
        assert.match(map, new RegExp(`\\t${name}: ${name},`))
        assert.ok(existsSync(join(dir, `shopping-vtex-template-home/src/components/CmsComponents/${name}/${name}.jsx`)))
    }
    const sections = JSON.parse(read(dir, "shopping-vtex-template-home/public/sections.json"))
    assert.deepEqual(
        sections.map((s) => s.name),
        ["MultipleImageBanner", "Countdown", "VideoStories", "TabbedProductShelf"],
    )
    // Legacy search: behind appConfigs.legacySearchFacets, facets go as query/map and come back as the filter's groups.
    assert.ok(existsSync(join(dir, "shopping-vtex-template-home/src/services/legacySearch.js")))
    const products = read(dir, "shopping-vtex-template-home/src/services/ProductService.js")
    assert.match(products, /import \{ toLegacyOptions, legacyFacetGroups, LEGACY_FACETS_RETURN \} from '.\/legacySearch'/)
    assert.match(products, /import Eitri from 'eitri-bifrost'/)
    assert.match(products, /\n\tconst legacy = \(await legacySearchOn\(\)\) \? toLegacyOptions\(options\) : null\n\treturn await Vtex\.searchGraphql\.productSearch\(legacy \?\? options\)/)
    assert.match(products, /legacyFacetGroups\(await Vtex\.searchGraphql\.facets\(legacy, LEGACY_FACETS_RETURN\)\)/)
    assert.match(products, /configs\?\.appConfigs\?\.legacySearchFacets === true/)
    assert.equal(products.match(/const legacySearchOn/g).length, 1)

    // Banner layouts the DOM reading produces: Mosaic (a new mode) and GridList with columns and round tiles.
    assert.ok(existsSync(join(dir, "shopping-vtex-template-home/src/components/CmsComponents/Banner/components/Mosaic.jsx")))
    const banner = read(dir, "shopping-vtex-template-home/src/components/CmsComponents/Banner/Banner.jsx")
    assert.match(banner, /import Mosaic from '.\/components\/Mosaic'/)
    assert.match(banner, /if \(mode === 'Mosaic'\) \{\n\t\treturn \(\n\t\t\t<Mosaic/)
    const grid = read(dir, "shopping-vtex-template-home/src/components/CmsComponents/Banner/components/GridList.jsx")
    assert.match(grid, /data\?\.rounded/)
    assert.match(grid, /const COLUMNS = /)

    const pt = JSON.parse(read(dir, "shopping-vtex-template-home/src/locales/pt/translation.json"))
    const en = JSON.parse(read(dir, "shopping-vtex-template-home/src/locales/en/translation.json"))
    assert.equal(pt.home.offers, "Ofertas", "existing keys kept")
    assert.equal(pt.countdown.days, "Dias")
    assert.equal(en.countdown.days, "Days")
})

test("a second run changes nothing", () => {
    const dir = repo()
    applyAddons(dir)
    const before = Object.keys(FILES).map((p) => read(dir, p))
    const report = applyAddons(dir)
    assert.deepEqual(report.applied, [])
    assert.deepEqual(
        Object.keys(FILES).map((p) => read(dir, p)),
        before,
    )
})

test("a file the repo already has is kept, and a missing anchor becomes a todo, not a guess", () => {
    const dir = repo()
    const mine = join(dir, "shopping-vtex-template-home/src/components/CmsComponents/TabbedProductShelf/TabbedProductShelf.jsx")
    mkdirSync(dirname(mine), { recursive: true })
    writeFileSync(mine, "export default function TabbedProductShelf() { return null }\n")
    writeFileSync(join(dir, "shopping-vtex-template-shared/src/components/ProductCard/ProductCardFullImage.jsx"), "export default function Card(props) { return null }\n")
    const report = applyAddons(dir)
    assert.equal(readFileSync(mine, "utf8"), "export default function TabbedProductShelf() { return null }\n")
    assert.ok(report.skipped.some((s) => /TabbedProductShelf\.jsx.*kept/.test(s)), report.skipped.join("\n"))
    assert.ok(report.todo.some((t) => /ProductCardFullImage\.jsx/.test(t) && /ProductRatingStars/.test(t)), report.todo.join("\n"))
})

test("a repo that is not the VTEX template is left alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "addons-"))
    mkdirSync(join(dir, "app"))
    writeFileSync(join(dir, "app", "eitri-app.conf.js"), "module.exports = { 'eitri-app-dependencies': { 'eitri-shopping-shopify-shared': {} } }")
    const report = applyAddons(dir)
    assert.deepEqual(report.applied, [])
    assert.match(report.skipped.join(" "), /no VTEX/)
})

// The template's CMS views, which destructure getCmsContent's answer (null while the store's CMS is empty).
const VIEWS = {
    "shopping-vtex-template-home/src/views/Home.jsx": `import { getCmsContent } from '../services/CmsService'
import { useQuery } from '@tanstack/react-query'

export default function Home() {
	const { data: cmsContent } = useQuery({
		queryKey: ['cms', 'home'],
		queryFn: async () => {
			const { sections } = await getCmsContent('home', 'home')
			return sections
		},
		enabled: enableCmsQuery
	})
}
`,
    "shopping-vtex-template-home/src/views/Categories.jsx": `import { getCmsContent } from '../services/CmsService'

export default function Categories() {
	const loadCms = async () => {
		const { sections } = await getCmsContent('categories', 'categorias')
		setCmsContent(sections)
		setIsLoading(false)
	}
}
`,
    "shopping-vtex-template-home/src/views/LandingPage.jsx": `import { getCmsContent } from '../services/CmsService'

export default function LandingPage(props) {
	const pageTitle = props?.location?.state?.title ?? ''
	const openInBottomBar = !!props?.location?.state?.openInBottomBar

	const loadCms = async () => {
		try {
			const landingPageName = props?.location?.state?.landingPageName
			const { sections } = await getCmsContent('landingPage', landingPageName)
			setCmsContent(sections)
			setIsLoading(false)
			TrackingService.sendScreenView(landingPageName, 'LandingPage')
		} catch (e) {
			setIsLoading(false)
		}
	}
}
`,
}

test("with the store's features: the captured home becomes the default, and the CMS views survive an empty CMS", () => {
    const dir = repo()
    for (const [path, content] of Object.entries(VIEWS)) writeFileSync(join(dir, path), content)
    const features = {
        home: {
            cmsSections: [
                { id: "toggle-layout#countdown-black", name: "Countdown", data: { targetDate: "2026-11-13T10:00:00-03:00" } },
                { id: "flex-layout.row#shelf-home1", name: "ProductShelf", data: { facets: [{ key: "productClusterIds", value: "1765" }], numberOfItems: 12, mode: "scroll" } },
            ],
        },
    }
    const report = applyAddons(dir, { features })
    assert.deepEqual(report.todo, [])

    const defaults = read(dir, "shopping-vtex-template-home/src/utils/defaultHome.js")
    assert.match(defaults, /export const DEFAULT_HOME_SECTIONS = \[/)
    assert.match(defaults, /"targetDate": "2026-11-13T10:00:00-03:00"/)
    assert.match(defaults, /"value": "1765"/)
    assert.match(defaults, /export const DEFAULT_CATEGORIES_SECTIONS/)
    assert.match(defaults, /export const DEFAULT_LANDING_SECTIONS/)

    const home = read(dir, "shopping-vtex-template-home/src/views/Home.jsx")
    assert.match(home, /const page = await getCmsContent\('home', 'home'\)\n\t\t\treturn sectionsOrDefault\(page\?\.sections, DEFAULT_HOME_SECTIONS\)/)
    assert.match(home, /import \{ DEFAULT_HOME_SECTIONS, sectionsOrDefault \} from '..\/utils\/defaultHome'/)
    const categories = read(dir, "shopping-vtex-template-home/src/views/Categories.jsx")
    assert.match(categories, /sectionsOrDefault\(page\?\.sections, DEFAULT_CATEGORIES_SECTIONS\)/)
    assert.doesNotMatch(categories, /const \{ sections \} = await/)
    const landing = read(dir, "shopping-vtex-template-home/src/views/LandingPage.jsx")
    assert.match(landing, /sectionsOrDefault\(page\?\.sections, DEFAULT_LANDING_SECTIONS\)/)
    assert.match(landing, /tabIndex !== undefined/, "opened from its bottom tab: no back arrow")

    assert.deepEqual(applyAddons(dir, { features }).applied, [], "idempotent")
})

test("without features, the views are still made safe, with an empty home default", () => {
    const dir = repo()
    for (const [path, content] of Object.entries(VIEWS)) writeFileSync(join(dir, path), content)
    applyAddons(dir)
    assert.match(read(dir, "shopping-vtex-template-home/src/utils/defaultHome.js"), /export const DEFAULT_HOME_SECTIONS = \[\]/)
    assert.match(read(dir, "shopping-vtex-template-home/src/views/Home.jsx"), /sectionsOrDefault/)
})

test("a rerun with a new analysis refreshes the generated home default; a hand-edited one is kept", () => {
    const dir = repo()
    for (const [path, content] of Object.entries(VIEWS)) writeFileSync(join(dir, path), content)
    const file = join(dir, "shopping-vtex-template-home/src/utils/defaultHome.js")
    applyAddons(dir)
    const banner = { id: "dom-01-images-carousel", name: "MultipleImageBanner", data: { mode: "SliderHero", images: [{ imageUrl: "https://cdn.x/a.jpg" }] } }
    const report = applyAddons(dir, { features: { home: { cmsSections: [banner] } } })
    assert.ok(report.applied.some((a) => a.includes("defaultHome.js") && a.includes("1 captured home section")), JSON.stringify(report))
    assert.match(readFileSync(file, "utf8"), /"dom-01-images-carousel"/)

    writeFileSync(file, readFileSync(file, "utf8").replace('"SliderHero"', '"SingleBanner"'))
    const again = applyAddons(dir, { features: { home: { cmsSections: [] } } })
    assert.ok(again.skipped.some((s) => s.includes("defaultHome.js") && /edited/.test(s)), JSON.stringify(again.skipped))
    assert.match(readFileSync(file, "utf8"), /"SingleBanner"/)
})

test("a section the component map already has (even as its last entry, without a comma) is not added again", () => {
    const dir = repo()
    const map = join(dir, "shopping-vtex-template-home/src/utils/getMappedComponent.js")
    writeFileSync(
        map,
        `import Banner from '../components/CmsComponents/Banner/Banner'
import TabbedProductShelf from '../components/CmsComponents/TabbedProductShelf/TabbedProductShelf'

const componentMap = {
	MultipleImageBanner: Banner,
	TabbedProductShelf: TabbedProductShelf
}
`,
    )
    applyAddons(dir)
    const text = readFileSync(map, "utf8")
    assert.equal(text.match(/TabbedProductShelf: TabbedProductShelf/g).length, 1)
    assert.equal(text.match(/import TabbedProductShelf/g).length, 1)
    assert.match(text, /\tCountdown: Countdown,/)
})
