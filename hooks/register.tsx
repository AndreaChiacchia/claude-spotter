import { atom, read, update } from 'claude-code'
import type { AgentStatus, Elements, EngineInterface, Register, RenderNode, Timer } from 'claude-code'

import type { AgentStat, Motion } from '../types'
import { encodeCells } from './cells'
import type { Cell } from './cells'
import { DEMO_END_MS, DEMO_TICK_MS, DEMO_WINDOW, demoRowsAt, demoToolsAt, isDemoChangeAt } from './demo'
import {
  DEFAULT_WINDOW,
  ctxPercent,
  finishToast,
  formatElapsed,
  labelSegments,
  modelLabel,
  plainRowSegments,
  tone,
  windowFor,
  wordForReason,
  wordForStatus,
} from './format'
import type { DotState, FinishWord, Segment } from './format'
import {
  FINISH_MS,
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
  pruneMotion,
  startFade,
} from './motion'
import type { MotionState } from './motion'
import { composeDot, composeTail, flashTool, markDone, tailWidth, toolSlot } from './row'
import { DEFAULT_SETTINGS, normalizeSettings } from './styles'
import type { Settings } from './styles'

/** The agent states the hint line lists: started and not yet ended. */
const LIVE: readonly AgentStatus[] = ['pending', 'running', 'waiting']
/** How long after the spawn the toast waits, so the subagent's first request has told its effort. */
const TOAST_DELAY_MS = 1500
/** How long after a subagent ends its finish toast waits, so it is not raised from inside the subagent's loop. */
const FINISH_TOAST_DELAY_MS = 100
/** The plain rows redraw this often while a subagent lives, so the elapsed time ticks. */
const ELAPSED_TICK_MS = 1000
/** The Raster keys are this prefix, the part and the agent id; never claudepeeker's or claudeticker's. */
const RASTER_PREFIX = 'spotter-'
/** Fresh draws whose first blit was refused before the rows are drawn still. */
const MAX_REFUSED_MOUNTS = 3
/** Columns the hint slot is indented by. */
const HINT_INDENT = 2
/** The width assumed when the surface has not measured. */
const DEFAULT_COLUMNS = 80

const spawns = atom({ plugin: 'claudespotter', key: 'spawns' } as const, {})
const stats = atom({ plugin: 'claudespotter', key: 'stats' } as const, {})

/** The /config settings, read in `register`: a module variable, so /clear and /resume keep them; a /config change reloads the module. */
let settings: Settings = DEFAULT_SETTINGS

// State of the running module. It is lost on a reload by design: the next render rebuilds it.
// `register` resets it, so a module instance shared by several loads starts each one clean.
let motion: MotionState = createMotion()
let level: Motion = 'lively'
let timer: Timer | null = null
/** The running frame timer's period. */
let timerMs = FRAME_MS
/** Redraws the plain rows once a second while a subagent lives. */
let stillTimer: Timer | null = null
let isBlitting = false
/** One Raster of a row: its key, which part it is and whose, its width at the render, and its cells at a moment (ms on the demo or the real clock). */
type Piece = { key: string; kind: 'dot' | 'bar' | 'tail'; agentId: string; width: number; compose: (now: number) => Cell[] }
/** The mounted Rasters the timer repaints: the render's request, each piece, the real agents drawn and whether any lives. */
type Site = { requestId: string; pieces: Piece[]; ids: Set<string>; hasLive: boolean }
let site: Site | null = null
/** What each Raster last showed (by key), so an unchanged frame is not sent again. */
const lastBlit = new Map<string, string>()
/** Bars whose effect-free frame a blit for the current drawing was accepted with: until something moves in them again their frame cannot change, so it is not composed. Never set at a draw, cleared by a refusal. */
const settledBars = new Set<string>()
/** Set when a /clear or a resume cut an effect off: the next Raster draw does not take the screen to show the drawing, so each piece is sent once. */
let isResendPending = false
/** Blits accepted since the last render that drew the Rasters. */
let framesSinceMount = 0
/** Fresh draws whose first blit was refused, while no blit has ever been accepted. */
let refusedMounts = 0
let everBlitted = false
/** Set when this slot keeps refusing the first blit: the rows are drawn still from then on. */
let isStaticFallback = false
/** The running `/spotter demo`: counted in its own ticks, so it is deterministic. */
type Demo = { ticks: number; timer: Timer }
let demo: Demo | null = null
/** False until a render has drawn: a bar that appears after that enters with its effects, the first ones are taken silently. */
let primed = false
/** When each live subagent was first listed (ms), for one with no start time on its spawn record. */
const firstSeen = new Map<string, number>()
/** How each subagent that ended ended, and when. */
const ends = new Map<string, { at: number; word: FinishWord; durationMs: number }>()
/** Subagents seen live: only these get a done mark when they leave the live states. */
const seenLive = new Set<string>()
/** Subagents whose exit redraw is already timed. */
const exitScheduled = new Set<string>()

