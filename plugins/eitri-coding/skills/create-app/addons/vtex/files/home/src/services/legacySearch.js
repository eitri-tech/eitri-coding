// VTEX legacy search. On a store whose vtex.search-graphql still runs the catalog resolver (no Intelligent
// Search behind it), productSearch ignores selectedFacets and answers the whole catalog, and facets answers
// nothing without a query/map pair. With appConfigs.legacySearchFacets (create-app's analyze-store.mjs detects
// it), ProductService sends the facets as that pair and reads the legacy facet lists back as the filter's groups.

/** The app's facet keys → legacy map names. Keys from legacyFacetGroups (b, c, specificationFilter_N) already are. */
const LEGACY_MAP = { brand: 'b', productClusterIds: 'productClusterIds' }

/** Asked from facets() on a legacy store: the lists its answer has instead of `facets`. */
export const LEGACY_FACETS_RETURN = `{
	brands { name quantity value map }
	categoriesTrees { name quantity value map children { name quantity value map } }
	specificationFilters { name facets { name quantity value map } }
}`

/**
 * The search options with selectedFacets and fullText as the legacy query/map pair ("24942" + "productClusterIds",
 * "medicamentos/ems" + "c,b"); null when there is nothing to send that way.
 */
export function toLegacyOptions(options) {
	const facets = Array.isArray(options?.selectedFacets) ? options.selectedFacets : []
	const parts = []
	for (const facet of facets) {
		const key = facet?.key == null ? '' : String(facet.key)
		const value = facet?.value == null ? '' : String(facet.value)
		// A price range has no legacy facet the filter could have offered: it is left out.
		if (!key || !value || key === 'price') continue
		parts.push([value, /^category-\d+$/.test(key) ? 'c' : LEGACY_MAP[key] ?? key])
	}
	const term = typeof options?.fullText === 'string' ? options.fullText.trim() : ''
	if (term) parts.push([term, 'ft'])
	if (!parts.length) return null
	const { selectedFacets, fullText, ...rest } = options
	return { ...rest, query: parts.map(([value]) => value).join('/'), map: parts.map(([, map]) => map).join(',') }
}

function facetValues(list, fallbackKey) {
	return (Array.isArray(list) ? list : [])
		.filter(item => item && item.value != null && item.value !== '')
		.map(item => {
			const key = item.map || fallbackKey
			const value = String(item.value)
			return { id: `${key}:${value}`, name: item.name || value, quantity: Number(item.quantity) || 0, key, value, selected: false }
		})
		.filter(item => item.key)
}

/** The legacy facets answer as the filter's groups ({ name, type, hidden, values: [{ key, value, name, quantity }] }). */
export function legacyFacetGroups(answer) {
	const groups = []
	const add = (name, type, values) => {
		if (name && values.length) groups.push({ name, type, hidden: false, quantity: values.length, values })
	}
	const tree = Array.isArray(answer?.categoriesTrees) ? answer.categoriesTrees.filter(Boolean) : []
	// Inside one department its subcategories narrow the list; otherwise the departments do.
	const children = tree.length === 1 && Array.isArray(tree[0].children) ? tree[0].children : []
	add('Categoria', 'CATEGORYTREE', facetValues(children.length ? children : tree.length > 1 ? tree : [], 'c'))
	add('Marca', 'BRAND', facetValues(answer?.brands, 'b'))
	for (const spec of Array.isArray(answer?.specificationFilters) ? answer.specificationFilters : []) {
		add(spec?.name, 'TEXT', facetValues(spec?.facets, ''))
	}
	return groups
}
