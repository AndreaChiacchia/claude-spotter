import { expect, test } from 'claude-code/testing'

import { GLINT_UP, TRACK, DEFAULT, mixColor } from '../hooks/cells'
import type { Cell } from '../hooks/cells'
import {
  DOT_SPIN_FRAMES,
  DOT_SPIN_SUBTLE_FRAMES,
  FADE_FRAMES,
  FRAME_MS,
  IDLE_FRAME_MS,
  IDLE_FRAME_TICKS,
  advance,
  composeBar,
  createMotion,
  frameMsFor,
  isActive,
  isBarActive,
  observe,
  startFade,
} from '../hooks/motion'
import type { MotionState } from '../hooks/motion'
import { STYLES, drawBar, normalizeSettings } from '../hooks/styles'
import type { BarPref, Motion } from '../types'

const GREEN = 0x5fff00

const cellText = (cells: Cell[]): string => cells.map(c => String.fromCodePoint(c.cp)).join('')

/** A bar that has taken `from` silently, then sees `to` (tokens follow as ten thousand a point). */
function moved(pref: BarPref, from: number, to: number, level: Motion = 'lively') {
  const m = createMotion()
  observe(m, 'a1', { percent: from, tokens: from * 10_000 }, pref, level, false)
  observe(m, 'a1', { percent: to, tokens: to * 10_000 }, pref, level, false)

  return m
}

const barOf = (m: MotionState) => m.bars.get('a1')!

/** Every frame from the tick after the change until `last`, as cells. */
function frames(m: MotionState, pref: BarPref, level: 'lively' | 'subtle', last: number) {
  const out: Cell[][] = []
  for (let i = 0; i < last; i++) {
    advance(m)
    out.push(composeBar(m, 'a1', pref, level))
  }

  return out
}

test('motion comes from the setting, and defaults to lively', () => {
  expect(normalizeSettings({}).motion).toBe('lively')
  expect(normalizeSettings({ motion: 'subtle' }).motion).toBe('subtle')
  expect(normalizeSettings({ motion: 'off' }).motion).toBe('off')
  expect(normalizeSettings({ motion: 'wild' }).motion).toBe('lively')
})

test('a growing blocks bar eases its tip by eighths; at rest it is whole cells', () => {
  const pref = { style: 'blocks', width: 10 }
  const m = moved(pref, 12, 20)
  const cells = composeBar(m, 'a1', pref, 'lively').slice(0, 10)
  expect(cells.some(c => c.cp >= 0x2589 && c.cp <= 0x258f)).toBe(true)
  const last = frames(m, pref, 'lively', 80).at(-1) ?? []
  expect(cellText(last).startsWith('██░░░░░░░░ 20%')).toBe(true)
})

test('a heavy bar draws its track in the dim heavy gray', () => {
  const pref = { style: 'heavy', width: 5 }
  const m = createMotion()
  observe(m, 'a1', { percent: 40, tokens: 400_000 }, pref, 'lively', false)
  const cells = composeBar(m, 'a1', pref, 'lively').slice(0, 5)
  expect(cells.map(c => c.cp)).toEqual([0x2501, 0x2501, 0x2501, 0x2501, 0x2501])
  expect(cells.map(c => c.fg)).toEqual([GREEN, GREEN, 0x444444, 0x444444, 0x444444])
})

test('with nothing moving a bar is exactly the plain bar, a space, the figure, then the tokens, in every style and width', () => {
  for (const style of STYLES) {
    for (const width of [3, 5, 20]) {
      for (const percent of [0, 7, 50, 100]) {
        const pref = { style: style.id, width }
        const m = createMotion()
        observe(m, 'a1', { percent, tokens: 76_000 }, pref, 'lively', false)
        const plain = drawBar(pref, percent).map(part => part.text).join('')
        const expected = style.id === 'none' ? `${percent}% · 76K` : `${plain} ${percent}% · 76K`
        expect(cellText(composeBar(m, 'a1', pref, 'lively'))).toBe(expected)
        expect(isActive(m)).toBe(false)
      }
    }
  }
})

