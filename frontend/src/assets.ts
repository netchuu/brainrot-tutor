import { SFX } from '@/types/contract'
import type { BackgroundId, Cast, CharacterId, Reaction, Sfx } from '@/types/contract'

export type MascotPose = 'neutral' | 'shocked' | 'pointing'
export type StickerReaction = Exclude<Reaction, 'none'>
export type SoundEffect = Exclude<Sfx, 'none'>

const ROOT = `${import.meta.env.BASE_URL}assets`
const MASCOT_POSES: readonly MascotPose[] = ['neutral', 'shocked', 'pointing']

export function isLocalAsset(src: string): boolean {
  return src.startsWith(`${ROOT}/`)
}

export const SOUND_EFFECTS: readonly SoundEffect[] = SFX.filter((sfx): sfx is SoundEffect => sfx !== 'none')

// Rotating between numbered clips is optional in the contract; clip 1 is the minimum the asset kit provides.
export function backgroundSrc(background: BackgroundId): string {
  return `${ROOT}/backgrounds/${background}-1.mp4`
}

export function mascotSrc(character: CharacterId, pose: MascotPose): string {
  return `${ROOT}/mascots/${character}-${pose}.png`
}

export function castMascotSrcs(cast: Cast): string[] {
  return [cast.teacher, cast.student].flatMap((character) => MASCOT_POSES.map((pose) => mascotSrc(character, pose)))
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

export const CHARACTER_EMOJI: Record<CharacterId, string> = {
  professor: '🧑‍🏫',
  mechanic: '🧑‍🔧',
  robot: '🤖',
  kid: '🧒',
  gamer: '🎮',
  cat: '🐱',
}
