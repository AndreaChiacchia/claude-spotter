import { expect, test } from 'claude-code/testing'

import { HOT, LIVE, PLAIN, TRACK, mixColor, rgb } from '../hooks/cells'
import type { Cell } from '../hooks/cells'
import { TONES } from '../hooks/format'
import { PULSE_PROFILE, TOOL_FRAMES, createMotion, observe } from '../hooks/motion'
import type { MotionState } from '../hooks/motion'
import { composeDot, composeTail, flashTool, markDone, tailWidth, toolSlot } from '../hooks/row'
import type { TailState } from '../hooks/row'

const cellText = (cells: Cell[]): string => cells.map(c => String.fromCodePoint(c.cp)).join('')

/** A motion state at tick `t`. */
function at(t: number): MotionState {
  const m = createMotion()
  m.tick = t

  return m
}

const live = (slot: number, elapsedMs = 12_000): TailState => ({ kind: 'live', elapsedMs, slot })

test('the running dot stays full and dims every half second in Lively', () => {
  for (let t = 0; t < 20; t++) {
    const [cell] = composeDot(at(t), 'a1', 'running', 'lively')
    expect(String.fromCodePoint(cell!.cp)).toBe('●')
    expect(cell!.fg).toBe(t < 10 ? LIVE : mixColor(LIVE, TRACK, 0.5))
  }
})

test('in Subtle the running dot stays lit and changes color every second', () => {
  for (let t = 0; t < 40; t++) {
    const [cell] = composeDot(at(t), 'a1', 'running', 'subtle')
    expect(String.fromCodePoint(cell!.cp)).toBe('●')
    expect(cell!.fg).toBe(t < 20 ? LIVE : mixColor(LIVE, TRACK, 0.5))
  }
})

test('pending, waiting and done dots', () => {
  const [pending] = composeDot(at(3), 'a1', 'pending', 'lively')
  expect([String.fromCodePoint(pending!.cp), pending!.fg]).toEqual(['◌', LIVE])
  const [waiting] = composeDot(at(3), 'a1', 'waiting', 'subtle')
  expect([String.fromCodePoint(waiting!.cp), waiting!.fg]).toEqual(['◐', LIVE])
  const [done] = composeDot(at(3), 'a1', 'done', 'lively')
  expect([String.fromCodePoint(done!.cp), done!.fg]).toEqual(['●', TRACK])
})

test('crossing 80% pulses the dot toward red in Lively only', () => {
  const m = createMotion()
  const pref = { style: 'parallelogram', width: 5 }
  observe(m, 'a1', { percent: 70, tokens: 700_000 }, pref, 'lively', false)
  observe(m, 'a1', { percent: 85, tokens: 850_000 }, pref, 'lively', false)
  const [lively] = composeDot(m, 'a1', 'running', 'lively')
  expect(lively!.fg).toBe(mixColor(LIVE, HOT, PULSE_PROFILE[0]!))
  expect(String.fromCodePoint(lively!.cp)).toBe('●')
  const [subtle] = composeDot(m, 'a1', 'running', 'subtle')
  expect(subtle!.fg).toBe(LIVE)

  // A pulse that crossed 50% only does not touch the dot.
  const warm = createMotion()
  observe(warm, 'a1', { percent: 45, tokens: 450_000 }, pref, 'lively', false)
  observe(warm, 'a1', { percent: 55, tokens: 550_000 }, pref, 'lively', false)
  expect(composeDot(warm, 'a1', 'running', 'lively')[0]!.fg).toBe(LIVE)
})

test('the live tail: the elapsed time, then exactly the slot of blanks', () => {
  const cells = composeTail(at(0), 'a1', live(14), 'lively')
  expect(cellText(cells)).toBe(' · 12s' + ' '.repeat(14))
  expect(cells.length).toBe(tailWidth(live(14)))
  expect(cells.slice(0, 6).every(c => c.fg === PLAIN)).toBe(true)
})

test('a tool call flashes its name in the slot: bright for four frames in Lively, then plain, then gone', () => {
  const m = at(0)
  flashTool(m, 'a1', 'Grep')
  const slot = '  ‹Grep›'.padEnd(14)
  for (let t = 0; t < 4; t++) {
    m.tick = t
    const cells = composeTail(m, 'a1', live(14), 'lively')
    expect(cellText(cells)).toBe(' · 12s' + slot)
    expect(cells.slice(6).every(c => c.fg === LIVE)).toBe(true)
  }
  m.tick = 4
  expect(composeTail(m, 'a1', live(14), 'lively').slice(6).every(c => c.fg === PLAIN)).toBe(true)
  m.tick = TOOL_FRAMES - 1
  expect(cellText(composeTail(m, 'a1', live(14), 'lively'))).toBe(' · 12s' + slot)
  m.tick = TOOL_FRAMES
  expect(cellText(composeTail(m, 'a1', live(14), 'lively'))).toBe(' · 12s' + ' '.repeat(14))

  const subtle = at(0)
  flashTool(subtle, 'a1', 'Grep')
  expect(composeTail(subtle, 'a1', live(14), 'subtle').slice(6).every(c => c.fg === PLAIN)).toBe(true)
})

