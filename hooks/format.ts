// A subagent's row under the hint line, as colored segments in claudepeeker's colors.

import type { AgentStat, BarPref } from '../types'
import { drawBar, styleOf } from './styles'

// claudepeeker's amber and cyan, muted (xterm 179 and 73): the same hues, a step below its line.
export const GOLD = '#d7af5f'
export const TEAL = '#5fafaf'
export const RED = '#ff0000'
export const GRAY = '#585858'

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

/**
 * `Sonnet 5.5 ·low · Plan · ctx (200K) ▰▰▱▱▱ 38%`: the model, the agent's type,
 * and the context part once a response has come.
 */
export function lineSegments(stat: AgentStat, type: string, window: number, bar: BarPref): Segment[] {
  const out = [...modelSegments(stat.model, stat.effort), { text: ' · ' }, { text: type }]
  if (stat.tokens === null) return out
  const percent = Math.min(100, Math.round((stat.tokens * 100) / window))

  return [
    ...out,
    { text: ' · ctx ' },
    { text: `(${formatTokens(window)})`, color: GRAY },
    { text: ' ' },
    ...barSegments(bar, percent),
  ]
}
