import type { AgentStatus, On, TurnStepResult } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { GLINT_UP, LIVE, TRACK, decodeCells, mixColor } from '../hooks/cells'
import type { Cell } from '../hooks/cells'

const HINT = {
  plugin: 'claudespotter',
  surface: 'terminal',
  component: 'PromptHint',
  requestId: 'hint',
  props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' } as never,
  viewport: { columns: 160, rows: 40 } as never,
} as const

const ROW = {
  plugin: 'claudespotter',
  surface: 'terminal',
  component: 'ToolUse',
  props: {
    tool_use_id: 'toolu_1',
    tool: 'Agent',
    input: { description: 'Searching', prompt: 'p', subagent_type: 'Plan' },
    isRunning: true,
    isErrored: false,
    isInterrupted: false,
  } as never,
} as const

/** What the engine draws beneath the mod, for every component. */
const ENGINE = 'esc to interrupt'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

type Blit = { requestId: string; key: string; cells: string; render: number; isAccepted: boolean }

/**
 * The engine beneath the mod: one subagent `a1` on `model`, answering over `tokens` of context.
 * The figures the tests move live in `state`; the blits the mod sends are recorded in `blits`.
 */
function world(on: On, model: string, tokens: number, status: AgentStatus = 'running') {
  const state = {
    status,
    tokens,
    blitAnswer: {} as { deny?: string },
    /** When set and true for a blit's key and cells, that blit is refused (a dialog is up). */
    refuse: null as null | ((key: string, cells: Cell[]) => boolean),
  }
  const toasts: string[] = []
  const blits: Blit[] = []
  /** PromptHint renders so far: a blit belongs to the render whose Rasters it repaints. */
  const renders = { count: 0 }
  const clock = mock.clock(on, { now: 0 })
  // The mod's own key-value store, in memory; the test reads it back through `store`.
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.blit', (_$, e) => {
    const cells = (e as unknown as { cells?: string }).cells ?? ''
    const isRefused = state.refuse !== null && state.refuse(e.key, decodeCells(cells))
    blits.push({
      requestId: e.requestId,
      key: e.key,
      cells,
      render: renders.count,
      isAccepted: !isRefused && state.blitAnswer.deny === undefined,
    })
    return { value: isRefused ? { deny: 'dialog' } : state.blitAnswer }
  })
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }) as never)
  on('command.register', (_$, e) => ({ value: { command: e.name } }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 1_000_000, percent: 0 }, rateLimits: [] } }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('agent.list', () => ({ value: [{ id: 'a1', type: 'Plan', description: 'Searching', status: state.status }] }))
  on('agent.spawn', () => ({ model, agentId: 'a1' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: 'ok' }) as never)
  on('turn.step', async function* (_$, e): AsyncGenerator<never, TurnStepResult> {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        model,
        input_tokens: state.tokens - 1000,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 0,
        output_tokens: 50,
      },
    }
  })
  on('ui.render', ({ ui }, e) => {
    if (e.component === 'PromptHint') renders.count += 1
    const { Text } = ui.resolve(e)
    return <Text>{ENGINE}</Text>
  })

  return { state, toasts, blits, renders, clock, store }
}

type World = ReturnType<typeof world>
/** What `draw` needs of a mounted element. */
type Drawable = { drawn: () => Promise<unknown> }

const cellText = (cells: Cell[]): string => cells.map(c => String.fromCodePoint(c.cp)).join('')

const rasterKey = (n: Node): string => String(n.props?.key ?? (n as { key?: unknown }).key)

const mountedText = (n: Node): string => cellText(decodeCells(String(n.props?.cells ?? '')))

function textOf(node: unknown, raster: (n: Node) => string): string {
  if (typeof node === 'string') return node
  if (node === null || typeof node !== 'object') return ''
  const one = node as Node
  if (one.type === 'Raster') return raster(one)
  return (one.children ?? []).map(child => textOf(child, raster)).join('')
}

/** The drawing as text; a Raster contributes the cells it was mounted with, untrimmed. */
const text = (node: unknown): string => textOf(node, mountedText)

