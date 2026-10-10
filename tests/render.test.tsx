import type { AgentStatus, On, TurnStepResult } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

const HINT = {
  plugin: 'claudespotter',
  surface: 'terminal',
  component: 'PromptHint',
  props: { isDraft: false, isWorking: true, hint: 'esc to interrupt' } as never,
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

const PANE = {
  plugin: 'claudespotter',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'spotter-bar',
  props: { title: 'Subagent ctx bar', isFocused: false } as never,
} as const

/** What the engine draws beneath the mod, for every component. */
const ENGINE = 'esc to interrupt'

type Node = { children?: unknown[] }

function text(node: unknown): string {
  if (typeof node === 'string') return node
  if (node === null || typeof node !== 'object') return ''
  return ((node as Node).children ?? []).map(text).join('')
}

/** The engine beneath the mod: one subagent `a1` on `model`, answering over `tokens` of context. */
function world(on: On, model: string, tokens: number, status: AgentStatus = 'running') {
  const toasts: string[] = []
  const clock = mock.clock(on, { now: 0 })
  mock.store(on)
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 1, window: 1_000_000, percent: 0 }, rateLimits: [] } }))
  on('session.model', () => ({ value: 'claude-opus-5-5[1m]' }))
  on('agent.list', () => ({ value: [{ id: 'a1', type: 'Plan', description: 'Searching', status }] }))
  on('agent.spawn', () => ({ model, agentId: 'a1' }))
  on('turn.step', async function* (_$, e): AsyncGenerator<never, TurnStepResult> {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: { model, input_tokens: tokens - 1000, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 50 },
    }
  })
  on('ui.render', ({ ui }, e) => {
    const { Text } = ui.resolve(e)
    return <Text>{ENGINE}</Text>
  })

  return { toasts, clock }
}

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

const hint = async ($: Engine) => text(await (await $.ui.mount(HINT)).drawn())

test('the hint line gains a titled row per live subagent, filled in as it runs', async ($, on) => {
  world(on, 'claude-sonnet-5-5', 76_000)
  await spawn($)
  expect(await hint($)).toBe(`${ENGINE}subagents └ Sonnet 5.5 · Plan`)
  await step($, 'claude-sonnet-5-5', 'low')
  expect(await hint($)).toBe(`${ENGINE}subagents └ Sonnet 5.5 ·low · Plan · ctx (200K) ▰▰▱▱▱ 38%`)
  // The agent's name is plain dim text, as claudepeeker draws the branch.
  const name = await (await $.ui.mount(HINT)).find({ type: 'Text', text: /^Plan$/ })
  expect(JSON.stringify(name)).toContain('dimColor')
  expect(JSON.stringify(name)).not.toContain('bold')
  // The model and effort: claudepeeker's hues muted, not bold, a step below its line.
  const model = JSON.stringify(await (await $.ui.mount(HINT)).find({ type: 'Text', text: 'Sonnet 5.5' }))
  expect(model).toContain('#d7af5f')
  expect(model).not.toContain('bold')
  expect(JSON.stringify(await (await $.ui.mount(HINT)).find({ type: 'Text', text: ' ·low' }))).toContain('#5fafaf')
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
  expect(await hint($)).toBe(ENGINE)
})

test('the Agent call in the chat is left as drawn', async ($, on) => {
  world(on, 'claude-haiku-5-5', 18_000)
  await spawn($)
  await step($, 'claude-haiku-5-5', 'low')
  expect(text(await (await $.ui.mount(ROW)).drawn())).toBe(ENGINE)
})

test('the panel restyles the bar the rows draw', async ($, on) => {
  world(on, 'claude-opus-5-5', 300_000)
  await spawn($)
  await step($, 'claude-opus-5-5', 'high')
  const pane = await $.ui.mount(PANE)
  // Parallelogram steps on to Dots, six along; two widths on is 8 cells.
  for (let i = 0; i < 6; i++) await pane.press({ key: 'style-next' })
  await pane.press({ key: 'width-next' })
  await pane.press({ key: 'width-next' })
  expect(await hint($)).toBe(`${ENGINE}subagents └ Opus 5.5 ·high · Plan · ctx (1M) ●●○○○○○○ 30%`)
})
