// create-app add-on: catalog badges (appConfigs.badges) and safe teasers.
let badgesConfigPromise = null
const loadBadgesConfig = () => {
	if (!badgesConfigPromise) {
		badgesConfigPromise = getRemoteAppConfigProperty('badges')
			.then(config => (config && typeof config === 'object' ? config : {}))
			.catch(() => ({}))
	}
	return badgesConfigPromise
}

const productClusterIds = product => {
	const clusters = product?.productClusters
	if (Array.isArray(clusters)) return clusters.map(cluster => String(cluster?.id ?? ''))
	if (clusters && typeof clusters === 'object') return Object.keys(clusters)
	return []
}

export default async function getBadgesForProducts(product, currentSku, VtexContext, contentType) {
	const badge = []
	const config = await loadBadgesConfig()

	try {
		badge.push(...badgesFor(product, config))
	} catch (e) {
		console.warn('getBadgesForProducts: catalog badges', e)
	}

	if (config.teasers !== false) {
		const sellerDefault = currentSku?.sellers?.find(s => s.sellerDefault) ?? currentSku?.sellers?.[0]
		const teasers = Array.isArray(sellerDefault?.commertialOffer?.teasers) ? sellerDefault.commertialOffer.teasers : []
		for (const teaser of teasers) {
			const promoText = parsePromo(teaser?.name ?? '')
			if (promoText) badge.push({ textBadge: { text: promoText, textColor: '#8b153f', bgColor: '#ffffff' } })
		}
	}

	let flagContentSections = []
	try {
		flagContentSections = (await getCmsContent(VtexContext, contentType)) ?? []
	} catch (e) {
		console.warn('getBadgesForProducts: CMS badges', e)
	}
	const clusterIds = productClusterIds(product)
	for (const section of Array.isArray(flagContentSections) ? flagContentSections : []) {
		const data = section?.data
		const values = Array.isArray(data?.values) ? data.values.map(String) : []
		if (data?.type === 'product' && values.includes(String(product?.productId))) badge.push(data)
		if (data?.type === 'category' && values.some(catId => product?.categoryTree?.some(prodCat => String(prodCat?.id) === catId))) badge.push(data)
		if (data?.type === 'collection' && values.some(id => clusterIds.includes(id))) badge.push(data)
	}

	return badge.filter((item, index, arr) => arr.findIndex(b => JSON.stringify(b) === JSON.stringify(item)) === index)
}