function stopTimer(): void {
  timer?.cancel()
  timer = null
}

function stopStill(): void {
  stillTimer?.cancel()
  stillTimer = null
}

function ensureStill($: EngineInterface): void {
  if (stillTimer === null) stillTimer = $.clock.every(ELAPSED_TICK_MS, () => $.ui.invalidate('ui.render'))
}

/** Forgets what the module knows of the rows (a load, a new session, a demo's start or end). */
function silenceRows(): void {
  motion = createMotion()
  stopTimer()
  site = null
  settledBars.clear()
}

function endDemo($: EngineInterface): void {
  if (demo === null) return
  demo.timer.cancel()
  demo = null
  silenceRows()
  // The real rows come back silently.
  primed = false
  $.ui.invalidate('ui.render')
}

/** A start, a reload, a /clear or a resume: a running demo ends, the rows start over and what appears next is taken silently. */
function forgetRows($: EngineInterface): void {
  endDemo($)
  silenceRows()
  primed = false
  firstSeen.clear()
  ends.clear()
  seenLive.clear()
  exitScheduled.clear()
  $.ui.invalidate('ui.render')
}

function onDemoTick($: EngineInterface): void {
  if (demo === null) return
  demo.ticks += 1
  const ms = demo.ticks * DEMO_TICK_MS
  if (ms >= DEMO_END_MS) {
    endDemo($)

    return
  }
  if (level !== 'off') {
    for (const call of demoToolsAt(ms)) flashTool(motion, call.id, call.tool)
    kick($)
  }
  if (isDemoChangeAt(ms)) $.ui.invalidate('ui.render')
}

/** Starts the demo, or restarts it from the beginning when one runs. */
async function startDemo($: EngineInterface): Promise<void> {
  demo?.timer.cancel()
  demo = { ticks: 0, timer: $.clock.every(DEMO_TICK_MS, () => onDemoTick($)) }
  silenceRows()
  // The demo's rows enter with their effects.
  primed = true
  $.ui.invalidate('ui.render')
}

/** True while there are rows to repaint and something to move in them: a live row, or an effect before its end. */
function needsTimer(): boolean {
  return site !== null && !isStaticFallback && level !== 'off' && (site.hasLive || isActive(motion))
}

/** Starts the frame timer, or changes its period: every frame while an effect plays, every `IDLE_FRAME_MS` while only the spinner and the time move. */
function kick($: EngineInterface): void {
  if (!needsTimer()) return
  const ms = frameMsFor(motion)
  if (timer !== null && timerMs === ms) return
  timer?.cancel()
  timerMs = ms
  timer = $.clock.every(ms, () => void step($))
}

