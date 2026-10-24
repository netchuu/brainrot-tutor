import { describe, expect, it } from 'vitest'
import { mascotPose } from '@/templates/pose'
import { fixtureScene } from '@/test/fixtureEvents'

describe('mascotPose', () => {
  it('keeps the listener neutral', () => {
    expect(mascotPose(fixtureScene('e0s0'), 'student')).toBe('neutral')
  })

  it('shocks the speaker on mind_blown and shocked reactions', () => {
    expect(mascotPose(fixtureScene('e0s0'), 'teacher')).toBe('shocked')
    expect(mascotPose(fixtureScene('e2s1'), 'teacher')).toBe('shocked')
  })

  it('points when the teacher talks over a picture', () => {
    expect(mascotPose(fixtureScene('e0s2'), 'teacher')).toBe('pointing')
  })

  it('stays neutral for a student line without a strong reaction', () => {
    expect(mascotPose(fixtureScene('e0s1'), 'student')).toBe('neutral')
  })
})
