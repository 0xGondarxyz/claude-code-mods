export type Band = {
  /** What tripped the mod: the same error again, or three "still broken" prompts. */
  kind: 'error' | 'prompt'
  /** The error signature; empty for the prompt kind. */
  signature: string
}

declare module 'claude-code' {
  interface PluginState {
    'spiral-stop': { band: Band | null }
  }
}