test('a rise glints warm over the fill; Subtle glints softer', () => {
  const pref = { style: 'blocks', width: 10 }
  const lively = frames(moved(pref, 12, 20), pref, 'lively', 11)
  expect(lively.some(f => f.some(c => c.fg === mixColor(GREEN, GLINT_UP, 0.6)))).toBe(true)

  const subtle = frames(moved(pref, 12, 20, 'subtle'), pref, 'subtle', 11)
  expect(subtle.some(f => f.some(c => c.fg === mixColor(GREEN, GLINT_UP, 0.3)))).toBe(true)
  expect(subtle.some(f => f.some(c => c.fg === mixColor(GREEN, GLINT_UP, 0.6)))).toBe(false)
})

test('a fall glints cold over the empty cells', () => {
  const pref = { style: 'blocks', width: 10 }
  const GLINT_DOWN = 0x5fd7ff
  const fall = frames(moved(pref, 40, 30), pref, 'lively', 11)
  expect(fall.some(f => f.some(c => c.cp === 0x2591 && c.fg === mixColor(TRACK, GLINT_DOWN, 0.6)))).toBe(true)
})

test('the percent rolls toward its value in shrinking steps', () => {
  const pref = { style: 'blocks', width: 10 }
  const m = moved(pref, 12, 52)
  const seen: number[] = []
  for (let i = 0; i < 11; i++) {
    advance(m)
    advance(m)
    seen.push(barOf(m).shown)
  }
  expect(seen).toEqual([22, 30, 36, 40, 43, 46, 48, 49, 50, 51, 52])
})

test('the token count rolls like an odometer and stops at its value', () => {
  const pref = { style: 'parallelogram', width: 5 }
  const m = createMotion()
  observe(m, 'a1', { percent: 8, tokens: 76_000 }, pref, 'lively', true)
  expect(cellText(composeBar(m, 'a1', pref, 'lively')).endsWith('  0')).toBe(true)
  const seen: string[] = []
  for (let i = 0; i < 40; i++) {
    advance(m)
    seen.push(cellText(composeBar(m, 'a1', pref, 'lively')))
  }
  expect(seen.some(t => t.endsWith('19K'))).toBe(true)
  expect(cellText(composeBar(m, 'a1', pref, 'lively')).endsWith(' 76K')).toBe(true)
  expect(barOf(m).tokens.shown).toBe(76_000)
  expect(isActive(m)).toBe(false)
  // The changed digits flash while it rolls.
  const flashing = createMotion()
  observe(flashing, 'a1', { percent: 8, tokens: 76_000 }, pref, 'lively', true)
  advance(flashing)
  advance(flashing)
  expect(composeBar(flashing, 'a1', pref, 'lively').some(c => c.fg === GLINT_UP)).toBe(true)
})

test('a compaction sparkles in Lively only, then settles', () => {
  const pref = { style: 'parallelogram', width: 10 }
  const lively = moved(pref, 85, 23)
  expect(cellText(composeBar(lively, 'a1', pref, 'lively'))).toContain('↻ −62%')
  const livelyFrames = frames(lively, pref, 'lively', 60)
  expect(livelyFrames.some(f => f.some(c => c.cp === 0x2726))).toBe(true)
  expect(isActive(lively)).toBe(false)

  const subtle = moved(pref, 85, 23, 'subtle')
  expect(cellText(composeBar(subtle, 'a1', pref, 'subtle'))).toContain('↻ −62%')
  const subtleFrames = frames(subtle, pref, 'subtle', 60)
  expect(subtleFrames.some(f => f.some(c => c.cp === 0x2726 || c.cp === 0x2727))).toBe(false)
  expect(isActive(subtle)).toBe(false)
})

test('only crossing 50 or 80 upward pulses the bar, hot only on 80', () => {
  const pref = { style: 'blocks', width: 10 }
  expect(barOf(moved(pref, 45, 55)).pulse?.isHot).toBe(false)
  expect(barOf(moved(pref, 70, 85)).pulse?.isHot).toBe(true)
  expect(barOf(moved(pref, 55, 45)).pulse).toBe(null)
  expect(barOf(moved(pref, 52, 60)).pulse).toBe(null)
})

