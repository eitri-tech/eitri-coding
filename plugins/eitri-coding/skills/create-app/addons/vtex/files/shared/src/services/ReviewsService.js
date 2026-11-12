import { useEffect, useState } from 'react'
import Eitri from 'eitri-bifrost'
import { getRemoteAppConfigProperty } from '../utils/getRemoteConfigStyleProperty'
import { parseRatings, ratingsRequest } from './reviewsProviders'

// Product ratings from the store's review provider (appConfigs.reviews). Cards ask one product at a
// time; requests made within BATCH_MS go out together, one call per shelf instead of one per card.
// Each product is asked once per session. No provider configured: every rating is null.

const BATCH_MS = 60
const MAX_BATCH = 40

let configPromise = null
const ratings = new Map() // productId → Promise<{ average, count } | null>
let queue = []
let timer = null

function loadConfig() {
	if (!configPromise) {
		configPromise = getRemoteAppConfigProperty('reviews')
			.then(config => (config && config.provider ? config : null))
			.catch(() => null)
	}
	return configPromise
}

async function flush() {
	const batch = queue.splice(0, MAX_BATCH)
	timer = queue.length ? setTimeout(flush, BATCH_MS) : null
	const config = await loadConfig()
	const url = config ? ratingsRequest(config, batch.map(item => item.id)) : null
	let found = {}
	if (url) {
		try {
			const response = await Eitri.http.get(url)
			found = parseRatings(config, response?.data)
		} catch (error) {
			console.warn('ReviewsService: ratings request failed', error)
		}
	}
	for (const item of batch) item.resolve(found[item.id] ?? null)
}

/** The product's { average, count }, or null (no reviews, no provider, or the request failed). */
export function getProductRating(productId) {
	const id = productId ? String(productId) : ''
	if (!id) return Promise.resolve(null)
	if (!ratings.has(id)) {
		ratings.set(
			id,
			new Promise(resolve => {
				queue.push({ id, resolve })
				if (!timer) timer = setTimeout(flush, BATCH_MS)
			})
		)
	}
	return ratings.get(id)
}

/** Rating of a product for a card or a PDP; null until it arrives, and when there is none. */
export function useProductRating(productId) {
	const [rating, setRating] = useState(null)
	useEffect(() => {
		let active = true
		getProductRating(productId).then(value => {
			if (active) setRating(value)
		})
		return () => {
			active = false
		}
	}, [productId])
	return rating
}
