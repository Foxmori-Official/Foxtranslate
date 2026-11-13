import { expect, it } from 'vitest'
import { normalizeConfig } from '../../src/shared/config'

it.each([
  [-10, 1], [0, 1], [1, 1], [5.9, 5], [8, 8], [1000, 8],
  [NaN, 3], [Infinity, 3], ['5', 3], [null, 3],
])('normalizes stored/imported concurrency %s to %s', (value, expected) => {
  expect(normalizeConfig({ batch: { concurrency: value } }).batch.concurrency).toBe(expected)
})

it('bounds batch size so page admission cannot grow without a limit', () => {
  expect(normalizeConfig({ batch: { maxTexts: 1e9 } }).batch.maxTexts).toBe(32)
  expect(normalizeConfig({ batch: { maxTexts: 0 } }).batch.maxTexts).toBe(1)
  expect(normalizeConfig({ batch: { maxTexts: NaN } }).batch.maxTexts).toBe(8)
})