/** One frame: the motion advances and each row's Rasters are repainted in place. */
async function step($: EngineInterface): Promise<void> {
  if (isBlitting || site === null) return
  isBlitting = true
  try {
    const target = site
    if (level === 'off') {
      stopTimer()

      return
    }
    // On the slow period one frame stands for IDLE_FRAME_TICKS ticks; nothing rolls then, so each only moves the tick.
    const ticks = timerMs === IDLE_FRAME_MS ? IDLE_FRAME_TICKS : 1
    for (let i = 0; i < ticks; i++) advance(motion)
    // Only a live row's elapsed time reads the clock; every other piece ignores `now`.
    const now = demo !== null ? demo.ticks * DEMO_TICK_MS : target.hasLive ? await $.clock.now() : 0
    // A render replaced the site while the clock was read: its own mount is the newer frame; the timer goes on.
    if (site !== target) return
    for (const piece of target.pieces) {
      if (piece.kind === 'bar' && settledBars.has(piece.key) && !isBarActive(motion, piece.agentId)) continue
      const cells = piece.compose(now)
      if (cells.length !== piece.width) {
        // A width change (9% to 10%, a badge appearing or leaving, 9s to 10s) is a redraw, never a blit.
        stopTimer()
        $.ui.invalidate('ui.render')

        return
      }
      const encoded = encodeCells(cells)
      if (encoded === lastBlit.get(piece.key)) continue
      const r = await $.ui.blit({ requestId: target.requestId, key: piece.key, cells: encoded })
      if (r.deny === undefined) {
        everBlitted = true
        framesSinceMount += 1
        lastBlit.set(piece.key, encoded)
        if (piece.kind === 'bar' && site === target && !isBarActive(motion, piece.agentId)) settledBars.add(piece.key)
      } else if (framesSinceMount === 0 && !everBlitted) {
        // The first blit after a fresh draw was refused: this slot may not take blits. A fresh mount retries.
        if (piece.kind === 'bar') settledBars.delete(piece.key)
        refusedMounts += 1
        stopTimer()
        if (refusedMounts >= MAX_REFUSED_MOUNTS) {
          isStaticFallback = true
          site = null
        }
        $.ui.invalidate('ui.render')

        return
      } else {
        // Refused after earlier successes (a dialog, a resize, the prompt hidden): a later render restarts the timer.
        if (piece.kind === 'bar') settledBars.delete(piece.key)
        stopTimer()

        return
      }
      if (site !== target) return
    }
    if (!needsTimer()) stopTimer()
    else kick($)
  } finally {
    isBlitting = false
  }
}

/** One subagent row as the render reads it. */
type RowData = {
  id: string
  type: string
  dot: DotState
  stat: AgentStat | undefined
  window: number
  /** When the subagent started (ms, on the clock the render uses). */
  startAt: number
  finish: { word: FinishWord; durationMs: number; at: number } | null
}

