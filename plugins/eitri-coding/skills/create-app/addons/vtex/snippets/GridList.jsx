import { Text, View, Image } from 'eitri-luminus'
import SectionTitle from '../../../SectionTitle/SectionTitle'
// data.columns (default 2) and data.rounded (white circles, the store's brand logos) shape the grid.
const COLUMNS = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }

export default function GridList(props) {
	const { data, onClick } = props
	const imagesList = Array.isArray(data?.images) ? data.images : []
	const gap = data?.gap || 8
	const columns = COLUMNS[data?.columns] || COLUMNS[2]

	return (
		<View>
			<SectionTitle title={data?.mainTitle} />
			<View
				style={{ gap: `${gap}px` }}
				className={`grid ${columns} px-3`}>
				{imagesList.map(image => (
					<View
						key={image.imageUrl || image.externalImageUrl}
						onClick={() => onClick(image)}
						className='flex flex-col items-center'>
						{data?.rounded ? (
							<View className='w-full aspect-square rounded-full bg-white overflow-hidden flex items-center justify-center'>
								<Image
									src={image.imageUrl || image.externalImageUrl}
									className='w-full h-full object-contain'
								/>
							</View>
						) : (
							<Image
								src={image.imageUrl || image.externalImageUrl}
								className='w-full h-auto rounded'
							/>
						)}
						{image.subLabel ? <Text className='block text-sm text-center mt-1'>{image.subLabel}</Text> : null}
					</View>
				))}
			</View>
		</View>
	)
}
