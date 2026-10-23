// The rows' motion: what changed, the effects it started, and each frame of a bar as cells (the claudepeeker engine, one bar per subagent).

import type { BarPref, Motion } from '../types'
import {
  COMPACT_MARK,
  DEFAULT,
  GLINT_DOWN,
  GLINT_UP,
  MINUS,
  PLAIN,
  SPARK_FULL,
  SPARK_HOLLOW,
  TRACK,
  lighten,
  mixColor,
  rgb,
  safeCp,
  textCells,
} from './cells'
import type { Cell } from './cells'
import { TONES, formatTokens, tone } from './format'
import { drawBar, drawMoving, styleOf, trackColorOf } from './styles'
import type { BarPart } from './styles'

/** One frame, in milliseconds: 20 frames a second. */
export const FRAME_MS = 50
/** While only the running spinner and the elapsed time move: a frame every 200 ms, four frames' worth (the Lively spinner steps every 4 frames, the Subtle one every 20, the time every second). */
export const IDLE_FRAME_MS = 200
/** The ticks one slow frame stands for. */
export const IDLE_FRAME_TICKS = IDLE_FRAME_MS / FRAME_MS
/** One glint pass (0.6 s). */
export const GLINT_FRAMES = 12
/** A change of at least this many points glints twice (Lively only). */
export const BIG_STEP = 5
/** Fill growth (0.4 s). */
export const GROW_FRAMES = 8
/** Fill color blend (0.4 s). */
export const COLOR_FRAMES = 8
/** The figures roll one step every this many frames. */
export const ROLL_EVERY = 2
/** Changed digits stay flashed this long after each roll step. */
export const FLASH_FRAMES = 6
/** Vacated cells fade to the track color (0.4 s). */
export const DRAIN_FRAMES = 8
/** Compaction sparkle drain: frames between neighbouring cells. */
export const SPARK_STRIDE = 2
/** One pulse, frame by frame. */
export const PULSE_PROFILE: readonly number[] = [0.2, 0.6, 1, 1, 0.6, 0.2]
/** Pulses per level-up. */
export const PULSE_COUNT = 3
/** The compaction badge stays this long (2 s). */
export const BADGE_FRAMES = 40
/** A ctx drop of at least this many points is a compaction. */
export const COMPACT_DROP = 20
/** A finished row stays this long (2 s) before it leaves. */
export const FINISH_MS = 2000
/** The fade of a finished row's bar to gray, in frames (the same 2 s). */
export const FADE_FRAMES = FINISH_MS / FRAME_MS
/** The tool flash at the end of a row stays this long (1.2 s). */
export const TOOL_FRAMES = 24
/** The first frames of a tool flash in the bright color (Lively). */
export const TOOL_BRIGHT_FRAMES = 4
/** The Lively running spinner steps every this many frames (0.2 s, as claudecharter's). */
export const DOT_SPIN_FRAMES = 4
/** The Subtle running spinner steps every this many frames (1 s). */
export const DOT_SPIN_SUBTLE_FRAMES = 20
/** The done mark twinkles every this many frames. */
export const TWINKLE_FRAMES = 4

const PULSE_LENGTH = PULSE_PROFILE.length

export type Level = {
  /** Blend at the sweep head; the two neighbours get half. */
  glint: number
  /** Passes for a change of at least `BIG_STEP` (smaller changes always 1). */
  glintPasses: 1 | 2
  /** Level-up lighten amount, times the profile. */
  pulse: number
  /** How far flashed digits go to the flash color. */
  flashMix: number
  /** ✦✧ in the compaction drain. */
  sparkle: boolean
  /** Badge in its color, else `PLAIN`. */
  badgeColored: boolean
}

export const LEVELS: Record<'lively' | 'subtle', Level> = {
  lively: { glint: 0.6, glintPasses: 2, pulse: 0.55, flashMix: 1, sparkle: true, badgeColored: true },
  subtle: { glint: 0.3, glintPasses: 1, pulse: 0.3, flashMix: 0.5, sparkle: false, badgeColored: false },
}

type Dir = 'up' | 'down'

/** A figure that rolls like an odometer toward its target. */
export type Odo = {
  /** The value it rolls toward; `null` = never seen. */
  target: number | null
  /** The value shown now. */
  shown: number
  /** Digit index from which the figure flashes, until which tick. */
  flash: { from: number; until: number; dir: Dir } | null
}

