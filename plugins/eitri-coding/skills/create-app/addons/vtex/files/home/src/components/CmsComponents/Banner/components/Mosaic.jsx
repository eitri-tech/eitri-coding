import { View, Image } from 'eitri-luminus'
import SectionTitle from '../../../SectionTitle/SectionTitle'

// Banners laid out as the store lays them out — a tall card beside two stacked ones beside a wide one — each at its
// captured box, in a row that scrolls sideways when it is wider than the screen. Nothing is cropped or resized to
// a shared size. data: { mainTitle?, images: [{ imageUrl, action?, box: [x, y, width, height] }] } — boxes in px,
// relative to the block's top-left corner (the store's 375 px layout).
export default function Mosaic(props) {
	const { data, onClick } = props
	const images = (Array.isArray(data?.images) ? data.images : []).filter(
		image => image && image.imageUrl && Array.isArray(image.box) && image.box.length === 4
	)

	if (!images.length) return null

	const width = Math.max(...images.map(image => image.box[0] + image.box[2])) + 12
	const height = Math.max(...images.map(image => image.box[1] + image.box[3]))

	return (
		<View>
			<SectionTitle title={data.mainTitle} />
			<View className='flex overflow-x-auto'>
				<View
					className='relative shrink-0'
					style={{ width: `${width}px`, height: `${height}px` }}>
					{images.map(image => (
						<View
							key={`${image.imageUrl}-${image.box.join('-')}`}
							onClick={() => typeof onClick === 'function' && onClick(image)}
							className='absolute rounded-md overflow-hidden'
							style={{
								left: `${image.box[0]}px`,
								top: `${image.box[1]}px`,
								width: `${image.box[2]}px`,
								height: `${image.box[3]}px`
							}}>
							<Image
								src={image.imageUrl}
								className='w-full h-full object-cover'
							/>
						</View>
					))}
				</View>
			</View>
		</View>
	)
}
