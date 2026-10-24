import { describe, expect, it } from 'vitest'
import { backgroundSrc, castMascotSrcs, isLocalAsset, mascotSrc } from '@/assets'

describe('assets', () => {
  it('names files after the contract enums', () => {
    expect(backgroundSrc('surf')).toBe('/assets/backgrounds/surf-1.mp4')
    expect(mascotSrc('robot', 'pointing')).toBe('/assets/mascots/robot-pointing.png')
  })

  it('lists every pose of both cast characters for preloading', () => {
    expect(castMascotSrcs({ teacher: 'professor', student: 'cat' })).toEqual([
      '/assets/mascots/professor-neutral.png',
      '/assets/mascots/professor-shocked.png',
      '/assets/mascots/professor-pointing.png',
      '/assets/mascots/cat-neutral.png',
      '/assets/mascots/cat-shocked.png',
      '/assets/mascots/cat-pointing.png',
    ])
  })

  it('tells our asset files from remote pictures', () => {
    expect(isLocalAsset('/assets/stickers/fire.png')).toBe(true)
    expect(isLocalAsset('https://images.pexels.com/photo.jpg')).toBe(false)
  })
})
