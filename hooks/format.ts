// A subagent's row under the hint line, as colored segments in claudepeeker's colors.

import type { AgentStatus } from 'claude-code'

import type { AgentStat, BarPref } from '../types'
import { drawBar, styleOf } from './styles'

// claudepeeker's amber and cyan, muted (xterm 179 and 73): the same hues, a step below its line.
export const GOLD = '#d7af5f'
export const TEAL = '#5fafaf'
export const RED = '#ff0000'
export const GRAY = '#585858'
/** The running subagent's lavender (the claudeticker one): the Text twin of cells `LIVE`. */
export const LAVENDER = '#afafd7'

export type Tone = 'ok' | 'warn' | 'hot'
export const TONES: Record<Tone, string> = { ok: '#5fff00', warn: '#ffd700', hot: RED }

/** The window a model takes when nothing says otherwise. */
export const DEFAULT_WINDOW = 200_000

/** Plain text, neither colored nor bold, draws dim. */
export type Segment = { text: string; color?: string; bold?: boolean }

export function tone(percent: number): Tone {
  if (percent >= 80) return 'hot'
  if (percent >= 50) return 'warn'

  return 'ok'
}

const bare = (model: string) => model.replace(/\[[^\]]*\]$/, '').trim()

/** `claude-<family>-<major>[-<minor>][-<date>]`, with any `[...]` taken off. */
const MODEL_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i

/** `claude-opus-5-5[1m]` -> `Opus 5.5`; a name already shown as a display name passes through. */
export function modelLabel(model: string): string {
  const id = MODEL_ID.exec(bare(model))
  if (!id) return bare(model) || 'unknown'
  const family = id[1]!.charAt(0).toUpperCase() + id[1]!.slice(1).toLowerCase()

  return id[3] ? `${family} ${id[2]}.${id[3]}` : `${family} ${id[2]}`
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const whole = Math.floor(n / 1_000_000)
    const frac = Math.floor((n % 1_000_000) / 100_000)
    return frac === 0 ? `${whole}M` : `${whole}.${frac}M`
  }
  if (n >= 1000) return `${Math.floor(n / 1000)}K`

  return String(n)
}

/** The window a `[1m]` id, or a model in `ONE_M_FAMILIES`, takes. */
export const ONE_M_WINDOW = 1_000_000

/** The model families whose window is 1M with no `[1m]` on the id. */
const ONE_M_FAMILIES = new Set(['opus', 'fable', 'sonnet', 'haiku'])

function knownOneM(model: string): boolean {
  const family = MODEL_ID.exec(bare(model))?.[1]?.toLowerCase()

  return family !== undefined && ONE_M_FAMILIES.has(family)
}

/**
 * A subagent's context window, which the API gives for the main model alone:
 * 1M for a `[1m]` id, the main session's for the main model, 1M for a model
 * known to take it, else the default. Tokens past the window it settled on
 * mean the window is larger: 1M.
 */
export function windowFor(model: string, main: { model: string; window: number }, tokens: number | null = null): number {
  const window = /\[1m\]$/i.test(model)
    ? ONE_M_WINDOW
    : main.window > 0 && bare(model) === bare(main.model)
      ? main.window
      : knownOneM(model)
        ? ONE_M_WINDOW
        : DEFAULT_WINDOW

  return tokens !== null && tokens > window ? Math.max(window, ONE_M_WINDOW) : window
}

function effortLabel(effort: AgentStat['effort']): string | null {
  if (effort === null) return null

  return typeof effort === 'number' ? `${formatTokens(effort)} think` : effort
}

/** `Sonnet 5.5 ·low`, in muted claudepeeker colors, not bold: below the main session's model. */
export function modelSegments(model: string, effort: AgentStat['effort']): Segment[] {
  const out: Segment[] = [{ text: modelLabel(model), color: GOLD }]
  const label = effortLabel(effort)
  if (label) out.push({ text: ` ·${label}`, color: TEAL })

  return out
}

export function barSegments(bar: BarPref, percent: number): Segment[] {
  const col = TONES[tone(percent)]
  const figure = { text: `${percent}%`, color: col }
  if (styleOf(bar.style).id === 'none') return [figure]
  const cells = drawBar(bar, percent).map(part => ({ text: part.text, color: part.kind === 'fill' ? col : GRAY }))

  return [...cells, { text: ' ' }, figure]
}

