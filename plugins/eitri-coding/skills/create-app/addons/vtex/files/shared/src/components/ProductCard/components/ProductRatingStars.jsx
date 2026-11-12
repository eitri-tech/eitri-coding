import { View, Text } from 'eitri-luminus'
import { IoStar, IoStarHalf, IoStarOutline } from 'react-icons/io5'

// Five stars and the review count, from useProductRating's { average, count }. Renders nothing without a rating.
export default function ProductRatingStars(props) {
	const average = Number(props?.rating?.average)
	const count = Number(props?.rating?.count)
	if (!Number.isFinite(average) || !(count > 0)) return null

	const size = props?.size ?? 12
	const stars = [0, 1, 2, 3, 4].map(index => {
		const fill = average - index
		if (fill >= 0.75) return 'full'
		if (fill >= 0.25) return 'half'
		return 'empty'
	})

	return (
		<View className={`flex items-center gap-1 ${props?.className ?? ''}`}>
			<View className='flex items-center text-base-content'>
				{stars.map((kind, index) =>
					kind === 'full' ? (
						<IoStar key={index} size={size} />
					) : kind === 'half' ? (
						<IoStarHalf key={index} size={size} />
					) : (
						<IoStarOutline key={index} size={size} />
					)
				)}
			</View>
			<Text className='text-[10px] text-[#999999]'>{`(${count})`}</Text>
		</View>
	)
}
