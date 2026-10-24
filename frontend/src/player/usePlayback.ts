import { useEffect, useReducer, useRef, useState } from 'react'
import { audioOutput, sceneAudioUrl } from '@/player/audioOutput'
import { highlightIndex } from '@/player/captions'
import { playSfx } from '@/player/sfx'
import type { Scene } from '@/types/contract'

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

function useScenePreparation(scenes: readonly Scene[]) {
  const audioUrls = useRef(new Map<string, string>())
  const preloadedPictures = useRef(new Set<string>())

  useEffect(() => {
    for (const scene of scenes) {
      if (scene.audio !== null && !audioUrls.current.has(scene.id)) {
        audioUrls.current.set(scene.id, sceneAudioUrl(scene.audio))
      }
      if (scene.picture !== null && !preloadedPictures.current.has(scene.picture.url)) {
        preloadedPictures.current.add(scene.picture.url)
        new Image().src = scene.picture.url
      }
    }
  }, [scenes])

  useEffect(() => {
    const urls = audioUrls.current
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url)
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

  useEffect(() => {
    if (current === null) return
    const { element } = audioOutput()
    const key = `${String(cursor.run)}:${current.id}`
    const position = cursor.position
    const duration = sceneDurationMs(current)
    const url = audioUrls.current.get(current.id)
    let timerStart: number | null = url === undefined ? performance.now() : null
    let frame = 0

    const end = () => {
      dispatch({ type: 'sceneEnded', from: position })
    }
    const switchToTimer = () => {
      timerStart ??= performance.now()
    }
    const tick = () => {
      const ms = timerStart === null ? element.currentTime * 1000 : performance.now() - timerStart
      setClock({ key, ms })
      if (timerStart !== null && ms >= duration) {
        end()
        return
      }
      frame = requestAnimationFrame(tick)
    }

    playSfx(current.sfx)
    if (url !== undefined) {
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