test('the first value is silent; one that enters after the first draw fills in from empty with a warm glint', () => {
  const pref = { style: 'parallelogram', width: 5 }
  const silent = createMotion()
  observe(silent, 'a1', { percent: 55, tokens: 550_000 }, pref, 'lively', false)
  expect(isActive(silent)).toBe(false)

  const entering = createMotion()
  observe(entering, 'a1', { percent: 55, tokens: 550_000 }, pref, 'lively', true)
  const b = barOf(entering)
  expect(b.glint?.dir).toBe('up')
  expect(b.grow?.from).toBe(0)
  expect(b.pulse).toBe(null)
  expect(isActive(entering)).toBe(true)
  expect(cellText(composeBar(entering, 'a1', pref, 'lively')).startsWith('▱▱▱▱▱ 0% ·')).toBe(true)
  const after = frames(entering, pref, 'lively', 60)
  expect(cellText(after.at(-1)!).startsWith('▰▰▰▱▱ 55% · 550K')).toBe(true)

  // Under a tone that does not change, the glint is the plain warm one over the fill.
  const green = createMotion()
  observe(green, 'a1', { percent: 30, tokens: 300_000 }, pref, 'lively', true)
  const glint = frames(green, pref, 'lively', 20)
  expect(glint.some(f => f.some(c => c.fg === mixColor(GREEN, GLINT_UP, 0.6)))).toBe(true)

  // Off takes it silently whatever the entrance.
  const off = createMotion()
  observe(off, 'a1', { percent: 55, tokens: 550_000 }, pref, 'off', true)
  expect(isActive(off)).toBe(false)
})

test('a finished bar fades to gray, drops every effect and takes no new value', () => {
  const pref = { style: 'parallelogram', width: 5 }
  const m = createMotion()
  observe(m, 'a1', { percent: 55, tokens: 550_000 }, pref, 'lively', true)
  advance(m)
  startFade(m, 'a1')
  for (let i = 0; i < FADE_FRAMES; i++) advance(m)
  const cells = composeBar(m, 'a1', pref, 'lively')
  expect(cellText(cells)).toBe('▰▰▰▱▱ 55% · 550K')
  expect(cells.filter(c => c.fg !== DEFAULT).every(c => c.fg === TRACK)).toBe(true)
  expect(isActive(m)).toBe(false)

  observe(m, 'a1', { percent: 20, tokens: 200_000 }, pref, 'lively', false)
  expect(barOf(m).target).toBe(55)
})

test('a bar with nothing moving draws the same frame from then on', () => {
  const pref = { style: 'parallelogram', width: 5 }
  const scenarios: [string, () => MotionState][] = [
    ['a rise and a pulse', () => moved(pref, 12, 52)],
    ['a compaction', () => moved(pref, 85, 23)],
    [
      'an entrance',
      () => {
        const m = createMotion()
        observe(m, 'a1', { percent: 30, tokens: 300_000 }, pref, 'lively', true)

        return m
      },
    ],
    [
      'a fade',
      () => {
        const m = moved(pref, 10, 40)
        for (let i = 0; i < 3; i++) advance(m)
        startFade(m, 'a1')

        return m
      },
    ],
  ]
  for (const [, make] of scenarios) {
    const m = make()
    let isSettled = false
    for (let i = 0; i <= 400; i++) {
      // The bar's own test and the whole motion's agree while it is the only thing that moves.
      expect(isActive(m)).toBe(isBarActive(m, 'a1'))
      if (!isBarActive(m, 'a1')) {
        isSettled = true
        break
      }
      advance(m)
    }
    expect(isSettled).toBe(true)
    const a = composeBar(m, 'a1', pref, 'lively')
    for (let i = 0; i < 200; i++) advance(m)
    const b = composeBar(m, 'a1', pref, 'lively')
    expect(b).toEqual(a)
  }
  const none = createMotion()
  expect(isBarActive(none, 'nobody')).toBe(false)
  expect(none.bars.has('nobody')).toBe(false)
})

test('the slow period keeps every spinner step on a whole frame', () => {
  const pref = { style: 'blocks', width: 10 }
  expect(DOT_SPIN_FRAMES % IDLE_FRAME_TICKS).toBe(0)
  expect(DOT_SPIN_SUBTLE_FRAMES % IDLE_FRAME_TICKS).toBe(0)
  expect(IDLE_FRAME_TICKS * FRAME_MS).toBe(IDLE_FRAME_MS)
  expect(frameMsFor(createMotion())).toBe(IDLE_FRAME_MS)
  expect(frameMsFor(moved(pref, 12, 52))).toBe(FRAME_MS)
})