export type BarAnim = {
  /** The last percent seen; `null` = never seen (the next value is taken silently, or enters). */
  target: number | null
  /** The rolling percent figure (integer). */
  shown: number
  /** Digit index from which the percent figure flashes, until which tick. */
  flash: { from: number; until: number; dir: Dir } | null
  /** The percent the fill is drawn at, tweened (rises only). */
  grow: { from: number; to: number; start: number } | null
  /** Fill color tween (0xRRGGBB numbers). */
  color: { from: number; to: number; start: number } | null
  /** `fill` = filled interior cells of the target drawing. */
  glint: { dir: Dir; start: number; passes: 1 | 2; fill: number } | null
  /** Interior cells in `[to, from)` were filled and are now empty; `oldCps` are the old drawing's interior code points. */
  drain: {
    from: number
    to: number
    start: number
    oldCps: number[]
    oldColor: number
    sparkle: boolean
  } | null
  /** A level-up pulse; `isHot` when it crossed 80%. */
  pulse: { start: number; isHot: boolean } | null
  /** The compaction badge, `↻ −40%`. */
  badge: { text: string; start: number } | null
  /** The context tokens, rolling. */
  tokens: Odo
  /** A finished row's bar fading to gray; it takes no new values. */
  fade: { start: number } | null
}

export type RowAnim = {
  /** The tool the subagent just called, flashed at the end of its row. */
  tool: { text: string; start: number } | null
  /** When the row finished; null while it lives. */
  doneStart: number | null
}

export type MotionState = { tick: number; bars: Map<string, BarAnim>; rows: Map<string, RowAnim> }

export function freshBar(): BarAnim {
  return {
    target: null,
    shown: 0,
    flash: null,
    grow: null,
    color: null,
    glint: null,
    drain: null,
    pulse: null,
    badge: null,
    tokens: { target: null, shown: 0, flash: null },
    fade: null,
  }
}

export function freshRow(): RowAnim {
  return { tool: null, doneStart: null }
}

export function createMotion(): MotionState {
  return { tick: 0, bars: new Map(), rows: new Map() }
}

/** The bar of an agent, created when it has none. */
export function barOf(m: MotionState, id: string): BarAnim {
  let b = m.bars.get(id)
  if (b === undefined) {
    b = freshBar()
    m.bars.set(id, b)
  }

  return b
}

/** The row state of an agent, created when it has none. */
export function rowOf(m: MotionState, id: string): RowAnim {
  let r = m.rows.get(id)
  if (r === undefined) {
    r = freshRow()
    m.rows.set(id, r)
  }

  return r
}

/** Drops the bars and rows of every agent not in `keep`. */
export function pruneMotion(m: MotionState, keep: ReadonlySet<string>): void {
  for (const id of [...m.bars.keys()]) if (!keep.has(id)) m.bars.delete(id)
  for (const id of [...m.rows.keys()]) if (!keep.has(id)) m.rows.delete(id)
}

/** Ease-out quad: `1 - (1 - p)^2` with `p = min(1, elapsed / frames)`. */
function ease(elapsed: number, frames: number): number {
  const p = Math.min(1, Math.max(0, elapsed / frames))

  return 1 - (1 - p) * (1 - p)
}

const RANK: Record<ReturnType<typeof tone>, number> = { ok: 0, warn: 1, hot: 2 }

const toneColor = (percent: number): number => rgb(TONES[tone(percent)])

/** A cell of a drawn bar: `i` is its place among the interior cells (fill and track), -1 for a frame. */
type Slot = { cp: number; kind: BarPart['kind']; i: number }

function slots(parts: BarPart[]): Slot[] {
  const out: Slot[] = []
  let i = 0
  for (const part of parts) {
    for (const ch of part.text) {
      const cp = safeCp(ch.codePointAt(0) ?? 0x3f)
      out.push({ cp, kind: part.kind, i: part.kind === 'frame' ? -1 : i++ })
    }
  }

  return out
}

const fillCount = (list: Slot[]): number => list.filter(s => s.kind === 'fill').length

/** The fill color tween's value at `t`, or null when none is in progress. */
function colorAt(b: BarAnim, t: number): number | null {
  const c = b.color
  if (c === null || t >= c.start + COLOR_FRAMES) return null

  return mixColor(c.from, c.to, ease(t - c.start, COLOR_FRAMES))
}

/** The percent the fill is drawn at `t` while a grow is in progress, or null. */
function growAt(b: BarAnim, t: number): number | null {
  const g = b.grow
  if (g === null || t >= g.start + GROW_FRAMES) return null

  return g.from + (g.to - g.from) * ease(t - g.start, GROW_FRAMES)
}

