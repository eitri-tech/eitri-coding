import { useEffect, useState } from 'react'
import { View, Text, Image } from 'eitri-luminus'
import { useTranslation } from 'eitri-i18n'
import { processActions } from '../../../services/ResolveCmsActions'

// A promotion countdown: optional banner image, a title and days / hours / minutes / seconds boxes.
// data: { targetDate (ISO, with the store's UTC offset), title?, imageUrl?, action?, backgroundColor? }
// Hidden before it is configured and once the date has passed.

function remaining(target, now) {
	const diff = target - now
	if (!Number.isFinite(diff) || diff <= 0) return null
	return {
		days: Math.floor(diff / 86400000),
		hours: Math.floor((diff / 3600000) % 24),
		minutes: Math.floor((diff / 60000) % 60),
		seconds: Math.floor((diff / 1000) % 60)
	}
}

export default function Countdown(props) {
	const data = props?.data ?? {}
	const { t } = useTranslation()
	const target = data.targetDate ? new Date(data.targetDate).getTime() : NaN
	const [left, setLeft] = useState(() => remaining(target, Date.now()))

	useEffect(() => {
		if (!Number.isFinite(target)) return
		setLeft(remaining(target, Date.now()))
		const timer = setInterval(() => setLeft(remaining(target, Date.now())), 1000)
		return () => clearInterval(timer)
	}, [target])

	if (!left) return null

	const units = [
		{ value: left.days, label: t('countdown.days') },
		{ value: left.hours, label: t('countdown.hours') },
		{ value: left.minutes, label: t('countdown.minutes') },
		{ value: left.seconds, label: t('countdown.seconds') }
	]
	const onPress = () => {
		if (data.action) processActions({ action: data.action })
	}

	return (
		<View
			className='flex flex-col items-center w-full bg-base-200 py-6'
			style={data.backgroundColor ? { backgroundColor: data.backgroundColor } : undefined}>
			{data.imageUrl ? (
				<View
					onClick={onPress}
					className='w-full px-4 mb-4'>
					<Image
						src={data.imageUrl}
						className='w-full'
					/>
				</View>
			) : null}
			<Text className='font-main text-[22px] tracking-[0.3em] uppercase text-base-content mb-3'>
				{data.title || t('countdown.title')}
			</Text>
			<View className='flex items-start justify-center gap-3'>
				{units.map(unit => (
					<View
						key={unit.label}
						className='flex flex-col items-center gap-1'>
						<View className='flex gap-[2px]'>
							{String(unit.value)
								.padStart(2, '0')
								.split('')
								.map((digit, index) => (
									<View
										key={index}
										className='w-[26px] h-[40px] flex items-center justify-center bg-secondary rounded-sm'>
										<Text className='font-main text-[28px] text-secondary-content'>{digit}</Text>
									</View>
								))}
						</View>
						<Text className='text-[10px] uppercase text-base-content'>{unit.label}</Text>
					</View>
				))}
			</View>
		</View>
	)
}
