// The /spotter demo: made-up subagents for a 20-second tour of the row effects.

import { FINISH_MS } from './motion'

/** The demo clock's step, in milliseconds. */
export const DEMO_TICK_MS = 250
/** The demo's length, in milliseconds. */
export const DEMO_END_MS = 20_000
/** The context window of every made-up subagent. */
export const DEMO_WINDOW = 1_000_000

export type DemoStatus = 'pending' | 'running' | 'waiting' | 'completed'

/** One moment of a made-up subagent: what changes at `at` (ms from the start). */
export type DemoStep = { at: number; status?: DemoStatus; percent?: number; tool?: string }

/** A made-up subagent; its first step is when its row appears. */
export type DemoAgent = { id: string; type: string; model: string; effort: string; steps: readonly DemoStep[] }

export const DEMO_AGENTS: readonly DemoAgent[] = [
  {
    id: 'demo-explore',
    type: 'Explore',
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    steps: [
      { at: 0, status: 'pending' },
      { at: 1000, status: 'running', percent: 6 }, // the first response: the bar enters
      { at: 2500, tool: 'Grep' },
      { at: 4000, percent: 14 },
      { at: 5000, tool: 'Read' },
      { at: 6500, percent: 55 }, // past 50%: a pulse
      { at: 8000, tool: 'Glob' },
      { at: 9500, percent: 84 }, // past 80%: a hot pulse, the dot goes red
      { at: 11500, percent: 44 }, // a compaction, ↻ −40%
      { at: 13500, percent: 57 },
      { at: 14500, tool: 'Read' },
      { at: 16500, status: 'completed' }, // not lean: lavender done
    ],
  },
  {
    id: 'demo-plan',
    type: 'Plan',
    model: 'claude-opus-5-5',
    effort: 'high',
    steps: [
      { at: 3000, status: 'pending' },
      { at: 4000, status: 'running', percent: 9 },
      { at: 5000, tool: 'Glob' },
      { at: 7500, status: 'waiting' },
      { at: 10000, status: 'running', percent: 22 },
      { at: 12000, tool: 'Bash' },
      { at: 14000, percent: 31, tool: 'Edit' },
      { at: 15500, percent: 26 }, // a small fall
      { at: 17500, status: 'completed' }, // lean: green twinkling done
    ],
  },
  {
    id: 'demo-general',
    type: 'general-purpose',
    model: 'claude-haiku-5-5',
    effort: 'low',
    steps: [
      { at: 7500, status: 'pending' },
      { at: 8500, status: 'running', percent: 4 },
      { at: 9000, tool: 'WebFetch' },
      { at: 11000, tool: 'Read' },
      { at: 12000, percent: 7 },
      { at: 13000, status: 'completed' }, // lean, short
    ],
  },
]

/** A made-up subagent as a row reads it; times are offsets from the demo's start. */
export type DemoRow = {
  id: string
  type: string
  model: string
  effort: string
  status: DemoStatus
  /** The context tokens (the percent of the window); null before the first response. */
  tokens: number | null
  startedAt: number
  finishedAt: number | null
}

/** When an agent completes, or null when its script never does. */
function completedAt(agent: DemoAgent): number | null {
  return agent.steps.find(s => s.status === 'completed')?.at ?? null
}

/** The rows at `ms`: each agent whose first step has come, steps folded, in script order; a completed one leaves `FINISH_MS` after it finished. */
export function demoRowsAt(ms: number): DemoRow[] {
  const rows: DemoRow[] = []
  for (const agent of DEMO_AGENTS) {
    const first = agent.steps[0]
    if (first === undefined || first.at > ms) continue
    let status: DemoStatus = 'pending'
    let percent: number | null = null
    let finishedAt: number | null = null
    for (const step of agent.steps) {
      if (step.at > ms) break
      if (step.status !== undefined) status = step.status
      if (step.percent !== undefined) percent = step.percent
      if (step.status === 'completed') finishedAt = step.at
    }
    if (finishedAt !== null && ms >= finishedAt + FINISH_MS) continue
    rows.push({
      id: agent.id,
      type: agent.type,
      model: agent.model,
      effort: agent.effort,
      status,
      tokens: percent === null ? null : (percent * DEMO_WINDOW) / 100,
      startedAt: first.at,
      finishedAt,
    })
  }

  return rows
}

/** The tool calls the script makes at exactly `ms`. */
export function demoToolsAt(ms: number): { id: string; tool: string }[] {
  const out: { id: string; tool: string }[] = []
  for (const agent of DEMO_AGENTS) {
    for (const step of agent.steps) {
      if (step.at === ms && step.tool !== undefined) out.push({ id: agent.id, tool: step.tool })
    }
  }

  return out
}

/** True when the rows change at exactly `ms`: a status or a percent steps, or a finished row leaves. */
export function isDemoChangeAt(ms: number): boolean {
  return DEMO_AGENTS.some(
    agent =>
      agent.steps.some(s => s.at === ms && (s.status !== undefined || s.percent !== undefined)) ||
      (completedAt(agent) !== null && completedAt(agent)! + FINISH_MS === ms),
  )
}
