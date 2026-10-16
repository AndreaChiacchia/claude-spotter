// A row dot and tail as cells: the state glyph, the elapsed time, the tool flash and the finish.

import {
  DEFAULT,
  DOT_FULL,
  DOT_PENDING,
  DOT_RUNNING,
  DOT_SPIN,
  HOT,
  LIVE,
  PLAIN,
  SPARK_FULL,
  SPARK_HOLLOW,
  TOOL_L,
  TOOL_R,
  TRACK,
  mixColor,
  rgb,
  textCells,
} from './cells'
import type { Cell } from './cells'
import { TONES, doneText, formatElapsed, shortTool } from './format'
import type { DotState, FinishWord } from './format'
import {
  DOT_SPIN_FRAMES,
  DOT_SPIN_SUBTLE_FRAMES,
  PULSE_COUNT,
  PULSE_PROFILE,
  TOOL_BRIGHT_FRAMES,
  TOOL_FRAMES,
  TWINKLE_FRAMES,
  rowOf,
} from './motion'
import type { MotionState } from './motion'

/** The tool flash slot at the end of a live row: two spaces, `‹`, up to 10 code points, `›`. */
export const TOOL_SLOT_COLS = 14
/** Under this many columns the flash does not show: the slot is not drawn. */
export const TOOL_MIN_SLOT = 5

/** The slot a row takes at the end: what is left of `cols` past the row's natural width, up to `TOOL_SLOT_COLS`; none when it is too small. */
export function toolSlot(cols: number, natural: number): number {
  const room = cols - natural

  return room >= TOOL_MIN_SLOT ? Math.min(room, TOOL_SLOT_COLS) : 0
}

/** A tool call by the subagent: its short name shows at the end of its row (a new call replaces one showing). */
export function flashTool(m: MotionState, id: string, tool: string): void {
  rowOf(m, id).tool = { text: shortTool(tool), start: m.tick }
}

/** The row finished: its done mark starts now (once). */
export function markDone(m: MotionState, id: string): void {
  const r = rowOf(m, id)
  if (r.doneStart === null) r.doneStart = m.tick
}

const glyph = (cp: number, fg: number): Cell[] => [{ cp, fg, bg: DEFAULT }]

/**
 * The state dot of a row: one cell. Running: the lavender spinner `◐ ◓ ◑ ◒`, a step every 0.2 s in Lively and every
 * second in Subtle. Waiting: a steady `●` dimmed half-way to gray (claudepeeker's dim dot). Pending `◌`, done a gray
 * `●`. While the bar's level-up pulse crosses 80% (Lively) the dot keeps its glyph and pulses toward red.
 */
export function composeDot(m: MotionState, id: string, state: DotState, level: 'lively' | 'subtle'): Cell[] {
  const t = m.tick
  const cp =
    state === 'pending'
      ? DOT_PENDING
      : state === 'running'
        ? (DOT_SPIN[Math.floor(t / (level === 'lively' ? DOT_SPIN_FRAMES : DOT_SPIN_SUBTLE_FRAMES)) % DOT_SPIN.length] ?? DOT_RUNNING)
        : DOT_FULL
  const pulse = m.bars.get(id)?.pulse
  if (level === 'lively' && pulse != null && pulse.isHot && t < pulse.start + PULSE_PROFILE.length * PULSE_COUNT) {
    return glyph(cp, mixColor(LIVE, HOT, PULSE_PROFILE[(t - pulse.start) % PULSE_PROFILE.length] ?? 0))
  }
  if (state === 'done') return glyph(cp, TRACK)
  if (state === 'waiting') return glyph(cp, mixColor(LIVE, TRACK, 0.5))

  return glyph(cp, LIVE)
}

export type TailState =
  | { kind: 'live'; elapsedMs: number; slot: number }
  | { kind: 'done'; word: FinishWord; durationMs: number; isLean: boolean }

/** The end of a row: ` · 12s` and the tool flash slot, or the finish mark. */
export function composeTail(m: MotionState, id: string, tail: TailState, level: 'lively' | 'subtle'): Cell[] {
  const t = m.tick
  if (tail.kind === 'live') {
    const out = textCells(` · ${formatElapsed(tail.elapsedMs)}`, PLAIN)
    const tool = rowOf(m, id).tool
    if (tool === null || t >= tool.start + TOOL_FRAMES || tail.slot < TOOL_MIN_SLOT) {
      for (let i = 0; i < tail.slot; i++) out.push(...textCells(' ', PLAIN))

      return out
    }
    const name = Array.from(tool.text).slice(0, tail.slot - 4).join('')
    const shown = `  ${String.fromCodePoint(TOOL_L)}${name}${String.fromCodePoint(TOOL_R)}`
    const text = shown + ' '.repeat(Math.max(0, tail.slot - Array.from(shown).length))
    const fg = level === 'lively' && t - tool.start < TOOL_BRIGHT_FRAMES ? LIVE : PLAIN

    return [...out, ...textCells(text, fg)]
  }

  const text = doneText(tail.word, tail.durationMs)
  if (level === 'subtle') return textCells(text, PLAIN)
  if (tail.word === 'failed') return textCells(text, HOT)
  if (tail.word === 'stopped') return textCells(text, PLAIN)
  if (!tail.isLean) return textCells(text, LIVE)
  const cells = textCells(text, rgb(TONES.ok))
  const doneStart = rowOf(m, id).doneStart
  const isHollow = doneStart !== null && Math.floor((t - doneStart) / TWINKLE_FRAMES) % 2 === 1
  const mark = cells[1]
  if (mark !== undefined) mark.cp = isHollow ? SPARK_HOLLOW : SPARK_FULL

  return cells
}

/** The columns a tail takes now. */
export function tailWidth(tail: TailState): number {
  if (tail.kind === 'live') return 3 + formatElapsed(tail.elapsedMs).length + tail.slot

  return Array.from(doneText(tail.word, tail.durationMs)).length
}