/** Takes both figures as they are, with no effect running. */
function settle(b: BarAnim, next: { percent: number; tokens: number }): void {
  b.target = next.percent
  b.shown = next.percent
  b.flash = null
  b.grow = null
  b.color = null
  b.glint = null
  b.drain = null
  b.pulse = null
  b.badge = null
  b.tokens = { target: next.tokens, shown: next.tokens, flash: null }
}

/**
 * Called once per present bar on every render: a changed value starts its effects, the same value does nothing
 * (repeated renders are harmless), the first value is taken silently unless it is an entrance (a bar that
 * appears after the mod's first draw fills in from empty), and every value under Off is taken silently.
 * A finishing bar (fading) takes no new values.
 */
export function observe(
  m: MotionState,
  id: string,
  next: { percent: number; tokens: number },
  pref: BarPref,
  level: Motion,
  isEntrance: boolean,
): void {
  const b = barOf(m, id)
  if (b.fade !== null) return
  let entering = false
  if (b.target === null) {
    if (level === 'off' || !isEntrance) {
      settle(b, next)

      return
    }
    entering = true
    b.target = 0
    b.shown = 0
    b.tokens = { target: 0, shown: 0, flash: null }
  }
  if (level === 'off') {
    settle(b, next)

    return
  }
  const prev = b.target ?? 0
  const t = m.tick
  b.tokens.target = next.tokens
  if (next.percent === prev) return

  const L = LEVELS[level]
  const d = next.percent - prev
  const oldSlots = slots(drawBar(pref, prev))
  const newSlots = slots(drawBar(pref, next.percent))
  const oldF = fillCount(oldSlots)
  const newF = fillCount(newSlots)
  const cur = colorAt(b, t) ?? toneColor(prev)
  const nextTone = tone(next.percent)

  const startColor = (): void => {
    if (tone(prev) !== nextTone || colorAt(b, t) !== null) {
      b.color = { from: cur, to: rgb(TONES[nextTone]), start: t }
    }
  }
  const startDrain = (sparkle: boolean): void => {
    if (newF < oldF) {
      b.drain = {
        from: oldF,
        to: newF,
        start: t,
        oldCps: oldSlots.filter(s => s.i >= 0).map(s => s.cp),
        oldColor: cur,
        sparkle,
      }
    }
  }

  if (-d >= COMPACT_DROP) {
    b.glint = { dir: 'down', start: t, passes: L.glintPasses, fill: newF }
    startDrain(L.sparkle)
    b.badge = { text: `${String.fromCodePoint(COMPACT_MARK)} ${String.fromCodePoint(MINUS)}${-d}%`, start: t }
    startColor()
    b.grow = null
  } else if (d > 0) {
    b.glint = { dir: 'up', start: t, passes: d >= BIG_STEP ? L.glintPasses : 1, fill: newF }
    b.grow = { from: growAt(b, t) ?? prev, to: next.percent, start: t }
    startColor()
    if (RANK[nextTone] > RANK[tone(prev)] && !entering) b.pulse = { start: t, isHot: nextTone === 'hot' }
  } else {
    b.glint = { dir: 'down', start: t, passes: -d >= BIG_STEP ? L.glintPasses : 1, fill: newF }
    startDrain(false)
    startColor()
    b.grow = null
  }

  b.target = next.percent
}

/** The digit index where two figure texts first differ. */
function firstDiff(before: string, after: string): number {
  let from = 0
  const shorter = Math.min(before.length, after.length)
  while (from < shorter && before[from] === after[from]) from++

  return from
}

/** The token figure as drawn: right-aligned to the width its target takes. */
function tokenText(o: Odo): string {
  return formatTokens(o.shown).padStart(formatTokens(o.target ?? o.shown).length)
}

/** One frame on: the tick moves, and on roll ticks every figure steps toward its target, flashing the digits that changed. */
export function advance(m: MotionState): void {
  m.tick += 1
  if (m.tick % ROLL_EVERY !== 0) return
  for (const b of m.bars.values()) {
    if (b.target !== null && b.shown !== b.target) {
      const gap = b.target - b.shown
      const step = Math.min(Math.abs(gap), Math.max(1, Math.ceil(Math.abs(gap) / 4)))
      const before = `${b.shown}%`
      b.shown += gap > 0 ? step : -step
      const after = `${b.shown}%`
      b.flash = { from: firstDiff(before, after), until: m.tick + FLASH_FRAMES, dir: gap > 0 ? 'up' : 'down' }
    }
    const o = b.tokens
    if (o.target !== null && o.shown !== o.target) {
      const unit = o.target < 1000 ? 1 : o.target < 1_000_000 ? 1000 : 100_000
      const gap = o.target - o.shown
      const step = Math.min(Math.abs(gap), Math.max(unit, Math.ceil(Math.abs(gap) / 4)))
      const before = tokenText(o)
      o.shown += Math.sign(gap) * step
      const after = tokenText(o)
      if (before !== after) {
        o.flash = { from: firstDiff(before, after), until: m.tick + FLASH_FRAMES, dir: gap > 0 ? 'up' : 'down' }
      }
    }
  }
}

