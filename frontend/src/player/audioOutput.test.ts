import { describe, expect, it } from 'vitest'
import { base64ToBytes, silentWav } from '@/player/audioOutput'
import { fixtureScene } from '@/test/fixtureEvents'

describe('base64ToBytes', () => {
  it('round-trips bytes', () => {
    expect(Array.from(base64ToBytes(btoa('\u0000ÿ\u0010ABC')))).toEqual([0, 255, 16, 65, 66, 67])
  })

  it('decodes the fixture voice into an MPEG frame', () => {
    const audio = fixtureScene('e0s0').audio
    if (audio === null) throw new Error('fixture scene e0s0 has no audio')
    const bytes = base64ToBytes(audio.base64)
    expect(bytes[0]).toBe(0xff)
    expect((bytes[1] ?? 0) & 0xe0).toBe(0xe0)
  })
})

describe('silentWav', () => {
  it('builds a valid one-sample PCM WAV', () => {
    const bytes = silentWav()
    const text = (from: number) => String.fromCharCode(...bytes.slice(from, from + 4))
    const view = new DataView(bytes.buffer)
    expect(bytes).toHaveLength(46)
    expect(text(0)).toBe('RIFF')
    expect(text(8)).toBe('WAVE')
    expect(text(36)).toBe('data')
    expect(view.getUint32(4, true)).toBe(38)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(40, true)).toBe(2)
  })
})
