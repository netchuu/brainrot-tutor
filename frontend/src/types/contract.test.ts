import schemaText from '../../../contracts/schemas/contract.schema.json?raw'
import { describe, expect, it } from 'vitest'
import { ERROR_CODES, LANGUAGES, REACTIONS, SFX, SPEAKERS, TEMPLATE_IDS, VERDICTS } from '@/types/contract'

const schema: unknown = JSON.parse(schemaText)

function at(node: unknown, ...path: string[]): unknown {
  let current = node
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = Reflect.get(current, key)
  }
  return current
}

describe('contract enums', () => {
  it.each([
    ['Language', LANGUAGES],
    ['TemplateId', TEMPLATE_IDS],
    ['Speaker', SPEAKERS],
    ['Reaction', REACTIONS],
    ['Sfx', SFX],
    ['ErrorCode', ERROR_CODES],
  ])('%s matches the JSON Schema', (name, values) => {
    expect(at(schema, '$defs', name, 'enum')).toEqual(values)
  })

  it('Verdict matches Scene.verdict without null', () => {
    expect(at(schema, '$defs', 'Scene', 'properties', 'verdict', 'enum')).toEqual([...VERDICTS, null])
  })
})
