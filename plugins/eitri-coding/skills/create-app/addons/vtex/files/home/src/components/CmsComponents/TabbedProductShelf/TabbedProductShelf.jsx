import { useEffect, useState } from 'react'
import { View, Text } from 'eitri-luminus'
import { getProductsService } from '../../../services/ProductService'
import ShelfOfProductsSlider from '../../ShelfOfProducts/components/ShelfOfProductsSlider'

// One shelf, several queries in tabs (e.g. "Mais vendidos / Lançamentos / Melhores descontos").
// data: { title?, subtitle?, tabs: [{ label, term?, sort?, facets?, numberOfItems? }] }
export default function TabbedProductShelf(props) {
	const data = props?.data ?? {}
	const tabs = (Array.isArray(data.tabs) ? data.tabs : []).filter(tab => tab && tab.label)

	const [selected, setSelected] = useState(0)
	const [productsByTab, setProductsByTab] = useState({})
	const [loading, setLoading] = useState(false)

	const tab = tabs[selected]

	useEffect(() => {
		if (!tab || productsByTab[selected]) return
		let active = true
		const load = async () => {
			setLoading(true)
			try {
				const result = await getProductsService({
					facets: Array.isArray(tab.facets) ? tab.facets : [],
					query: tab.term ?? '',
					sort: tab.sort ?? '',
					to: tab.numberOfItems || 8
				})
				if (active) setProductsByTab(current => ({ ...current, [selected]: result?.products ?? [] }))
			} catch (e) {
				console.warn('TabbedProductShelf: search failed', e)
				if (active) setProductsByTab(current => ({ ...current, [selected]: [] }))
			} finally {
				if (active) setLoading(false)
			}
		}
		load()
		return () => {
			active = false
		}
	}, [selected, tabs.length])

	if (!tabs.length) return null

	return (
		<View className='flex flex-col'>
			{data.title ? <Text className='font-main text-[20px] text-center text-base-content px-4'>{data.title}</Text> : null}
			{data.subtitle ? <Text className='text-[14px] text-center text-base-content px-6 mt-1'>{data.subtitle}</Text> : null}
			<View className='flex w-full border-b border-base-300 mt-3 mb-3'>
				{tabs.map((item, index) => (
					<View
						key={`${item.label}-${index}`}
						onClick={() => setSelected(index)}
						className={`flex-1 flex items-center justify-center text-center px-2 py-2 border-b-[3px] ${
							index === selected ? 'border-secondary' : 'border-transparent'
						}`}>
						<Text className='font-main text-[14px] leading-[18px] text-base-content'>{item.label}</Text>
					</View>
				))}
			</View>
			<ShelfOfProductsSlider
				isLoading={loading && !productsByTab[selected]}
				products={productsByTab[selected] ?? []}
			/>
		</View>
	)
}
