import { SOUND_EFFECTS, sfxSrc } from '@/assets'
import type { SoundEffect } from '@/assets'
import { audioOutput } from '@/player/audioOutput'
import type { Sfx } from '@/types/contract'

const buffers = new Map<SoundEffect, AudioBuffer>()
let loading: Promise<void> | null = null

async function loadBuffer(context: AudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    return await context.decodeAudioData(await response.arrayBuffer())
  } catch (error) {
    // A missing file decodes as HTML (DOMException) or fails to fetch (TypeError): the scene plays without that sound.
    if (error instanceof DOMException || error instanceof TypeError) return null
    throw error
  }
}

export function preloadSfx(): Promise<void> {
  const { context } = audioOutput()
  loading ??= Promise.all(
    SOUND_EFFECTS.map(async (name) => {
      const buffer = await loadBuffer(context, sfxSrc(name))
      if (buffer !== null) buffers.set(name, buffer)
    }),
  ).then(() => undefined)
  return loading
}

export function playSfx(sfx: Sfx): void {
  if (sfx === 'none') return
  const buffer = buffers.get(sfx)
  if (buffer === undefined) return
  const { context } = audioOutput()
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  source.start()
}