function drainEnd(d: NonNullable<BarAnim['drain']>): number {
  return d.sparkle ? d.start + SPARK_STRIDE * (d.from - d.to - 1) + 4 : d.start + DRAIN_FRAMES
}

/** True while something still moves in this agent's bar: a figure rolling, an effect before its end, or its fade; false for an agent with no bar (it creates none). */
export function isBarActive(m: MotionState, id: string): boolean {
  const b = m.bars.get(id)
  if (b === undefined) return false
  const t = m.tick
  if (b.target !== null && b.shown !== b.target) return true
  if (b.tokens.target !== null && b.tokens.shown !== b.tokens.target) return true
  if (b.glint !== null && t < b.glint.start + GLINT_FRAMES * b.glint.passes) return true
  if (b.grow !== null && t < b.grow.start + GROW_FRAMES) return true
  if (b.color !== null && t < b.color.start + COLOR_FRAMES) return true
  if (b.drain !== null && t < drainEnd(b.drain)) return true
  if (b.pulse !== null && t < b.pulse.start + PULSE_LENGTH * PULSE_COUNT) return true
  if (b.badge !== null && t < b.badge.start + BADGE_FRAMES) return true
  if (b.flash !== null && t < b.flash.until) return true
  if (b.tokens.flash !== null && t < b.tokens.flash.until) return true
  if (b.fade !== null && t < b.fade.start + FADE_FRAMES) return true

  return false
}

/** True while anything is still moving: a figure rolling, an effect before its end, a fade, a tool flash or a done mark. */
export function isActive(m: MotionState): boolean {
  const t = m.tick
  for (const id of m.bars.keys()) if (isBarActive(m, id)) return true
  for (const r of m.rows.values()) {
    if (r.tool !== null && t < r.tool.start + TOOL_FRAMES) return true
    if (r.doneStart !== null && t < r.doneStart + FADE_FRAMES) return true
  }

  return false
}

/** The frame timer's period: every frame while an effect plays, every `IDLE_FRAME_MS` while only the spinner and the time move. */
export function frameMsFor(m: MotionState): number {
  return isActive(m) ? FRAME_MS : IDLE_FRAME_MS
}

/** A row that finished: its bar takes its final figures, drops every effect and fades to gray. */
export function startFade(m: MotionState, id: string): void {
  const b = m.bars.get(id)
  if (b === undefined || b.fade !== null) return
  b.shown = b.target ?? b.shown
  b.tokens.shown = b.tokens.target ?? b.tokens.shown
  b.flash = null
  b.tokens.flash = null
  b.grow = null
  b.color = null
  b.glint = null
  b.drain = null
  b.pulse = null
  b.badge = null
  b.fade = { start: m.tick }
}

