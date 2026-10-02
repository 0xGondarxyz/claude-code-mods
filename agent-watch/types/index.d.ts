export type AgentStatus = 'running' | 'done' | 'stopped'

export type AgentRow = {
  /** The agent's id, as `agent.spawn` answered it and `tool.call` carries it. */
  id: string
  /** Model name (`Sonnet`) or the subagent type when no model is known. */
  label: string
  /** The Agent call's description. */
  description: string
  /** `$.clock.now()` when it started, in ms. */
  startedAt: number
  /** Latest tool call, as `Bash claude plugin test`; empty before the first. */
  tool: string
  status: AgentStatus
  /** `$.clock.now()` when it finished, in ms; set once status is not running. */
  endedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-watch': { agents: Record<string, AgentRow> }
  }
}
