import { expect, test } from 'claude-code/testing'

import {
  finishToast,
  formatElapsed,
  lineSegments,
  modelLabel,
  plainRowSegments,
  shortTool,
  windowFor,
  wordForReason,
  wordForStatus,
} from '../hooks/format'
import { DEFAULT_BAR, DEFAULT_SETTINGS, normalizeSettings } from '../hooks/styles'

const text = (segments: { text: string }[]) => segments.map(s => s.text).join('')

test('a subagent window: 1M by its id, the main one for the main model, 1M for a known family, else 200K', () => {
  const main = { model: 'claude-opus-5-5[1m]', window: 1_000_000 }
  expect(windowFor('claude-sonnet-5-5[1m]', main)).toBe(1_000_000)
  expect(windowFor('claude-opus-5-5', main)).toBe(1_000_000)
  expect(windowFor('claude-opus-5-5', { model: 'claude-opus-5-5', window: 0 })).toBe(1_000_000)
  expect(windowFor('claude-opus-5-5', { model: 'claude-opus-5-5', window: 200_000 })).toBe(200_000)
})

test('a model of a known family takes 1M, whatever the main session runs', () => {
  const main = { model: 'claude-mythos-5-1', window: 200_000 }
  expect(windowFor('claude-opus-5-5', main)).toBe(1_000_000)
  expect(windowFor('claude-fable-5-1', main)).toBe(1_000_000)
  expect(windowFor('claude-sonnet-4-5-20250929', main)).toBe(1_000_000)
  expect(windowFor('claude-haiku-5-5', main)).toBe(1_000_000)
  expect(windowFor('some-other-model', main)).toBe(200_000)
})

test('tokens past the window settled on mean a 1M window', () => {
  const main = { model: 'claude-mythos-5-1', window: 200_000 }
  expect(windowFor('some-other-model', main, 150_000)).toBe(200_000)
  expect(windowFor('some-other-model', main, 250_000)).toBe(1_000_000)
  expect(windowFor('claude-mythos-5-1', main, 250_000)).toBe(1_000_000)
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

test('settings fall back to their defaults', () => {
  expect(normalizeSettings({ barStyle: 'gone', barWidth: '7', motion: 'wild' })).toEqual(DEFAULT_SETTINGS)
  expect(normalizeSettings({ barStyle: 'heavy', barWidth: '8' }).bar).toEqual({ style: 'heavy', width: 8 })
})

test('the elapsed time: seconds, minutes and seconds, hours and minutes', () => {
  expect(formatElapsed(0)).toBe('0s')
  expect(formatElapsed(42_000)).toBe('42s')
  expect(formatElapsed(59_999)).toBe('59s')
  expect(formatElapsed(72_000)).toBe('1m12s')
  expect(formatElapsed(65_000)).toBe('1m05s')
  expect(formatElapsed(3_720_000)).toBe('1h02m')
})

test('a tool name is cut to its last part and ten characters', () => {
  expect(shortTool('mcp__gh__issue')).toBe('issue')
  expect(shortTool('Grep')).toBe('Grep')
  expect(shortTool('mcp__gh__a_very_long_tool')).toBe('a_very_lon')
  expect(shortTool('')).toBe('tool')
})

test('how a subagent ended reads as done, stopped or failed', () => {
  expect(wordForReason('answer')).toBe('done')
  expect(wordForReason('aborted')).toBe('stopped')
  expect(wordForReason('refusal')).toBe('failed')
  expect(wordForReason('error')).toBe('failed')
  expect(wordForStatus('completed')).toBe('done')
  expect(wordForStatus('idle')).toBe('done')
  expect(wordForStatus('killed')).toBe('stopped')
  expect(wordForStatus('failed')).toBe('failed')
})

test('the finish toast names the agent, how it ended, how long and its last context', () => {
  expect(finishToast('Explore', 'done', 42_000, 63_000)).toBe('Claude-Spotter: Explore done · 42s · 63K')
  expect(finishToast('Plan', 'stopped', 5_000, null)).toBe('Claude-Spotter: Plan stopped · 5s')
})

test('the plain row: the dot, the line, the context tokens, then the elapsed time or the finish', () => {
  const stat = { model: 'claude-sonnet-5-5', effort: 'low', tokens: 76_000 }
  const row = { dot: 'running', stat, type: 'Plan', window: 200_000, bar: DEFAULT_BAR, elapsedMs: 12_000, finish: null } as const
  expect(text(plainRowSegments(row))).toBe('● Sonnet 5.5 ·low · Plan · ctx (200K) ▰▰▱▱▱ 38% · 76K · 12s')
  expect(
    text(plainRowSegments({ ...row, dot: 'done', finish: { word: 'done', durationMs: 42_000 } })),
  ).toBe('● Sonnet 5.5 ·low · Plan · ctx (200K) ▰▰▱▱▱ 38% · 76K ✦ done · 42s')
  expect(text(plainRowSegments({ ...row, dot: 'pending', stat: undefined, elapsedMs: 0 }))).toBe('◌ Plan · starting… · 0s')
})
