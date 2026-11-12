// Product-card badges from the product's own catalog data, configured by
// appConfigs.badges (written by create-app's analyze-store.mjs from the store):
//
//   highlights      { allow?: [names], stripPrefixes?: ["Tag "], styles?: { text: { bgColor, textColor } } }
//                   VTEX collections flagged as highlights (clusterHighlights). Without `allow`, every one.
//   specifications  { names: [group or field names], values: { value: { bgColor, textColor } } }
//                   only the listed values are shown (stores hide some with CSS)
//   collections     { id: { text, bgColor, textColor } }  any collection, with its label
//
// Reads both product shapes: Intelligent Search (arrays of { id, name }, specificationGroups)
// and the catalog API (id → name objects, a field per specification).
// Pure: BadgesService loads the config. Returns BadgeRender's { textBadge: { text, bgColor?, textColor? } }.

function idNamePairs(value) {
	if (Array.isArray(value)) return value.filter(Boolean).map(item => [String(item.id ?? ''), String(item.name ?? '')])
	if (value && typeof value === 'object') return Object.entries(value).map(([id, name]) => [String(id), String(name ?? '')])
	return []
}

function textBadge(text, style) {
	const badge = { text }
	if (style?.bgColor) badge.bgColor = style.bgColor
	if (style?.textColor) badge.textColor = style.textColor
	return { textBadge: badge }
}

function specificationValues(product, names) {
	const values = new Set()
	for (const group of Array.isArray(product.specificationGroups) ? product.specificationGroups : []) {
		if (!names.includes(group?.name)) continue
		for (const spec of Array.isArray(group.specifications) ? group.specifications : []) {
			for (const value of Array.isArray(spec?.values) ? spec.values : []) values.add(String(value))
		}
	}
	for (const property of Array.isArray(product.properties) ? product.properties : []) {
		if (!names.includes(property?.name)) continue
		for (const value of Array.isArray(property.values) ? property.values : []) values.add(String(value))
	}
	for (const name of names) {
		for (const value of Array.isArray(product[name]) ? product[name] : []) values.add(String(value))
	}
	return [...values]
}

export function badgesFor(product, config) {
	if (!product || !config) return []
	const badges = []

	const highlights = config.highlights
	if (highlights && typeof highlights === 'object') {
		const allow = Array.isArray(highlights.allow) ? highlights.allow : null
		const prefixes = Array.isArray(highlights.stripPrefixes) ? highlights.stripPrefixes : []
		for (const [, name] of idNamePairs(product.clusterHighlights)) {
			if (!name || (allow && !allow.includes(name))) continue
			const prefix = prefixes.find(p => name.startsWith(p))
			const text = prefix ? name.slice(prefix.length) : name
			badges.push(textBadge(text, highlights.styles?.[text]))
		}
	}

	const collections = config.collections && typeof config.collections === 'object' ? config.collections : {}
	for (const [id] of idNamePairs(product.productClusters)) {
		const label = collections[id]
		if (label?.text) badges.push(textBadge(label.text, label))
	}

	const specs = config.specifications
	if (specs && Array.isArray(specs.names) && specs.values && typeof specs.values === 'object') {
		for (const value of specificationValues(product, specs.names)) {
			if (specs.values[value]) badges.push(textBadge(value, specs.values[value]))
		}
	}

	return badges
}