test('a long tool name is cut to the slot; a slot under five shows no flash', () => {
  const m = at(0)
  flashTool(m, 'a1', 'mcp__gh__a_very_long_tool')
  expect(cellText(composeTail(m, 'a1', live(14), 'lively'))).toBe(' · 12s' + '  ‹a_very_lon›')
  expect(cellText(composeTail(m, 'a1', live(8), 'lively'))).toBe(' · 12s' + '  ‹a_ve›')
  expect(cellText(composeTail(m, 'a1', live(5), 'lively'))).toBe(' · 12s' + '  ‹a›')
  expect(cellText(composeTail(m, 'a1', live(4), 'lively'))).toBe(' · 12s' + '    ')
  expect(cellText(composeTail(m, 'a1', live(0), 'lively'))).toBe(' · 12s')
  // A new call replaces the one showing.
  flashTool(m, 'a1', 'Read')
  expect(cellText(composeTail(m, 'a1', live(14), 'lively'))).toBe(' · 12s' + '  ‹Read›'.padEnd(14))
})

test('the finish mark: green and twinkling when the bar ended green, lavender and steady otherwise', () => {
  const lean: TailState = { kind: 'done', word: 'done', durationMs: 42_000, isLean: true }
  const m = at(0)
  markDone(m, 'a1')
  const first = composeTail(m, 'a1', lean, 'lively')
  expect(cellText(first)).toBe(' ✦ done · 42s')
  expect(first.every(c => c.fg === rgb(TONES.ok))).toBe(true)
  for (let t = 0; t < 16; t++) {
    m.tick = t
    expect(String.fromCodePoint(composeTail(m, 'a1', lean, 'lively')[1]!.cp)).toBe(Math.floor(t / 4) % 2 === 0 ? '✦' : '✧')
  }

  const steady: TailState = { kind: 'done', word: 'done', durationMs: 42_000, isLean: false }
  for (let t = 0; t < 12; t++) {
    m.tick = t
    const cells = composeTail(m, 'a1', steady, 'lively')
    expect(cellText(cells)).toBe(' ✦ done · 42s')
    expect(cells.every(c => c.fg === LIVE)).toBe(true)
  }
})

test('a stopped or failed finish, and Subtle', () => {
  const m = at(0)
  const failed: TailState = { kind: 'done', word: 'failed', durationMs: 42_000, isLean: true }
  const failedCells = composeTail(m, 'a1', failed, 'lively')
  expect(cellText(failedCells)).toBe(' ✗ failed · 42s')
  expect(failedCells.every(c => c.fg === HOT)).toBe(true)

  const stopped: TailState = { kind: 'done', word: 'stopped', durationMs: 42_000, isLean: false }
  const stoppedCells = composeTail(m, 'a1', stopped, 'lively')
  expect(cellText(stoppedCells)).toBe(' ✗ stopped · 42s')
  expect(stoppedCells.every(c => c.fg === PLAIN)).toBe(true)

  const lean: TailState = { kind: 'done', word: 'done', durationMs: 42_000, isLean: true }
  markDone(m, 'a1')
  m.tick = 4
  const subtle = composeTail(m, 'a1', lean, 'subtle')
  expect(cellText(subtle)).toBe(' ✦ done · 42s')
  expect(subtle.every(c => c.fg === PLAIN)).toBe(true)
})

test('the tool slot takes what is left of the row, up to 14 columns, and none under five', () => {
  expect(toolSlot(100, 90)).toBe(10)
  expect(toolSlot(100, 50)).toBe(14)
  expect(toolSlot(100, 97)).toBe(0)
})

test('the tail width is the composed length, live or done', () => {
  const m = at(0)
  flashTool(m, 'a1', 'Grep')
  for (const tail of [live(14), live(14, 72_000), live(7, 5_000), live(0)]) {
    expect(composeTail(m, 'a1', tail, 'lively').length).toBe(tailWidth(tail))
  }
  for (const word of ['done', 'stopped', 'failed'] as const) {
    const tail: TailState = { kind: 'done', word, durationMs: 72_000, isLean: false }
    expect(composeTail(m, 'a1', tail, 'lively').length).toBe(tailWidth(tail))
  }
})