/** The frame of one bar at `m.tick`: the bar cells, a space and the percent, then the tokens and the badge when one shows. */
export function composeBar(m: MotionState, id: string, pref: BarPref, level: 'lively' | 'subtle'): Cell[] {
  const b = barOf(m, id)
  const L = LEVELS[level]
  const t = m.tick
  const target = b.target ?? b.shown

  // 1. The drawing.
  const growing = growAt(b, t)
  const p = growing ?? target
  const list = slots(growing === null ? drawBar(pref, p) : drawMoving(pref, p))
  const fillColor = colorAt(b, t) ?? toneColor(target)
  const track = trackColorOf(pref)
  const cells: Cell[] = list.map(s => ({
    cp: s.cp,
    fg: s.kind === 'fill' ? fillColor : s.kind === 'track' ? track : TRACK,
    bg: DEFAULT,
  }))
  const width = list.filter(s => s.i >= 0).length

  // 2. The drain of the cells a fall emptied.
  const drain = b.drain
  if (drain !== null && t < drainEnd(drain)) {
    const elapsed = t - drain.start
    list.forEach((s, n) => {
      const cell = cells[n]!
      if (s.kind !== 'track' || s.i < drain.to || s.i >= drain.from) return
      const old = drain.oldCps[s.i] ?? s.cp
      if (!drain.sparkle) {
        if (elapsed >= DRAIN_FRAMES) return
        cell.cp = old
        cell.fg = mixColor(drain.oldColor, track, ease(elapsed, DRAIN_FRAMES))
        return
      }
      const k = drain.from - 1 - s.i
      const sp = elapsed - SPARK_STRIDE * k
      if (sp < 0) {
        cell.cp = old
        cell.fg = drain.oldColor
      } else if (sp < 2) {
        cell.cp = SPARK_FULL
        cell.fg = GLINT_DOWN
      } else if (sp < 4) {
        cell.cp = SPARK_HOLLOW
        cell.fg = mixColor(GLINT_DOWN, track, 0.5)
      }
    })
  }

  // 3. The pulse.
  let figureLift = 0
  const pulse = b.pulse
  if (pulse !== null && t < pulse.start + PULSE_LENGTH * PULSE_COUNT) {
    const a = PULSE_PROFILE[(t - pulse.start) % PULSE_LENGTH] ?? 0
    figureLift = a * L.pulse
    list.forEach((s, n) => {
      if (s.kind === 'fill') cells[n]!.fg = lighten(cells[n]!.fg, figureLift)
    })
  }

  // 4. The glint.
  const glint = b.glint
  if (glint !== null && t < glint.start + GLINT_FRAMES * glint.passes && width > 0) {
    const elapsed = t - glint.start
    const f = elapsed % GLINT_FRAMES
    const q = f / (GLINT_FRAMES - 1)
    const isLastPass = Math.floor(elapsed / GLINT_FRAMES) === glint.passes - 1
    const sweep = (amount: number, at: number, i: number): number => {
      const gap = Math.abs(i - at)

      return gap === 0 ? amount : gap === 1 ? amount / 2 : 0
    }
    if (glint.dir === 'up') {
      const head = Math.round(-1 + q * (glint.fill + 1))
      list.forEach((s, n) => {
        if (s.kind !== 'fill' || s.i >= glint.fill) return
        let amount = sweep(L.glint, head, s.i)
        if (isLastPass && f >= GLINT_FRAMES - 4 && s.i === glint.fill - 1) amount = Math.max(amount, L.glint)
        if (amount > 0) cells[n]!.fg = mixColor(cells[n]!.fg, GLINT_UP, amount)
      })
    } else {
      const head = Math.round(width - q * (width + 1))
      list.forEach((s, n) => {
        if (s.i < 0) return
        const amount = sweep(L.glint, head, s.i)
        if (amount > 0) cells[n]!.fg = mixColor(cells[n]!.fg, GLINT_DOWN, amount)
      })
    }
  }

  const out: Cell[] = cells
  const isBare = styleOf(pref.style).id === 'none'
  if (!isBare) out.push({ cp: 0x20, fg: DEFAULT, bg: DEFAULT })

  // 5. The percent figure.
  const figureFg = lighten(fillColor, figureLift)
  const figure = textCells(`${b.shown}%`, figureFg)
  const flash = b.flash
  if (flash !== null && t < flash.until) {
    const color = flash.dir === 'up' ? GLINT_UP : GLINT_DOWN
    figure.forEach((cell, i) => {
      if (i >= flash.from) cell.fg = mixColor(cell.fg, color, L.flashMix)
    })
  }
  out.push(...figure)

  // 6. The token figure, an odometer: ` · ` then the tokens, changed digits flashing.
  out.push(...textCells(' · ', PLAIN))
  const tokens = textCells(tokenText(b.tokens), PLAIN)
  const tokenFlash = b.tokens.flash
  if (tokenFlash !== null && t < tokenFlash.until) {
    const color = tokenFlash.dir === 'up' ? GLINT_UP : GLINT_DOWN
    tokens.forEach((cell, i) => {
      if (i >= tokenFlash.from) cell.fg = mixColor(cell.fg, color, L.flashMix)
    })
  }
  out.push(...tokens)

  // 7. The compaction badge.
  const badge = b.badge
  if (badge !== null && t < badge.start + BADGE_FRAMES) {
    out.push({ cp: 0x20, fg: DEFAULT, bg: DEFAULT })
    out.push(...textCells(badge.text, L.badgeColored ? GLINT_DOWN : PLAIN))
  }

  // 8. A finished row's fade to gray.
  const fade = b.fade
  if (fade !== null) {
    const k = ease(t - fade.start, FADE_FRAMES)
    out.forEach(cell => {
      if (cell.fg !== DEFAULT) cell.fg = mixColor(cell.fg, TRACK, k)
    })
  }

  return out
}