function walk(node: unknown, out: Node[] = []): Node[] {
  if (node === null || typeof node !== 'object') return out
  out.push(node as Node)
  for (const child of (node as Node).children ?? []) walk(child, out)
  return out
}

const rasters = (node: unknown): Node[] => walk(node).filter(n => n.type === 'Raster')

const raster = (drawn: unknown, key: string): Node | undefined => rasters(drawn).find(n => rasterKey(n) === key)

/** The render each drawing came from, so `current` finds the blits that repaint its Rasters. */
const stamps = new WeakMap<object, number>()

async function draw(w: World, ui: Drawable): Promise<unknown> {
  const drawn = await ui.drawn()
  if (drawn !== null && typeof drawn === 'object') stamps.set(drawn, w.renders.count)
  return drawn
}

/**
 * The drawing as the screen shows it by now: each Raster as its last blit since that render painted it, else as
 * mounted, and the trailing blanks trimmed.
 */
function current(w: World, drawn: unknown): string {
  const at = stamps.get(drawn as object)
  return textOf(drawn, n => {
    const key = rasterKey(n)
    const last = w.blits.filter(b => b.key === key && b.render === at).at(-1)
    return last === undefined ? mountedText(n) : cellText(decodeCells(last.cells))
  }).trimEnd()
}

/** What each blit of `key` painted, as text. */
const blitTexts = (w: World, key: string): string[] => w.blits.filter(b => b.key === key).map(b => cellText(decodeCells(b.cells)))

const spawn = ($: Engine) =>
  $.agent.spawn({
    tool_use_id: 'toolu_1',
    prompt: 'p',
    description: 'Searching',
    subagentType: 'Plan',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5[1m]',
    background: false,
    fork: false,
  } as never)

async function step($: Engine, model: string, effort: 'low' | 'high') {
  const stream = $.turn.step({ turnId: 't1', index: 0, model, effort, messageCount: 1, agentId: 'a1' } as never)
  for await (const _ of stream) void _
  return stream.result
}

/** The end of the subagent's run. */
const complete = ($: Engine, durationMs: number, reason: 'answer' | 'aborted') =>
  $.turn.complete({ answer: '', durationMs, isAborted: reason === 'aborted', turnId: 't1', reason, agentId: 'a1' } as never)

/** `/spotter <args>`, as the composer runs it. */
const command = ($: Engine, args: string) =>
  $.command.run({ command: 'spotter', args, origin: { kind: 'composer' } } as never) as Promise<{ text: string }>

test('the hint line gains a titled row per live subagent, filled in as it runs', { options: { motion: 'off' } }, async ($, on) => {
  world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  const ui = await $.ui.mount(HINT)
  expect(text(await ui.drawn())).toBe(`${ENGINE}subagents └ ◐ Sonnet 5.5 · Plan · 0s`)
  await step($, 'claude-sonnet-5-5', 'low')
  expect(text(await ui.drawn())).toBe(`${ENGINE}subagents └ ◐ Sonnet 5.5 ·low · Plan · ctx (1M) ▰▱▱▱▱ 8% · 76K · 0s`)
  // The agent's name is plain dim text, as claudepeeker draws the branch.
  const name = await ui.find({ type: 'Text', text: /^Plan$/ })
  expect(JSON.stringify(name)).toContain('dimColor')
  expect(JSON.stringify(name)).not.toContain('bold')
  // The model and effort: claudepeeker's hues muted, not bold, a step below its line.
  const model = JSON.stringify(await ui.find({ type: 'Text', text: 'Sonnet 5.5' }))
  expect(model).toContain('#d7af5f')
  expect(model).not.toContain('bold')
  expect(JSON.stringify(await ui.find({ type: 'Text', text: ' ·low' }))).toContain('#5fafaf')
  // The dot is the lavender of claudeticker's live bar.
  expect(JSON.stringify(await ui.find({ type: 'Text', text: '◐' }))).toContain('#afafd7')
})

test('a toast a moment after the spawn names the agent, its model and effort', async ($, on) => {
  const { toasts, clock } = world(on, 'claude-haiku-5-5', 18_000)
  await spawn($)
  await step($, 'claude-haiku-5-5', 'low')
  expect(toasts).toEqual([])
  await clock.advance(1500)
  expect(toasts).toEqual(['Claude-Spotter: Plan → Haiku 5.5 ·low'])
})

