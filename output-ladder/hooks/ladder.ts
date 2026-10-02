// Prompt texts and argument handling for the four rungs.

export type Rung = 'ste' | 'diagram' | 'page' | 'video'

export const RUNGS: readonly Rung[] = ['ste', 'diagram', 'page', 'video']

export const BUTTON_LABELS: Record<Rung, string> = {
  ste: 'STE',
  diagram: 'Diagram',
  page: 'Page',
  video: 'Video',
}

export const DESCRIPTIONS: Record<Rung, string> = {
  ste: 'Re-explain the last answer in ASD-STE100 style (add "full" for strict)',
  diagram: 'Re-explain the last answer as an ASCII diagram',
  page: 'Turn the last answer into a self-contained HTML page',
  video: 'Make a short explainer video of the last answer',
}

const PROMPTS: Record<Rung, string> = {
  ste: 'Rewrite your last answer about 80% of the way to ASD-STE100 Simplified Technical English: sentences of 20 words or fewer, common words with one meaning each, active voice, present tense, one idea per sentence, no idioms. Keep every fact and every number.',
  diagram:
    'Explain your last answer as a diagram. Draw an ASCII diagram with boxes and arrows that fits in 100 columns, then add at most 3 short lines of notes.',
  page: 'Turn your last answer into one self-contained HTML page that explains it visually: clear layout, inline SVG diagrams, small interactions only where they help understanding. If an Artifact or publish tool is available, publish it; otherwise save the file and give its path.',
  video:
    'Make a short explainer video of your last answer in the style of 3Blue1Brown. First show a scene plan. Use free or local tools for visuals and narration; do not use paid APIs unless I ask. Render an MP4 and give its path.',
}

const STE_FULL =
  'Rewrite your last answer in ASD-STE100 Simplified Technical English, following the specification strictly. Keep every fact and every number.'

const REPLIES: Record<Rung, string> = {
  ste: 'Asking for an STE version of the last answer.',
  diagram: 'Asking for a diagram of the last answer.',
  page: 'Asking for an HTML page of the last answer.',
  video: 'Asking for an explainer video of the last answer.',
}

const REPLY_STE_FULL = 'Asking for a full ASD-STE100 version of the last answer.'

export type Ask = { text: string; reply: string }

/** The prompt and the reply line for a rung. `args` is what the user typed after the command. */
export function buildAsk(rung: Rung, args = ''): Ask {
  let extra = args.trim()
  let isFull = false
  if (rung === 'ste') {
    const m = /^full(?:\s+|$)/i.exec(extra)
    if (m) {
      isFull = true
      extra = extra.slice(m[0].length).trim()
    }
  }
  const base = isFull ? STE_FULL : PROMPTS[rung]
  return {
    text: extra === '' ? base : `${base}\nExtra instruction: ${extra}`,
    reply: isFull ? REPLY_STE_FULL : REPLIES[rung],
  }
}

type AppendLike = {
  door: string
  agentId?: string
  message: { type: string; content: ReadonlyArray<{ type: string; text?: unknown }> }
}

/** Text blocks of one assistant response row of the main conversation, or '' for any other row. */
export function responseText(e: AppendLike): string {
  if (e.door !== 'response' || e.message.type !== 'assistant' || e.agentId !== undefined) return ''
  return e.message.content
    .map(block => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .filter(t => t !== '')
    .join('\n\n')
}
