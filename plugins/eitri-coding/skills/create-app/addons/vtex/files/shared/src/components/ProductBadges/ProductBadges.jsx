import { useEffect, useState } from 'react'
import { Vtex } from 'eitri-shopping-vtex-shared'
import BadgeRender from '../BadgeRender/BadgeRender'
import getBadgesForProducts from '../../services/BadgesService'

// The product's badges (appConfigs.badges, teasers, CMS badges) outside a product card, e.g. on the PDP image.
export default function ProductBadges(props) {
	const product = props?.product
	const currentSku = props?.currentSku
	const [badges, setBadges] = useState([])

	useEffect(() => {
		if (!product) return
		let active = true
		getBadgesForProducts(product, currentSku, Vtex, 'badges')
			.then(found => {
				if (active) setBadges(Array.isArray(found) ? found : [])
			})
			.catch(error => console.warn('ProductBadges: badges failed', error))
		return () => {
			active = false
		}
	}, [product?.productId, currentSku?.itemId])

	if (!badges.length) return null
	return (
		<BadgeRender
			badges={badges}
			className={props?.className}
		/>
	)
}
