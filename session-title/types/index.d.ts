export type SessionTitleState = { title: string | null }

declare module 'claude-code' {
  interface PluginState {
    'session-title': { title: string | null }
  }
}
