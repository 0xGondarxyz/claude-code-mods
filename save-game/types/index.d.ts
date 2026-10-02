export type Card = {
  doing: string
  next: string
  open: string
  /** Milliseconds since the epoch. */
  savedAt: number
  sessionId: string
  /** Git toplevel of the session cwd, else the cwd. */
  repo: string
}

export type Band = {
  card: Card | null
  isShown: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'save-game': { band: Band }
  }
}