test('with no live subagent the hint line is left as drawn', async ($, on) => {
  world(on, 'claude-haiku-5-5', 18_000, 'completed')
  await spawn($)
  const ui = await $.ui.mount(HINT)
  expect(text(await ui.drawn())).toBe(ENGINE)
})

test('the Agent call in the chat is left as drawn', async ($, on) => {
  world(on, 'claude-haiku-5-5', 18_000)
  await spawn($)
  await step($, 'claude-haiku-5-5', 'low')
  expect(text(await (await $.ui.mount(ROW)).drawn())).toBe(ENGINE)
})

test(
  'the bar settings reach the rows',
  { options: { motion: 'off', barStyle: 'dots', barWidth: '8' } },
  async ($, on) => {
    world(on, 'claude-opus-5-5', 300_000)
    await spawn($)
    await step($, 'claude-opus-5-5', 'high')
    const ui = await $.ui.mount(HINT)
    expect(text(await ui.drawn())).toBe(`${ENGINE}subagents └ ◐ Opus 5.5 ·high · Plan · ctx (1M) ●●○○○○○○ 30% · 300K · 0s`)
  },
)

test('a heavy bar draws ━ on a dim ━', { options: { barStyle: 'heavy' } }, async ($, on) => {
  world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const drawn = await (await $.ui.mount(HINT)).drawn()
  const bar = rasters(drawn).find(n => rasterKey(n) === 'spotter-bar-a1')
  expect(bar).toBeDefined()
  expect(mountedText(bar!).startsWith('━━━━━ 8%')).toBe(true)
  const cells = decodeCells(String(bar!.props?.cells ?? ''))
  expect(cells[0]?.fg).toBe(0x5fff00)
  expect(cells.slice(1, 5).map(c => c.fg)).toEqual([0x444444, 0x444444, 0x444444, 0x444444])
})

test('Lively draws the dot, the bar and the tail as Rasters that read as the plain row', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  const drawn = await draw(w, ui)
  expect(rasters(drawn).map(rasterKey)).toEqual(['spotter-dot-a1', 'spotter-bar-a1', 'spotter-tail-a1'])
  await w.clock.advance(3000)
  // The live dot is a spinner frame; the plain row draws its first frame, ◐.
  expect(current(w, drawn).replace(/[◓◑◒]/u, '◐')).toBe(`${ENGINE}subagents └ ◐ Sonnet 5.5 ·low · Plan · ctx (1M) ▰▱▱▱▱ 8% · 76K · 3s`)
  expect(w.blits.every(b => b.requestId === 'hint' && b.key.startsWith('spotter-'))).toBe(true)
  // The dot spins ◐ ◓ ◑ ◒ in lavender.
  const dotCells = w.blits.filter(b => b.key === 'spotter-dot-a1').flatMap(b => decodeCells(b.cells))
  expect(new Set(dotCells.map(c => c.cp))).toEqual(new Set([0x25d0, 0x25d3, 0x25d1, 0x25d2]))
  expect(dotCells.every(c => c.fg === LIVE)).toBe(true)
})

test('a bar there at the first draw is taken silently', async ($, on) => {
  const first = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const silent = await draw(first, await $.ui.mount(HINT))
  expect(text(rasters(silent)[1])).toBe('▰▱▱▱▱ 8% · 76K')
})

test('a bar whose first response comes after the first draw fills in from empty with a warm glint', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  const ui = await $.ui.mount(HINT)
  // The first draw: the row has no response yet.
  expect(text(await ui.drawn()).trimEnd()).toBe(`${ENGINE}subagents └ ◐ Sonnet 5.5 · Plan · 0s`)
  await step($, 'claude-sonnet-5-5', 'low')
  const drawn = await draw(w, ui)
  const bar = text(rasters(drawn)[1])
  expect(/^▱▱▱▱▱ 0% · +0$/.test(bar)).toBe(true)
  await w.clock.advance(300)
  expect(
    w.blits.some(b => b.key === 'spotter-bar-a1' && decodeCells(b.cells).some(c => c.fg === mixColor(0x5fff00, 0xfff5d7, 0.6))),
  ).toBe(true)
  // It settles on the real figures.
  await w.clock.advance(3000)
  expect(blitTexts(w, 'spotter-bar-a1').at(-1)).toBe('▰▱▱▱▱ 8% · 76K')
})

