import { atom, read, update } from 'claude-code'
import type { AgentStatus, Elements, EngineInterface, Register } from 'claude-code'

import type { AgentStat, BarPref } from '../types'
import { barSegments, lineSegments, modelLabel, windowFor } from './format'
import type { Segment } from './format'
import { DEFAULT_BAR, STYLES, WIDTHS, normalizeBar, styleOf } from './styles'

const PANE = 'spotter-bar'
const STORE_KEY = 'bar'
/** The fills the panel previews the bar at: one per tone. */
const PREVIEWS = [25, 60, 90]
/** The agent states the hint line lists: started and not yet ended. */
const LIVE: readonly AgentStatus[] = ['pending', 'running', 'waiting']
/** How long after the spawn the toast waits, so the subagent's first request has told its effort. */
const TOAST_DELAY_MS = 1500

const spawns = atom({ plugin: 'claudespotter', key: 'spawns' } as const, {})
const stats = atom({ plugin: 'claudespotter', key: 'stats' } as const, {})
const bar = atom({ plugin: 'claudespotter', key: 'bar' } as const, DEFAULT_BAR)

async function saveBar($: EngineInterface, change: (b: BarPref) => BarPref): Promise<void> {
  await update($, bar, change)
  await $.store.set(STORE_KEY, await read($, bar))
}

/** The item `by` steps from `at`, wrapping round the list. */
function cycle<T>(list: readonly T[], at: T, by: 1 | -1): T {
  const i = list.indexOf(at)

  return list[(i + by + list.length) % list.length] ?? at
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const stored = await $.store.get(STORE_KEY)
    if (stored !== undefined) await update($, bar, () => normalizeBar(stored))
    await $.command.register({
      name: 'spotter',
      description: "Pick the style and width of the subagents' context bar",
    })

    return next(e)
  })

  // Ties the Agent call to the subagent it started, for the model it resolved
  // until its first request says, and announces it. The toast is raised from the main session's side, on a timer:
  // one raised from inside the subagent's own requests is not shown.
  // Observes only: a failure here lets the spawn go on as it was settled.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    const agentId = result.agentId
    if (e.workflow || 'deny' in result || agentId === undefined) return result
    await update($, spawns, all => ({
      ...all,
      [e.tool_use_id]: { agentId, type: e.subagentType, model: result.model },
    }))
    const type = e.subagentType
    $.clock.after(TOAST_DELAY_MS, async () => {
      const stat = (await read($, stats))[agentId]
      const effort = stat?.effort ?? null
      $.ui.toast(`Claude-Spotter: ${type} → ${modelLabel(stat?.model ?? result.model)}${effort === null ? '' : ` ·${effort}`}`)
    })

    return result
  }).catch(($, e, next) => next(e))

  // Each request a subagent sends: what it runs on going down, its context coming back.
  on('turn.step', async function* ($, e, next) {
    const agentId = e.agentId
    if (agentId === undefined) return yield* next(e)
    const effort = e.effort ?? null
    await update($, stats, all => ({
      ...all,
      [agentId]: { model: e.model, effort, tokens: all[agentId]?.tokens ?? null },
    }))
    const result = yield* next(e)
    const usage = result.usage
    if (usage) {
      const tokens = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
      await update($, stats, all => {
        const one = all[agentId]
        return one ? { ...all, [agentId]: { ...one, tokens } } : all
      })
    }

    return result
  })

  // A subagent that ends changes no state the hint line reads: redraw it.
  on('turn.complete', ($, e, next) => {
    if (e.agentId !== undefined) $.ui.invalidate('ui.render')

    return next(e)
  })

  // The hint line under the prompt, kept as what is drawn beneath (the engine's
  // line, and claudepeeker's when it sits beneath), with a titled row per live
  // subagent last: the nearest a mod draws to the footer's agent list. No padding:
  // the hint slot is indented already.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const [agents, all, spawned, pref, usage, mainModel] = await Promise.all([
      $.agent.list(),
      read($, stats),
      read($, spawns),
      read($, bar),
      $.session.usage(),
      $.session.model(),
    ])
    const live = agents.filter(a => LIVE.includes(a.status) && !a.teammateId)
    if (live.length === 0) return next(e)
    const drawn = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const rows = live.map((agent, i) => {
      const model = Object.values(spawned).find(s => s.agentId === agent.id)?.model
      const stat: AgentStat | undefined = all[agent.id] ?? (model ? { model, effort: null, tokens: null } : undefined)
      const figures = stat
        ? lineSegments(stat, agent.type, windowFor(stat.model, { model: mainModel, window: usage.context.window }), pref)
        : [{ text: agent.type }, { text: ' · starting…' }]
      // A tree under the title: `├` for each row but the last, `└` for the last.
      const branch = i === live.length - 1 ? ' └ ' : ' ├ '

      return (
        <Box flexDirection="row">
          <Text wrap="truncate-end">
            <Text dimColor>{branch}</Text>
            {run(Text, figures)}
          </Text>
        </Box>
      )
    })

    return (
      <Box flexDirection="column">
        {drawn}
        <Box flexDirection="row">
          <Text dimColor bold>
            subagents
          </Text>
        </Box>
        {rows}
      </Box>
    )
  })

  on('command.run', { command: 'spotter' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Subagent ctx bar', focus: true, closeOnEscape: true })

    return { text: 'Opened the subagent bar panel.' }
  })

  // The panel: the bar at each tone, and ‹ › arrows stepping its style and width.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const pref = await read($, bar)
    const style = styleOf(pref.style)
    const stepper = (key: string, value: string, step: (by: 1 | -1) => void, isOff = false) => (
      <Box flexDirection="row" flexShrink={0}>
        <Button key={`${key}-prev`} plain dimColor={isOff} onPress={() => step(-1)}>
          ‹
        </Button>
        <Text dimColor={isOff}> {value} </Text>
        <Button key={`${key}-next`} plain dimColor={isOff} onPress={() => step(1)}>
          ›
        </Button>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" flexWrap="wrap" columnGap={3} marginBottom={1}>
          {PREVIEWS.map(percent => run(Text, [{ text: 'ctx ' }, ...barSegments(pref, percent)]))}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {stepper('style', style.name, by => saveBar($, old => ({ ...old, style: cycle(STYLES, style, by).id })))}
          {stepper(
            'width',
            style.isGlyph ? '1 cell' : `${pref.width} cells`,
            by => saveBar($, old => ({ ...old, width: cycle(WIDTHS, old.width, by) })),
            style.isGlyph,
          )}
        </Box>
        <Box flexDirection="row" marginTop={1} columnGap={1}>
          <Button key="reset" onPress={() => saveBar($, () => DEFAULT_BAR)}>
            Reset
          </Button>
          <Button key="close" role="dismiss" onPress={() => $.ui.close({ id: PANE })}>
            Close
          </Button>
        </Box>
        <Text dimColor>Click ‹ › to change the bar.</Text>
      </Box>
    )
  })
}

/** One flow of nested Text: plain text dim, as claudepeeker draws it; bold text bright. */
function run(Text: Elements['terminal']['Text'], segments: Segment[]) {
  return (
    <Text>
      {segments.map(s => (
        <Text color={s.color} dimColor={s.color === undefined && !s.bold} bold={s.bold}>
          {s.text}
        </Text>
      ))}
    </Text>
  )
}
