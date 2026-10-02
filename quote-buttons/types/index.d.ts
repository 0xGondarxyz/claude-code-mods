export type Held = {
  /** Unique per held prompt. */
  id: string
  /** The prompt text being held. */
  text: string
  /** Seconds left before it is delivered. */
  seconds: number
}

declare module 'claude-code' {
  interface PluginState {
    'quote-buttons': { held: Held[] }
  }
}
