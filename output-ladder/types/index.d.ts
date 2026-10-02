export type LadderState = {
  /** True while the four buttons are shown above the prompt. */
  isShown: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'output-ladder': { isShown: boolean }
  }
}
