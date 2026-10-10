import { expect, test } from 'claude-code/testing'

import { lineSegments, modelLabel, windowFor } from '../hooks/format'
import { DEFAULT_BAR } from '../hooks/styles'

const text = (segments: { text: string }[]) => segments.map(s => s.text).join('')

test('a subagent window: 1M by its id, the main one for the main model, else 200K', () => {
  const main = { model: 'claude-opus-5-5[1m]', window: 1_000_000 }
  expect(windowFor('claude-sonnet-5-5[1m]', main)).toBe(1_000_000)
  expect(windowFor('claude-opus-5-5', main)).toBe(1_000_000)
  expect(windowFor('claude-haiku-5-5', main)).toBe(200_000)
  expect(windowFor('claude-opus-5-5', { model: 'claude-opus-5-5', window: 0 })).toBe(200_000)
})

test('model names read as claudepeeker shows them', () => {
  expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
  expect(modelLabel('claude-opus-5-5[1m]')).toBe('Opus 5.5')
})

test('the line: model and effort, the agent, then the context once a response came', () => {
  const stat = { model: 'claude-sonnet-5-5', effort: 'low', tokens: null }
  expect(text(lineSegments(stat, 'Plan', 200_000, DEFAULT_BAR))).toBe('Sonnet 5.5 ·low · Plan')
  expect(text(lineSegments({ ...stat, tokens: 76_000 }, 'Plan', 200_000, DEFAULT_BAR))).toBe(
    'Sonnet 5.5 ·low · Plan · ctx (200K) ▰▰▱▱▱ 38%',
  )
  expect(text(lineSegments({ ...stat, effort: null, tokens: 0 }, 'Plan', 200_000, DEFAULT_BAR))).toBe(
    'Sonnet 5.5 · Plan · ctx (200K) ▱▱▱▱▱ 0%',
  )
})