test('a drop in the context draws the compaction badge', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 600_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  expect(text(await ui.drawn())).toContain('▰▰▰▱▱ 60% · 600K')
  w.state.tokens = 200_000
  await step($, 'claude-sonnet-5-5', 'low')
  expect(text(await ui.drawn())).toContain('↻ −40%')
})

test('a tool call without an agent id flashes nothing', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  await draw(w, ui)
  await $.tool.call({ tool: 'Grep', pattern: 'x' } as never)
  await w.clock.advance(200)
  expect(blitTexts(w, 'spotter-tail-a1').some(t => t.includes('Grep'))).toBe(false)
})

test('a subagent that ends shows how it ended for two seconds, raises a toast and leaves', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  await draw(w, ui)
  await w.clock.advance(42_000)
  await complete($, 42_000, 'answer')
  const drawn = await draw(w, ui)
  expect(text(drawn)).toContain('✦ done · 42s')
  await w.clock.advance(100)
  expect(w.toasts.at(-1)).toBe('Claude-Spotter: Plan done · 42s · 76K')
  await w.clock.advance(2000)
  expect(text(await ui.drawn())).toBe(ENGINE)
  const count = w.blits.length
  await w.clock.advance(1000)
  expect(w.blits.length).toBe(count)
})

test('an interrupted subagent reads stopped', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  await draw(w, ui)
  await w.clock.advance(42_000)
  await complete($, 42_000, 'aborted')
  expect(text(await ui.drawn())).toContain('✗ stopped · 42s')
  await w.clock.advance(100)
  expect(w.toasts.at(-1)).toBe('Claude-Spotter: Plan stopped · 42s · 76K')
})

test('Off draws no Raster and no blit, and the elapsed time still ticks', { options: { motion: 'off' } }, async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  expect(rasters(await ui.drawn()).length).toBe(0)
  await w.clock.advance(2000)
  const drawn = await ui.drawn()
  expect(rasters(drawn).length).toBe(0)
  expect(text(drawn).endsWith('▰▱▱▱▱ 8% · 76K · 2s')).toBe(true)
  expect(w.blits.length).toBe(0)
})

test('the desktop draws the plain row and no Raster', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount({ ...HINT, surface: 'desktop' } as never)
  const drawn = await ui.drawn()
  expect(rasters(drawn).length).toBe(0)
  expect(text(drawn)).toBe(`${ENGINE}subagents └ ◐ Sonnet 5.5 ·low · Plan · ctx (1M) ▰▱▱▱▱ 8% · 76K · 0s`)
  await w.clock.advance(1000)
  expect(w.blits.length).toBe(0)
})

test('a slot that refuses its first blits three times is drawn still', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  w.state.blitAnswer = { deny: 'no such site' }
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  // One spinner step (0.2 s) per round: each one is the first blit of a fresh draw, refused.
  for (let i = 0; i < 3; i++) {
    expect(rasters(await ui.drawn()).length).toBeGreaterThan(0)
    await w.clock.advance(200)
  }
  const drawn = await ui.drawn()
  expect(rasters(drawn).length).toBe(0)
  expect(text(drawn)).toContain('Sonnet 5.5 ·low · Plan · ctx (1M) ▰▱▱▱▱ 8% · 76K')
})

