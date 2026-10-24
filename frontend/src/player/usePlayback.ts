import { useEffect, useReducer, useRef, useState } from 'react'
import { stickerSrc } from '@/assets'
import { audioOutput, sceneAudioUrl } from '@/player/audioOutput'
import { highlightIndex } from '@/player/captions'
import { playSfx } from '@/player/sfx'
import type { Audio, Scene } from '@/types/contract'

export const SILENT_TAIL_MS = 400
const REACTION_FALLBACK_SHARE = 0.4

export type PlaybackStatus = 'playing' | 'waiting' | 'finished'

export interface Cursor {
  position: number
  run: number
}

export type CursorAction = { type: 'sceneEnded'; from: number } | { type: 'replay' }

export function cursorReducer(cursor: Cursor, action: CursorAction): Cursor {
  switch (action.type) {
    case 'sceneEnded':
      return action.from === cursor.position ? { ...cursor, position: cursor.position + 1 } : cursor
    case 'replay':
      return { position: 0, run: cursor.run + 1 }
  }
}

export function playbackStatus(position: number, available: number, complete: boolean): PlaybackStatus {
  if (position < available) return 'playing'
  return complete ? 'finished' : 'waiting'
}

export function sceneDurationMs(scene: Scene): number {
  if (scene.audio !== null) return scene.audio.duration_ms
  return (scene.words.at(-1)?.end_ms ?? 0) + SILENT_TAIL_MS
}

export function reactionAtMs(scene: Scene): number {
  const word = scene.words[highlightIndex(scene.words, scene.highlight)]
  return word?.start_ms ?? Math.round(sceneDurationMs(scene) * REACTION_FALLBACK_SHARE)
}

function decodeSceneAudio(audio: Audio): string | null {
  try {
    return sceneAudioUrl(audio)
  } catch (error) {
    // Corrupt base64 (atob InvalidCharacterError): the scene runs on its word timings instead.
    if (error instanceof Error && error.name === 'InvalidCharacterError') return null
    throw error
  }
}

function useScenePreparation(scenes: readonly Scene[]) {
  const audioUrls = useRef(new Map<string, string | null>())
  const preloaded = useRef(new Set<string>())

  useEffect(() => {
    const preload = (url: string) => {
      if (preloaded.current.has(url)) return
      preloaded.current.add(url)
      new Image().src = url
    }
    for (const scene of scenes) {
      if (scene.audio !== null && !audioUrls.current.has(scene.id)) {
        audioUrls.current.set(scene.id, decodeSceneAudio(scene.audio))
      }
      if (scene.picture !== null) preload(scene.picture.url)
      if (scene.reaction !== 'none') preload(stickerSrc(scene.reaction))
    }
  }, [scenes])

  useEffect(() => {
    const urls = audioUrls.current
    return () => {
      for (const url of urls.values()) if (url !== null) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])

  return audioUrls
}

function isMediaError(error: unknown, name: string): boolean {
  return error instanceof DOMException && error.name === name
}

export interface Playback {
  status: PlaybackStatus
  scene: Scene | null
  position: number
  timeMs: number
  needsTap: boolean
  replay: () => void
  resumeSound: () => void
}

export function usePlayback(scenes: readonly Scene[], complete: boolean): Playback {
  const [cursor, dispatch] = useReducer(cursorReducer, { position: 0, run: 0 })
  const [clock, setClock] = useState({ key: '', ms: 0 })
  const [blockedKey, setBlockedKey] = useState<string | null>(null)
  const audioUrls = useScenePreparation(scenes)

  const status = playbackStatus(cursor.position, scenes.length, complete)
  const current = status === 'playing' ? (scenes[cursor.position] ?? null) : null
  const currentKey = current === null ? null : `${String(cursor.run)}:${current.id}`

  // One unlocked element for every scene: blob URLs are ready on arrival and the measured switch gap is about 30 ms.
  useEffect(() => {
    if (current === null) return
    const { element } = audioOutput()
    const key = `${String(cursor.run)}:${current.id}`
    const position = cursor.position
    const duration = sceneDurationMs(current)
    const url = audioUrls.current.get(current.id) ?? null
    let timerStart: number | null = url === null ? performance.now() : null
    let frame = 0

    const end = () => {
      dispatch({ type: 'sceneEnded', from: position })
    }
    const switchToTimer = () => {
      timerStart ??= performance.now()
    }
    const tick = () => {
      const ms = Math.floor(timerStart === null ? element.currentTime * 1000 : performance.now() - timerStart)
      setClock((previous) => (previous.key === key && previous.ms === ms ? previous : { key, ms }))
      if (timerStart !== null && ms >= duration) {
        end()
        return
      }
      frame = requestAnimationFrame(tick)
    }

    playSfx(current.sfx)
    if (url !== null) {
      element.src = url
      element.currentTime = 0
      element.addEventListener('ended', end)
      element.addEventListener('error', switchToTimer)
      element.play().catch((error: unknown) => {
        if (isMediaError(error, 'NotAllowedError')) setBlockedKey(key)
        else if (!isMediaError(error, 'AbortError')) switchToTimer()
      })
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      element.removeEventListener('ended', end)
      element.removeEventListener('error', switchToTimer)
      element.pause()
    }
  }, [current, cursor.position, cursor.run, audioUrls])

  const shownIndex = status === 'playing' ? cursor.position : Math.min(cursor.position, scenes.length) - 1
  const shown = scenes[shownIndex] ?? null
  let timeMs = 0
  if (status === 'playing') timeMs = clock.key === currentKey ? clock.ms : 0
  else if (shown !== null) timeMs = sceneDurationMs(shown)

  const resumeSound = () => {
    const { element, context } = audioOutput()
    void context.resume()
    setBlockedKey(null)
    element.play().catch((error: unknown) => {
      if (isMediaError(error, 'NotAllowedError')) setBlockedKey(currentKey)
    })
  }

  return {
    status,
    scene: shown,
    position: shownIndex,
    timeMs,
    needsTap: blockedKey !== null && blockedKey === currentKey,
    replay: () => {
      dispatch({ type: 'replay' })
    },
    resumeSound,
  }
}
