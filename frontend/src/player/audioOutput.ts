import type { Audio } from '@/types/contract'

interface AudioOutput {
  element: HTMLAudioElement
  context: AudioContext
}

let output: AudioOutput | null = null
let silentUrl: string | null = null

export function audioOutput(): AudioOutput {
  if (output === null) {
    const element = document.createElement('audio')
    element.preload = 'auto'
    element.setAttribute('playsinline', '')
    output = { element, context: new AudioContext() }
  }
  return output
}

// Must run synchronously inside a tap handler: iOS only lets an element play later if it played during a gesture.
export function unlockAudio(): void {
  const { element, context } = audioOutput()
  void context.resume()
  silentUrl ??= URL.createObjectURL(new Blob([silentWav()], { type: 'audio/wav' }))
  element.src = silentUrl
  element.play().then(
    () => {
      element.pause()
    },
    (error: unknown) => {
      if (!(error instanceof DOMException)) throw error
    },
  )
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function sceneAudioUrl(audio: Audio): string {
  return URL.createObjectURL(new Blob([base64ToBytes(audio.base64)], { type: audio.mime }))
}

export function silentWav(): Uint8Array<ArrayBuffer> {
  const sampleRate = 8000
  const dataSize = 2
  const view = new DataView(new ArrayBuffer(44 + dataSize))
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataSize, true)
  return new Uint8Array(view.buffer)
}