test('/spotter demo plays a tour of made-up subagents, then brings the real row back', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  await ui.drawn()
  const started = await command($, 'demo')
  expect(started.text).toBe(
    'Playing the motion demo for 20 s under the prompt, with made-up subagents. /spotter demo stop ends it.',
  )

  // Through the tour, drawing every half second as the rows change.
  const drawings: string[] = []
  for (let at = 500; at < 20_000; at += 500) {
    await w.clock.advance(500)
    drawings.push(text(await ui.drawn()))
  }
  const seen = (part: string) =>
    drawings.some(d => d.includes(part)) ||
    w.blits.some(b => cellText(decodeCells(b.cells)).includes(part))
  expect(seen('Explore')).toBe(true)
  expect(seen('↻ −40%')).toBe(true)
  expect(seen('‹Grep›')).toBe(true)
  expect(seen('done')).toBe(true)
  // The demo's rows are made up: they raise no toast of their own.
  expect(w.toasts.some(t => t.includes('Explore'))).toBe(false)

  // The demo is over at 20 s: the real row is back.
  await w.clock.advance(1000)
  const after = text(await ui.drawn())
  expect(after).toContain('Sonnet 5.5 ·low · Plan')
  expect(after).not.toContain('Explore')
})

test('demo stop brings the real rows back; a second one says no demo runs', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  await ui.drawn()
  await command($, 'demo')
  await w.clock.advance(7000)
  expect(text(await ui.drawn())).toContain('Explore')
  const stopped = await command($, 'demo stop')
  expect(stopped.text).toBe('Stopped the demo: the rows show your real subagents again.')
  const drawn = text(await ui.drawn())
  expect(drawn).toContain('Sonnet 5.5 ·low · Plan')
  expect(drawn).not.toContain('Explore')
  expect((await command($, 'demo stop')).text).toBe('No demo is running.')
})

test('under Off the demo still steps the rows, without effects', { options: { motion: 'off' } }, async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  await ui.drawn()
  const started = await command($, 'demo')
  expect(started.text).toContain('Motion is Off')
  await w.clock.advance(7000)
  const drawn = await ui.drawn()
  expect(text(drawn)).toContain('Explore')
  expect(rasters(drawn).length).toBe(0)
  expect(w.blits.length).toBe(0)
})

test('a bare /spotter points to /config', async ($, on) => {
  world(on, 'claude-sonnet-5-5', 76_000)
  expect((await command($, '')).text).toBe(
    "Claude-Spotter's settings are in /config: the bar style and width, and Motion. /spotter demo plays the motion tour.",
  )
})

test('no setting is written to the store', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  await ui.drawn()
  await command($, 'demo')
  await w.clock.advance(1000)
  expect(w.store.size).toBe(0)
})

test('a bar that changes animates, then only the dot and the tail move', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  await draw(w, ui)
  w.state.tokens = 86_000
  await step($, 'claude-sonnet-5-5', 'low')
  await draw(w, ui)
  await w.clock.advance(3000)
  expect(blitTexts(w, 'spotter-bar-a1').length).toBeGreaterThan(0)
  expect(blitTexts(w, 'spotter-bar-a1').at(-1)).toBe('▰▱▱▱▱ 9% · 86K')
  const counts = () => ({
    bar: blitTexts(w, 'spotter-bar-a1').length,
    dot: blitTexts(w, 'spotter-dot-a1').length,
    tail: blitTexts(w, 'spotter-tail-a1').length,
  })
  const before = counts()
  await w.clock.advance(2000)
  const after = counts()
  expect(after.bar).toBe(before.bar)
  expect(after.dot).toBeGreaterThan(before.dot)
  expect(after.tail).toBeGreaterThan(before.tail)
})

test('a refused end-of-flash frame is sent again when the frames restart', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  await draw(w, ui)
  w.state.tokens = 86_000
  // Only the frame that ends the token flash (tick 22) is refused, as a dialog would.
  w.state.refuse = (key, cells) =>
    key === 'spotter-bar-a1' && cellText(cells) === '▰▱▱▱▱ 9% · 86K' && !cells.some(c => c.fg === GLINT_UP)
  await step($, 'claude-sonnet-5-5', 'low')
  await draw(w, ui)
  await w.clock.advance(2000)
  // The frames stopped there.
  expect(w.blits.some(b => b.key === 'spotter-bar-a1' && !b.isAccepted)).toBe(true)
  w.state.refuse = null
  // A tool call flashes the tail and restarts the frames, with no render.
  await $.tool.call({ tool: 'Grep', agentId: 'a1', pattern: 'x' } as never)
  await w.clock.advance(500)
  const shown = w.blits.filter(b => b.key === 'spotter-bar-a1' && b.isAccepted).at(-1)
  expect(shown).toBeDefined()
  const cells = decodeCells(shown!.cells)
  expect(cellText(cells)).toBe('▰▱▱▱▱ 9% · 86K')
  expect(cells.some(c => c.fg === GLINT_UP)).toBe(false)
})