/** The context percent of a token count in a window, capped at 100. */
export function ctxPercent(tokens: number, window: number): number {
  return Math.min(100, Math.round((tokens * 100) / window))
}

/**
 * `Sonnet 5.5 ·low · Plan · ctx (200K) `: the model, the agent's type, and the
 * start of the context part once a response has come (the bar follows it).
 * Before any request says the model: the type and `starting…`.
 */
export function labelSegments(stat: AgentStat | undefined, type: string, window: number): Segment[] {
  if (stat === undefined) return [{ text: type }, { text: ' · starting…' }]
  const out: Segment[] = [...modelSegments(stat.model, stat.effort), { text: ' · ' }, { text: type }]
  if (stat.tokens === null) return out

  return [...out, { text: ' · ctx ' }, { text: `(${formatTokens(window)})`, color: GRAY }, { text: ' ' }]
}

/**
 * `Sonnet 5.5 ·low · Plan · ctx (200K) ▰▰▱▱▱ 38%`: the model, the agent's type,
 * and the context part once a response has come.
 */
export function lineSegments(stat: AgentStat, type: string, window: number, bar: BarPref): Segment[] {
  const label = labelSegments(stat, type, window)
  if (stat.tokens === null) return label

  return [...label, ...barSegments(bar, ctxPercent(stat.tokens, window))]
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** `42s`, `1m12s`, `1h02m`: the time since a subagent spawned. */
export function formatElapsed(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${pad2(s % 60)}s`

  return `${Math.floor(s / 3600)}h${pad2(Math.floor((s % 3600) / 60))}m`
}

/** A tool's short name for the flash: the part after the last `__` (MCP tools), cut to 10 code points. */
export function shortTool(name: string): string {
  const at = name.lastIndexOf('__')
  const tail = at >= 0 ? name.slice(at + 2) : name
  const short = Array.from(tail).slice(0, 10).join('')

  return short === '' ? 'tool' : short
}

export type FinishWord = 'done' | 'stopped' | 'failed'

/** How a turn that ended reads: answered is done, interrupted is stopped, anything else failed. */
export function wordForReason(reason: string): FinishWord {
  if (reason === 'answer') return 'done'

  return reason === 'aborted' ? 'stopped' : 'failed'
}

/** How a subagent that left the live states reads. */
export function wordForStatus(status: AgentStatus): FinishWord {
  if (status === 'killed') return 'stopped'

  return status === 'failed' ? 'failed' : 'done'
}

/** ` ✦ done · 42s`: the mark that replaces the elapsed time of a finished row. */
export function doneText(word: FinishWord, durationMs: number): string {
  return ` ${word === 'done' ? '✦' : '✗'} ${word} · ${formatElapsed(durationMs)}`
}

/** The toast when a subagent ends: its type, how it ended, how long, and its last context size. */
export function finishToast(type: string, word: FinishWord, durationMs: number, tokens: number | null): string {
  return `Claude-Spotter: ${type} ${word} · ${formatElapsed(durationMs)}${tokens === null ? '' : ` · ${formatTokens(tokens)}`}`
}

export type DotState = 'pending' | 'running' | 'waiting' | 'done'

/** The state dot of a row as plain text: lavender while the subagent lives, gray once it is done. */
export function dotSegment(state: DotState): Segment {
  if (state === 'done') return { text: '●', color: GRAY }

  return { text: state === 'pending' ? '◌' : state === 'waiting' ? '◐' : '●', color: LAVENDER }
}

/** What the plain row (no Raster) shows for one subagent. */
export type PlainRow = {
  dot: DotState
  stat: AgentStat | undefined
  type: string
  window: number
  bar: BarPref
  elapsedMs: number
  finish: { word: FinishWord; durationMs: number } | null
}

/** The plain row: the dot, the label and bar, the context tokens, then the elapsed time or the finish mark. */
export function plainRowSegments(row: PlainRow): Segment[] {
  const { stat } = row
  const out: Segment[] = [
    dotSegment(row.dot),
    { text: ' ' },
    ...(stat ? lineSegments(stat, row.type, row.window, row.bar) : labelSegments(undefined, row.type, row.window)),
  ]
  if (stat?.tokens != null) out.push({ text: ' · ' }, { text: formatTokens(stat.tokens) })
  out.push(
    row.finish ? { text: doneText(row.finish.word, row.finish.durationMs) } : { text: ` · ${formatElapsed(row.elapsedMs)}` },
  )

  return out
}
