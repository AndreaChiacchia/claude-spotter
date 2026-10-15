import { expect, test } from 'claude-code/testing'

import { DEMO_AGENTS, DEMO_END_MS, DEMO_TICK_MS, DEMO_WINDOW, demoRowsAt, demoToolsAt, isDemoChangeAt } from '../hooks/demo'
import { FINISH_MS, advance, barOf, createMotion, observe } from '../hooks/motion'

test('the script is read by the time that has passed', () => {
  const first = demoRowsAt(0)
  expect(first.map(r => r.id)).toEqual(['demo-explore'])
  expect(first[0]).toMatchObject({ status: 'pending', tokens: null, startedAt: 0, finishedAt: null })

  const mid = demoRowsAt(4000)
  expect(mid.map(r => r.id)).toEqual(['demo-explore', 'demo-plan'])
  expect(mid[0]).toMatchObject({ status: 'running', tokens: 14 * (DEMO_WINDOW / 100) })
  expect(mid[1]).toMatchObject({ status: 'running', tokens: 9 * (DEMO_WINDOW / 100) })

  // A waiting subagent keeps its context.
  expect(demoRowsAt(8000).find(r => r.id === 'demo-plan')).toMatchObject({ status: 'waiting', tokens: 90_000 })

  expect(demoRowsAt(13000).find(r => r.id === 'demo-general')).toMatchObject({
    status: 'completed',
    finishedAt: 13000,
    startedAt: 7500,
  })
  expect(demoRowsAt(14750).some(r => r.id === 'demo-general')).toBe(true)
  expect(demoRowsAt(15000).some(r => r.id === 'demo-general')).toBe(false)
})

test('the tool calls and the changes of the script', () => {
  expect(demoToolsAt(2500)).toEqual([{ id: 'demo-explore', tool: 'Grep' }])
  expect(demoToolsAt(14000)).toEqual([{ id: 'demo-plan', tool: 'Edit' }])
  expect(demoToolsAt(2750)).toEqual([])
  expect(isDemoChangeAt(1000)).toBe(true)
  expect(isDemoChangeAt(2500)).toBe(false)
  // A finished row leaves FINISH_MS after it finished.
  expect(isDemoChangeAt(16500 + FINISH_MS)).toBe(true)
})

test('every step lands on a demo tick and the tour ends before the demo does', () => {
  let lastExit = 0
  for (const agent of DEMO_AGENTS) {
    for (const step of agent.steps) expect(step.at % DEMO_TICK_MS).toBe(0)
    const done = agent.steps.find(s => s.status === 'completed')
    expect(done).not.toBeUndefined()
    lastExit = Math.max(lastExit, done!.at + FINISH_MS)
  }
  expect(lastExit).toBeLessThanOrEqual(DEMO_END_MS - 500)
})

test('walking the script starts the effects it was written for', () => {
  const pref = { style: 'blocks', width: 5 }
  const m = createMotion()
  const times = [...new Set(DEMO_AGENTS.flatMap(a => a.steps.map(s => s.at)))].sort((a, b) => a - b)
  const seen: Record<number, { glint?: string; pulseHot?: boolean; badge?: string }> = {}
  const entered: string[] = []
  for (const at of times) {
    for (const row of demoRowsAt(at)) {
      if (row.tokens === null) continue
      const had = m.bars.get(row.id)?.target != null
      observe(m, row.id, { percent: row.tokens / (DEMO_WINDOW / 100), tokens: row.tokens }, pref, 'lively', true)
      if (!had) entered.push(`${row.id}@${at}`)
    }
    const explore = m.bars.get('demo-explore')
    seen[at] = {
      glint: explore?.glint?.start === m.tick ? explore.glint.dir : undefined,
      pulseHot: explore?.pulse?.start === m.tick ? explore.pulse.isHot : undefined,
      badge: explore?.badge?.start === m.tick ? explore.badge.text : undefined,
    }
    // Let every effect of this step end before the next one is read.
    for (let i = 0; i < 60; i++) advance(m)
  }
  // Each agent's first percent enters the bar from empty with a glint.
  expect(entered).toEqual(['demo-explore@1000', 'demo-plan@4000', 'demo-general@8500'])
  expect(seen[1000]?.glint).toBe('up')
  expect(barOf(m, 'demo-plan').target).toBe(26)
  // 14 to 55 crosses 50%, 55 to 84 crosses 80%, 84 to 44 is a compaction.
  expect(seen[6500]?.pulseHot).toBe(false)
  expect(seen[9500]?.pulseHot).toBe(true)
  expect(seen[11500]?.badge).toBe('↻ −40%')
})
