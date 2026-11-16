import { useEffect, useState } from 'react'
import Eitri from 'eitri-bifrost'
import { View, Text, Video, Image } from 'eitri-luminus'
import { processActions } from '../../../services/ResolveCmsActions'

// Shoppable short videos ("stories"), as the store shows them: 9:16 cards in a row, the centered one large and playing
// muted, the others dimmed; each card carries its product (image, name, price). Tapping the product opens it.
// data: {
//   title?, subtitle?,
//   stories?: [{ videoUrl, thumbnailUrl?, title?, productId?, action?, product?: { name, image, price, listPrice } }],
//   streamshop?: { storeSlug, tagName, origin }   — the store's StreamShop carousel, read live from its public feed
// }

const CARD_WIDTH = 240
const CARD_GAP = 12
const FEED = 'https://public-prd-gcp.streamshop.com.br/api/video/ads'

function money(value) {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null
	try {
		return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
	} catch (e) {
		return `R$ ${value.toFixed(2).replace('.', ',')}`
	}
}

/** One StreamShop feed entry as a story: its video, its thumbnail and the first product it sells. */
function fromStreamshop(entry) {
	const product = Array.isArray(entry?.scheduledProducts) ? entry.scheduledProducts.find(Boolean) : null
	const price = typeof product?.promoPrice === 'number' ? product.promoPrice : product?.price
	return {
		videoUrl: entry?.url || entry?.lQUrl || entry?.fullVideoUrl,
		thumbnailUrl: entry?.thumbnail,
		productId: product?.productId,
		product: product
			? {
					name: product.name,
					image: product.image || (Array.isArray(product.images) ? product.images[0] : null),
					price: money(price),
					listPrice: typeof product.promoPrice === 'number' && product.price > product.promoPrice ? money(product.price) : null
				}
			: null
	}
}

export default function VideoStories(props) {
	const data = props?.data ?? {}
	const [fetched, setFetched] = useState([])
	const [playing, setPlaying] = useState(0)

	const streamshop = data.streamshop
	useEffect(() => {
		if (!streamshop?.storeSlug || !streamshop?.tagName) return
		const query = new URLSearchParams({
			origin: streamshop.origin || '',
			storeSlug: streamshop.storeSlug,
			tagName: streamshop.tagName,
			quality: 'mq'
		})
		Eitri.http
			.get(`${FEED}?${query.toString()}`)
			.then(response => {
				const list = Array.isArray(response?.data) ? response.data : []
				setFetched(list.map(fromStreamshop))
			})
			.catch(error => {
				console.warn('VideoStories: StreamShop feed unavailable', error)
				setFetched([])
			})
	}, [streamshop?.storeSlug, streamshop?.tagName])

	const own = Array.isArray(data.stories) ? data.stories : []
	const stories = [...own, ...fetched].filter(story => story && story.videoUrl)

	// Plays only while the row is on screen: nothing starts before the shopper scrolls to it.
	const [rowId] = useState(() => `video-stories-${Math.random().toString(36).slice(2, 10)}`)
	const [visible, setVisible] = useState(false)
	useEffect(() => {
		if (!stories.length) return
		const row = document.getElementById(rowId)
		if (!row || typeof IntersectionObserver !== 'function') return
		const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.6 })
		observer.observe(row)
		return () => observer.disconnect()
	}, [rowId, stories.length])

	// Luminus' Video renders <video playsInline={false}>, and iOS takes any playback of such a video fullscreen.
	// So it never autoplays: the centered card's element gets playsinline first, then is played muted — inline.
	useEffect(() => {
		const video = document.getElementById(`${rowId}-${playing}`)
		if (!video || typeof video.play !== 'function') return
		video.setAttribute('playsinline', '')
		video.setAttribute('webkit-playsinline', '')
		video.playsInline = true
		video.muted = true
		if (visible) {
			const started = video.play()
			if (started && typeof started.catch === 'function') started.catch(error => console.warn('VideoStories: play', error))
		} else {
			video.pause()
		}
	}, [rowId, playing, visible, stories.length])

	if (!stories.length) return null

	const open = story => {
		const action = story.action ?? (story.productId ? { type: 'product', value: String(story.productId) } : null)
		if (action) processActions({ action })
	}

	// The card centered on screen plays: its index from the row's scroll position.
	const onScroll = event => {
		const left = event?.target?.scrollLeft ?? 0
		const index = Math.round(left / (CARD_WIDTH + CARD_GAP))
		if (index !== playing && index >= 0 && index < stories.length) setPlaying(index)
	}

	return (
		<View className='flex flex-col w-full py-4'>
			{data.title ? <Text className='text-2xl text-center px-4'>{data.title}</Text> : null}
			{data.subtitle ? <Text className='text-[14px] text-center px-6 mt-1'>{data.subtitle}</Text> : null}
			<View
				id={rowId}
				onScroll={onScroll}
				className='flex overflow-x-auto snap-x snap-mandatory mt-2'>
				<View className='flex gap-3 px-[calc(50vw-120px)]'>
					{stories.map((story, index) => {
						const active = index === playing
						return (
							<View
								key={`${story.videoUrl}-${index}`}
								onClick={() => setPlaying(index)}
								className={`relative snap-center shrink-0 w-[240px] h-[427px] rounded-2xl overflow-hidden bg-black transition-all duration-300 ${
									active ? 'opacity-100' : 'opacity-50 scale-90'
								}`}>
								{active ? (
									<Video
										id={`${rowId}-${index}`}
										source={story.videoUrl}
										thumbnail={story.thumbnailUrl}
										muted
										loop
										width='240px'
										height='427px'
									/>
								) : story.thumbnailUrl ? (
									<Image
										src={story.thumbnailUrl}
										className='w-full h-full object-cover'
									/>
								) : null}

								{story.product?.name ? (
									<View
										onClick={event => {
											event?.stopPropagation?.()
											open(story)
										}}
										className='absolute left-3 right-3 bottom-3 flex items-center gap-2 p-2 rounded-xl bg-white/20 backdrop-blur-sm'>
										{story.product.image ? (
											<View className='w-[56px] h-[56px] shrink-0 rounded-lg bg-white flex items-center justify-center'>
												<Image
													src={story.product.image}
													className='w-[48px] h-[48px] object-contain'
												/>
											</View>
										) : null}
										<View className='flex flex-col min-w-0'>
											<Text className='text-[12px] font-bold leading-tight line-clamp-2 text-white'>{story.product.name}</Text>
											<View className='flex items-baseline gap-1 mt-1'>
												{story.product.price ? <Text className='text-[12px] font-bold text-white'>{story.product.price}</Text> : null}
												{story.product.listPrice ? (
													<Text className='text-[10px] line-through text-white/70'>{story.product.listPrice}</Text>
												) : null}
											</View>
										</View>
									</View>
								) : story.title ? (
									<View
										onClick={event => {
											event?.stopPropagation?.()
											open(story)
										}}
										className='absolute left-3 right-3 bottom-3 rounded-xl bg-white/20 px-3 py-2'>
										<Text className='text-[12px] line-clamp-2 text-white'>{story.title}</Text>
									</View>
								) : null}
							</View>
						)
					})}
				</View>
			</View>
		</View>
	)
}
