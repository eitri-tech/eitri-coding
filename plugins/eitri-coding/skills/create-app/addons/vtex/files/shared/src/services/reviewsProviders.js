// Review providers the app can read ratings from, configured by appConfigs.reviews
// ({ provider, ...ids }, written by create-app's analyze-store.mjs when it detects one).
// Each provider answers many products in one public request. Pure: ReviewsService fetches.
// To add a provider: a request builder and a parser returning { productId: { average, count } }.

const PROVIDERS = {
	skeepers: {
		request: (config, ids) =>
			config.websiteId
				? `https://api-product-reviews.cxr.skeepers.io/v1/websites/${encodeURIComponent(config.websiteId)}/products/ratings?ref=${ids
						.map(encodeURIComponent)
						.join(',')}`
				: null,
		parse: body => {
			const out = {}
			const data = body && typeof body === 'object' ? body.data : null
			for (const [id, rating] of Object.entries(data && typeof data === 'object' ? data : {})) {
				const average = Number(rating?.average)
				const count = Number(rating?.nb_total)
				if (Number.isFinite(average) && count > 0) out[id] = { average: Math.round(average * 100) / 100, count }
			}
			return out
		}
	}
}

/** The URL that answers these products' ratings, or null when the provider is unknown or not configured. */
export function ratingsRequest(config, ids) {
	const provider = PROVIDERS[config?.provider]
	if (!provider || !Array.isArray(ids) || ids.length === 0) return null
	return provider.request(config, ids)
}

/** { productId: { average, count } } from the provider's answer; products without reviews are left out. */
export function parseRatings(config, body) {
	const provider = PROVIDERS[config?.provider]
	return provider ? provider.parse(body) : {}
}
