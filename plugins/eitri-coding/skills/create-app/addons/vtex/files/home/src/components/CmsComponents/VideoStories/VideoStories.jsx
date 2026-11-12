import { useState } from 'react'
import { View, Text, Video, Image } from 'eitri-luminus'
import { processActions } from '../../../services/ResolveCmsActions'

// Shoppable short videos ("stories"): a horizontal row of 9:16 cards. The one in the middle of the
// screen plays muted; tapping a card's footer opens its product (or any CMS action).
// data: { title?, subtitle?, stories: [{ videoUrl, thumbnailUrl?, title?, productId?, action? }] }
// Fed from the CMS: third-party video widgets (Widde, Firework, Tolstoy...) are not read by the app.

export default function VideoStories(props) {
	const data = props?.data ?? {}
	const stories = (Array.isArray(data.stories) ? data.stories : []).filter(story => story && story.videoUrl)
	const [playing, setPlaying] = useState(0)

	if (!stories.length) return null

	const open = story => {
		const action = story.action ?? (story.productId ? { type: 'product', value: String(story.productId) } : null)
		if (action) processActions({ action })
	}

	return (
		<View className='flex flex-col w-full py-4'>
			{data.title ? <Text className='font-main text-[20px] text-center text-base-content px-4'>{data.title}</Text> : null}
			{data.subtitle ? <Text className='text-[14px] text-center text-base-content px-6 mt-1'>{data.subtitle}</Text> : null}
			<View className='flex overflow-x-auto mt-4'>
				<View className='flex gap-3 px-4'>
					{stories.map((story, index) => (
						<View
							key={`${story.videoUrl}-${index}`}
							className='flex flex-col w-[180px] min-w-[180px]'>
							<View
								onClick={() => setPlaying(index)}
								className='w-[180px] h-[320px] rounded-2xl overflow-hidden bg-base-300'>
								{index === playing ? (
									<Video
										source={story.videoUrl}
										thumbnail={story.thumbnailUrl}
										autoPlay
										muted
										loop
										width='180px'
										height='320px'
									/>
								) : story.thumbnailUrl ? (
									<Image
										src={story.thumbnailUrl}
										className='w-full h-full object-cover'
									/>
								) : null}
							</View>
							{story.title ? (
								<View
									onClick={() => open(story)}
									className='mt-2 border border-base-300 rounded-lg px-3 py-2'>
									<Text className='text-[12px] line-clamp-2 text-base-content'>{story.title}</Text>
								</View>
							) : null}
						</View>
					))}
				</View>
			</View>
		</View>
	)
}