export const register: Register = (on, options) => {
  settings = normalizeSettings(options)
  // A fresh load starts from a clean state.
  stopTimer()
  timerMs = FRAME_MS
  stopStill()
  demo?.timer.cancel()
  demo = null
  motion = createMotion()
  level = settings.motion
  isBlitting = false
  site = null
  lastBlit.clear()
  settledBars.clear()
  isResendPending = false
  framesSinceMount = 0
  refusedMounts = 0
  everBlitted = false
  isStaticFallback = false
  primed = false
  firstSeen.clear()
  ends.clear()
  seenLive.clear()
  exitScheduled.clear()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'spotter',
      description: "Play the subagent rows' motion demo; the settings are in /config",
      argumentHint: '[demo | demo stop]',
    })
    // The old, now unused store keys: dropped (the settings live in /config).
    void $.store.delete('bar').catch(() => undefined)
    void $.store.delete('motion').catch(() => undefined)
    // A start or a reload ends a demo and starts the rows over (a /clear or a resume comes through `session.end`).
    // A module reloaded by a /config change redraws at once.
    forgetRows($)

    return next(e)
  })

  // /clear and /resume fire no `session.start`: the rows see them as the end of the old session.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      const wasMoving = site !== null && everBlitted && isActive(motion)
      forgetRows($)
      isResendPending = wasMoving
    }

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
    const startedAt = await $.clock.now()
    await update($, spawns, all => ({
      ...all,
      [e.tool_use_id]: { agentId, type: e.subagentType, model: result.model, startedAt },
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
    // `update` always writes and redraws the rows: a request on the same model and effort writes nothing before it goes.
    const known = (await read($, stats))[agentId]
    if (known === undefined || known.model !== e.model || known.effort !== effort) {
      await update($, stats, all => ({
        ...all,
        [agentId]: { model: e.model, effort, tokens: all[agentId]?.tokens ?? null },
      }))
    }
    const result = yield* next(e)
    const usage = result.usage
    if (usage) {
      const tokens = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
      const held = (await read($, stats))[agentId]
      if (held !== undefined && held.tokens !== tokens) {
        await update($, stats, all => {
          const one = all[agentId]
          return one ? { ...all, [agentId]: { ...one, tokens } } : all
        })
      }
    }

    return result
  })

  // A subagent that runs again after it ended is a live row again: its end is forgotten, and its bar starts over.
  on('turn.start', ($, e, next) => {
    const id = e.agentId
    if (id !== undefined && ends.has(id)) {
      ends.delete(id)
      exitScheduled.delete(id)
      motion.bars.delete(id)
      motion.rows.delete(id)
      settledBars.clear()
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  // A subagent that ends: its row shows how it ended for a moment, and a toast says so. The row's dot and bar
  // follow in the render, which reads `ends`.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const id = e.agentId
    if (id === undefined) return result
    const now = await $.clock.now()
    const spawn = Object.values(await read($, spawns)).find(s => s.agentId === id)
    const start = spawn?.startedAt ?? firstSeen.get(id) ?? now - e.durationMs
    const word = wordForReason(e.reason)
    const durationMs = Math.max(0, now - start)
    ends.set(id, { at: now, word, durationMs })
    if (spawn !== undefined) {
      const tokens = (await read($, stats))[id]?.tokens ?? null
      // Raised on a timer, as the spawn toast, so it is not raised from inside the subagent's loop.
      $.clock.after(FINISH_TOAST_DELAY_MS, () => $.ui.toast(finishToast(spawn.type, word, durationMs, tokens)))
    }
    $.ui.invalidate('ui.render')

    return result
  }).catch(($, e, next) => next(e))

  // Each tool call of a subagent flashes its name at the end of its row. A pass-through: nothing awaited before `next`, `e` untouched.
  on('tool.call', ($, e, next) => {
    if (e.agentId !== undefined && level !== 'off' && demo === null && site?.ids.has(e.agentId)) {
      flashTool(motion, e.agentId, e.tool)
      kick($)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // The hint line under the prompt, kept as what is drawn beneath (the engine's
  // line, and claudepeeker's when it sits beneath), with a titled row per live
  // subagent last: the nearest a mod draws to the footer's agent list. No padding:
  // the hint slot is indented already.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const [agents, all, spawned, usage, mainModel, clockNow] = await Promise.all([
      $.agent.list(),
      read($, stats),
      read($, spawns),
      $.session.usage(),
      $.session.model(),
      $.clock.now(),
    ])
    const pref = settings.bar
    level = settings.motion
    // The module's memory follows the agents the engine lists.
    const listed = new Set(agents.map(a => a.id))
    for (const id of [...firstSeen.keys()]) if (!listed.has(id)) firstSeen.delete(id)
    for (const id of [...ends.keys()]) if (!listed.has(id)) ends.delete(id)
    for (const id of [...seenLive]) if (!listed.has(id)) seenLive.delete(id)
    for (const id of [...exitScheduled]) if (!listed.has(id)) exitScheduled.delete(id)

    // The rows: a running demo's made-up subagents, else the real ones in list order.
    let now = clockNow
    const data: RowData[] = []
    if (demo !== null) {
      now = demo.ticks * DEMO_TICK_MS
      for (const r of demoRowsAt(now)) {
        data.push({
          id: r.id,
          type: r.type,
          dot: r.status === 'completed' ? 'done' : r.status,
          stat: { model: r.model, effort: r.effort, tokens: r.tokens },
          window: DEMO_WINDOW,
          startAt: r.startedAt,
          finish:
            r.finishedAt === null ? null : { word: 'done', durationMs: r.finishedAt - r.startedAt, at: r.finishedAt },
        })
      }
    } else {
      for (const agent of agents) {
        if (agent.teammateId) continue
        const id = agent.id
        const spawn = Object.values(spawned).find(s => s.agentId === id)
        const startOf = (): number | undefined => spawn?.startedAt ?? firstSeen.get(id)
        let end = ends.get(id)
        let dot: DotState
        let finish: RowData['finish'] = null
        if (LIVE.includes(agent.status) && end === undefined) {
          seenLive.add(id)
          if (!firstSeen.has(id)) firstSeen.set(id, now)
          dot = agent.status === 'pending' ? 'pending' : agent.status === 'waiting' ? 'waiting' : 'running'
        } else {
          if (end === undefined && seenLive.has(id)) {
            end = { at: now, word: wordForStatus(agent.status), durationMs: now - (startOf() ?? now) }
            ends.set(id, end)
          }
          if (end === undefined || now - end.at >= FINISH_MS) continue
          dot = 'done'
          finish = end
          if (!exitScheduled.has(id)) {
            exitScheduled.add(id)
            $.clock.after(Math.max(0, FINISH_MS - (now - end.at)), () => $.ui.invalidate('ui.render'))
          }
        }
        const model = spawn?.model
        const stat: AgentStat | undefined = all[id] ?? (model ? { model, effort: null, tokens: null } : undefined)
        data.push({
          id,
          type: agent.type,
          dot,
          stat,
          window: stat
            ? windowFor(stat.model, { model: mainModel, window: usage.context.window }, stat.tokens)
            : DEFAULT_WINDOW,
          startAt: startOf() ?? now,
          finish,
        })
      }
    }

    if (data.length === 0) {
      stopTimer()
      stopStill()
      site = null
      isResendPending = false
      pruneMotion(motion, new Set())
      primed = true

      return next(e)
    }
    const drawn = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    // Off, a non-terminal surface and a slot that refuses blits read every value silently and draw the plain rows.
    const moving = level !== 'off' && e.surface === 'terminal' && !isStaticFallback ? level : null

    // A changed value starts the bars' effects; a render alone never does.
    for (const r of data) {
      const tokens = r.stat?.tokens
      if (tokens != null) {
        // A subagent that lives again after a finish starts a bar of its own.
        if (r.finish === null && motion.bars.get(r.id)?.fade != null) {
          motion.bars.delete(r.id)
          motion.rows.delete(r.id)
        }
        observe(motion, r.id, { percent: ctxPercent(tokens, r.window), tokens }, pref, moving ?? 'off', primed)
      }
      if (moving !== null && r.finish !== null) {
        startFade(motion, r.id)
        markDone(motion, r.id)
      }
    }
    pruneMotion(motion, new Set(data.map(r => r.id)))

    const title = (
      <Box flexDirection="row">
        <Text dimColor bold>
          subagents
        </Text>
      </Box>
    )
    // A tree under the title: `├` for each row but the last, `└` for the last.
    const branchOf = (i: number) => (i === data.length - 1 ? ' └ ' : ' ├ ')

    let rows: RenderNode[]
    if (moving !== null && e.surface === 'terminal') {
      // Only the terminal surface has a Raster: narrowing `e` here narrows what `resolve` returns.
      const { Raster } = $.ui.resolve(e)
      stopStill()
      const cols = Math.min(512, (e.viewport?.columns ?? DEFAULT_COLUMNS) - HINT_INDENT)
      const pieces: Piece[] = []
      lastBlit.clear()
      settledBars.clear()
      const isResend = isResendPending
      isResendPending = false
      rows = data.map((r, i) => {
        const label: Segment[] = [{ text: ' ' }, ...labelSegments(r.stat, r.type, r.window)]
        const labelWidth = label.reduce((n, s) => n + Array.from(s.text).length, 0)
        const tokens = r.stat?.tokens ?? null
        const percent = tokens === null ? null : ctxPercent(tokens, r.window)
        const dotKey = `${RASTER_PREFIX}dot-${r.id}`
        const barKey = `${RASTER_PREFIX}bar-${r.id}`
        const tailKey = `${RASTER_PREFIX}tail-${r.id}`

        const dotCells = composeDot(motion, r.id, r.dot, moving)
        const dotEncoded = encodeCells(dotCells)
        pieces.push({
          key: dotKey,
          kind: 'dot',
          agentId: r.id,
          width: dotCells.length,
          compose: () => composeDot(motion, r.id, r.dot, moving),
        })
        if (!isResend) lastBlit.set(dotKey, dotEncoded)

        let barWidth = 0
        let barEncoded: string | null = null
        if (tokens !== null) {
          const barCells = composeBar(motion, r.id, pref, moving)
          barWidth = barCells.length
          barEncoded = encodeCells(barCells)
          pieces.push({
            key: barKey,
            kind: 'bar',
            agentId: r.id,
            width: barWidth,
            compose: () => composeBar(motion, r.id, pref, moving),
          })
          if (!isResend) lastBlit.set(barKey, barEncoded)
        }

        const finish = r.finish
        const tail =
          finish !== null
            ? ({
                kind: 'done',
                word: finish.word,
                durationMs: finish.durationMs,
                isLean: percent !== null && tone(percent) === 'ok',
              } as const)
            : ({
                kind: 'live',
                elapsedMs: now - r.startAt,
                slot: toolSlot(cols, 3 + 1 + labelWidth + barWidth + 3 + formatElapsed(now - r.startAt).length),
              } as const)
        const tailCells = composeTail(motion, r.id, tail, moving)
        const tailEncoded = encodeCells(tailCells)
        pieces.push({
          key: tailKey,
          kind: 'tail',
          agentId: r.id,
          width: tailWidth(tail),
          compose: at =>
            composeTail(motion, r.id, tail.kind === 'live' ? { ...tail, elapsedMs: at - r.startAt } : tail, moving),
        })
        if (!isResend) lastBlit.set(tailKey, tailEncoded)

        return (
          <Box flexDirection="row">
            <Text dimColor>{branchOf(i)}</Text>
            <Raster key={dotKey} columns={dotCells.length} rows={1} cells={dotEncoded} />
            <Text wrap="truncate-end">{run(Text, label)}</Text>
            {barEncoded === null ? null : <Raster key={barKey} columns={barWidth} rows={1} cells={barEncoded} />}
            <Raster key={tailKey} columns={tailCells.length} rows={1} cells={tailEncoded} />
          </Box>
        )
      })
      framesSinceMount = 0
      site = {
        requestId: e.requestId,
        pieces,
        ids: new Set(demo === null ? data.map(r => r.id) : []),
        hasLive: data.some(r => r.finish === null),
      }
      kick($)
    } else {
      stopTimer()
      site = null
      isResendPending = false
      rows = data.map((r, i) => (
        <Box flexDirection="row">
          <Text wrap="truncate-end">
            <Text dimColor>{branchOf(i)}</Text>
            {run(
              Text,
              plainRowSegments({
                dot: r.dot,
                stat: r.stat,
                type: r.type,
                window: r.window,
                bar: pref,
                elapsedMs: now - r.startAt,
                finish: r.finish === null ? null : { word: r.finish.word, durationMs: r.finish.durationMs },
              }),
            )}
          </Text>
        </Box>
      ))
      if (data.some(r => r.finish === null)) ensureStill($)
      else stopStill()
    }
    primed = true

    return (
      <Box flexDirection="column">
        {drawn}
        {title}
        {rows}
      </Box>
    )
  })

  on('command.run', { command: 'spotter' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'demo') {
      await startDemo($)
      const isOff = settings.motion === 'off'

      return {
        text:
          'Playing the motion demo for 20 s under the prompt, with made-up subagents. /spotter demo stop ends it.' +
          (isOff ? ' Motion is Off, so the rows change without effects: set Motion to lively or subtle in /config to see them.' : ''),
      }
    }
    if (arg === 'demo stop') {
      if (demo === null) return { text: 'No demo is running.' }
      endDemo($)

      return { text: 'Stopped the demo: the rows show your real subagents again.' }
    }

    return {
      text: "Claude-Spotter's settings are in /config: the bar style and width, and Motion. /spotter demo plays the motion tour.",
    }
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
