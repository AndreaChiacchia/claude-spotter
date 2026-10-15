export type BarPref = { style: string; width: number }

/** How much the rows move: `lively`, `subtle`, or not at all. */
export type Motion = 'lively' | 'subtle' | 'off'

/** What a subagent's last model request ran on, and how full its context was. */
export type AgentStat = {
  model: string
  /** A level (`low` ... `max`), an integer budget, or null for a model without effort. */
  effort: string | number | null
  /** Input tokens of the last response (uncached, cache-read and cache-written); null before one. */
  tokens: number | null
}

/** One Agent call: the subagent it started, and the model the spawn resolved. */
export type Spawn = {
  agentId: string
  type: string
  model: string
  /** When the spawn settled (ms since the epoch); absent on a record written before it existed. */
  startedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    claudespotter: {
      /** By the Agent call's tool_use_id. */
      spawns: Record<string, Spawn>
      /** By the subagent's id. */
      stats: Record<string, AgentStat>
      bar: BarPref
      motion: Motion
    }
  }
}
