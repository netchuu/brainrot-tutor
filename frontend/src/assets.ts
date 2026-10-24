import { SFX } from '@/types/contract'
import type { Reaction, Sfx, Speaker } from '@/types/contract'

export type MascotPose = 'neutral' | 'shocked' | 'pointing'
export type BackgroundKind = 'parkour' | 'satisfying'
export type StickerReaction = Exclude<Reaction, 'none'>
export type SoundEffect = Exclude<Sfx, 'none'>

const ROOT = `${import.meta.env.BASE_URL}assets`
const BACKGROUND_VARIANTS = 3

export const SOUND_EFFECTS: readonly SoundEffect[] = SFX.filter((sfx): sfx is SoundEffect => sfx !== 'none')

export function backgroundSrc(kind: BackgroundKind, episodeIndex: number): string {
  return `${ROOT}/backgrounds/${kind}-${String((episodeIndex % BACKGROUND_VARIANTS) + 1)}.mp4`
}

export function mascotSrc(character: Speaker, pose: MascotPose): string {
  return `${ROOT}/mascots/${character}-${pose}.png`
}

export function stickerSrc(reaction: StickerReaction): string {
  return `${ROOT}/stickers/${reaction}.png`
}

export function sfxSrc(sfx: SoundEffect): string {
  return `${ROOT}/sfx/${sfx}.mp3`
}

export const REACTION_EMOJI: Record<StickerReaction, string> = {
  mind_blown: '🤯',
  shocked: '😱',
  laugh: '😂',
  thinking: '🤔',
  fire: '🔥',
  check: '✅',
  cross: '❌',
}

export const MASCOT_EMOJI: Record<Speaker, string> = {
  teacher: '🧑‍🏫',
  student: '🧑‍🎓',
}