test("a subagent's later requests on the same model and effort write only what changed", async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  const writes = { count: 0 }
  on('state.set', (_$, e, next) => {
    const one = e as unknown as { plugin?: string; key?: string }
    if (one.plugin === 'claudespotter' && one.key === 'stats') writes.count += 1
    return next(e)
  })
  await spawn($)
  // The first request: the model and effort going down, the tokens coming back.
  await step($, 'claude-sonnet-5-5', 'low')
  expect(writes.count).toBe(2)
  writes.count = 0
  await step($, 'claude-sonnet-5-5', 'low')
  expect(writes.count).toBe(0)
  w.state.tokens = 90_000
  await step($, 'claude-sonnet-5-5', 'low')
  expect(writes.count).toBe(1)
  writes.count = 0
  await step($, 'claude-sonnet-5-5', 'high')
  expect(writes.count).toBe(1)
  const ui = await $.ui.mount(HINT)
  expect(text(await ui.drawn())).toContain('Sonnet 5.5 ·high · Plan · ctx (1M) ▰▱▱▱▱ 9% · 90K')
})

test('while a subagent runs and nothing else moves, the rows repaint every 200 ms and the spinner keeps its step', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  await w.clock.advance(100)
  const ui = await $.ui.mount(HINT)
  await draw(w, ui)
  // Frames at 300, 500, 700, 900 and 1100: at 50 ms the second would flip at 1000.
  await w.clock.advance(900)
  expect(blitTexts(w, 'spotter-tail-a1').some(t => t.includes('1s'))).toBe(false)
  await w.clock.advance(100)
  expect(blitTexts(w, 'spotter-tail-a1').filter(t => t.includes('1s')).length).toBe(1)
  expect(blitTexts(w, 'spotter-dot-a1')).toEqual(['◓', '◑', '◒', '◐', '◓'])
  expect(blitTexts(w, 'spotter-bar-a1').length).toBe(0)
})

test('a /clear ends a running demo and brings the real row back', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  await ui.drawn()
  await command($, 'demo')
  await w.clock.advance(3000)
  expect(text(await ui.drawn())).toContain('Explore')
  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  const after = text(await ui.drawn())
  expect(after).toContain('Sonnet 5.5 ·low · Plan')
  expect(after).not.toContain('Explore')
  expect((await command($, 'demo stop')).text).toBe('No demo is running.')
})

test('a session start ends a running demo', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  await ui.drawn()
  await command($, 'demo')
  await w.clock.advance(3000)
  expect(text(await ui.drawn())).toContain('Explore')
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  const after = text(await ui.drawn())
  expect(after).toContain('Sonnet 5.5 ·low · Plan')
  expect(after).not.toContain('Explore')
  expect((await command($, 'demo stop')).text).toBe('No demo is running.')
})

test('a /clear in the middle of a highlight leaves no highlight behind', async ($, on) => {
  const w = world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  await step($, 'claude-sonnet-5-5', 'low')
  const ui = await $.ui.mount(HINT)
  await draw(w, ui)
  w.state.tokens = 86_000
  await step($, 'claude-sonnet-5-5', 'low')
  await draw(w, ui)
  // The roll to 9% and its flash are accepted.
  await w.clock.advance(150)
  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  const drawn = await ui.drawn()
  await w.clock.advance(1000)
  // The new drawing takes the figures silently, and the piece cut off mid-effect is sent once as drawn.
  const bar = raster(drawn, 'spotter-bar-a1')
  expect(mountedText(bar!)).toBe('▰▱▱▱▱ 9% · 86K')
  const shown = w.blits.filter(b => b.key === 'spotter-bar-a1' && b.isAccepted).at(-1)
  expect(shown).toBeDefined()
  expect(shown!.cells).toBe(bar?.props?.cells)
  expect(decodeCells(shown!.cells).some(c => c.fg === GLINT_UP)).toBe(false)
})
