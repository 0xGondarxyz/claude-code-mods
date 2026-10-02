export const MAX_LINES = 6
export const MAX_CHARS = 400
export const HOLD_SECONDS = 5
export const PREVIEW_CHARS = 60

/** Quotes a message: each line prefixed `> `, at most 6 lines and 400 characters, `…` when cut. */
export function quoteBlock(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '').split('\n')
  const out: string[] = []
  let chars = 0
  let isCut = false
  for (const line of lines) {
    if (out.length >= MAX_LINES) {
      isCut = true
      break
    }
    const room = MAX_CHARS - chars
    if (line.length > room) {
      out.push(line.slice(0, room))
      isCut = true
      break
    }
    out.push(line)
    chars += line.length
  }
  if (isCut) out[out.length - 1] += '…'
  return out.map(line => `> ${line}`).join('\n')
}

/** The box after a quote: the quote, a newline, then the existing draft. */
export function quoteInto(message: string, draft: string): string {
  return `${quoteBlock(message)}\n${draft}`
}

/** First 60 characters of a held prompt, on one line. */
export function preview(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > PREVIEW_CHARS ? `${one.slice(0, PREVIEW_CHARS)}…` : one
}

/** The hand-off prompt for a fork that keeps the conversation. */
export function takeOverPrompt(message: string): string {
  return `Take this over and do it now:\n\n${message}`
}

/**
 * The argv that opens a new Konsole tab in `root` running Claude. `-e` comes last
 * because Konsole hands it every argument after. With a session id: a fork of that
 * conversation with the take-over prompt. Without: a new session on the message.
 */
export function handOffArgv(root: string, message: string, sessionId?: string): string[] {
  const head = ['konsole', '--new-tab', '--workdir', root, '-e', 'claude']
  if (sessionId !== undefined) return [...head, '--resume', sessionId, '--fork-session', takeOverPrompt(message)]
  // A message that starts with a dash would read as a flag, so `--` ends the options.
  return message.startsWith('-') ? [...head, '--', message] : [...head, message]
}

/** The argv as one line a person can paste into a shell (single quotes around anything odd). */
export function shellLine(argv: readonly string[]): string {
  return argv.map(a => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ')
}
