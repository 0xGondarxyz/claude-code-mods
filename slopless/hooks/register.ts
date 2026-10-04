import type { EngineInterface, Register } from 'claude-code'
import { lint, hasLol } from './lint'
import type { Hit } from './lint'

const TRIGGER =
  /\b(tweets?|tweeting|twitter|x\.com|linkedin|instagram|tiktok|reddit|social media|socials|captions?|hashtags?)\b|\bx (post(s|ed|ing)?|repl(y|ies)|comments?|threads?)\b|\bon x\b/i
const SOCIAL_SEGMENT = /social|linkedin|tweet|twitter/i
const NOTE_NAME = /^(?=.*[A-Z])[A-Z0-9_]+$/
const WRITES = />|\btee\b|\bcp\s|\bmv\s|\bsed\s+-i|<<|python/
const ROOT_TOUCH = />|\btee\b|\bcp\s|\bmv\s|\brm\s|\bsed\s+-i|<<|python|\bchmod\b|\bln\s/
const PLUGIN_OFF = /\bclaude\s+plugins?\s+(disable|uninstall|remove|rm)\b[^\n]*slopless/i
const SETTINGS_OFF = /"slopless[^"]*"\s*:\s*false/
const WRITES_TO_PAGE =
  /insertText|execCommand|\.value\s*=|textContent\s*=|innerText\s*=|innerHTML\s*=|contenteditable|tweetTextarea|ClipboardEvent|DataTransfer/i
const CHROME = 'mcp__claude-in-chrome__'
const NO_OFF = 'slopless cannot be turned off by the model. Ask the user to do it with /plugin.'

let blocked = 0
let rulesShown = false

const words = (s: string) => s.split(/\s+/).filter(Boolean).length

function isSocialFile(path: string): boolean {
  const parts = path.split('/')
  const base = parts[parts.length - 1] ?? ''
  if (!/\.(txt|md)$/i.test(base)) return false
  if (NOTE_NAME.test(base.replace(/\.(txt|md)$/i, ''))) return false
  return parts.some((p) => SOCIAL_SEGMENT.test(p))
}

function bashTouchesSocial(cmd: string): boolean {
  // Quoted prose (commit messages, titles) names a platform without writing to it.
  return cmd
    .replace(/'[^'\n]*'|"(?:[^"\\\n]|\\.)*"/g, (q) => (/[ \t]/.test(q) ? ' ' : q))
    .split(/\s+/)
    .map((t) => t.replace(/^['"(]+|['"),;:.!?]+$/g, ''))
    .filter((t) => /[/._-]/.test(t))
    .some((t) => t.split('/').some((p) => SOCIAL_SEGMENT.test(p)))
}

function jsLiterals(code: string): string[] {
  const out: string[] = []
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const s = m[1] ?? m[2] ?? m[3] ?? ''
    if (words(s) >= 3) out.push(s)
  }
  return out
}

type BrowserText = { text: string; tabId?: number }

function browserTexts(name: string, input: Record<string, unknown>): BrowserText[] {
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const forAction = (tool: string, inp: Record<string, unknown>): string[] => {
    if (tool === 'computer') {
      const t = str(inp.text)
      return inp.action === 'type' && t ? [t] : []
    }
    if (tool === 'form_input') {
      const v = str(inp.value)
      return v ? [v] : []
    }
    if (tool === 'javascript_tool') {
      const t = str(inp.text)
      return t && WRITES_TO_PAGE.test(t) ? jsLiterals(t) : []
    }
    return []
  }
  const out: BrowserText[] = []
  const add = (texts: string[], inp: Record<string, unknown>) => {
    const tabId = typeof inp.tabId === 'number' ? inp.tabId : undefined
    for (const text of texts) out.push({ text, tabId })
  }
  if (name.startsWith(CHROME)) {
    const tool = name.slice(CHROME.length)
    if (tool === 'browser_batch') {
      const actions = Array.isArray(input.actions) ? input.actions : []
      for (const a of actions) {
        if (a && typeof a === 'object') {
          const item = a as { name?: unknown; input?: unknown }
          if (typeof item.name === 'string' && item.input && typeof item.input === 'object') {
            const tn = item.name.startsWith(CHROME) ? item.name.slice(CHROME.length) : item.name
            add(forAction(tn, item.input as Record<string, unknown>), item.input as Record<string, unknown>)
          }
        }
      }
    } else {
      add(forAction(tool, input), input)
    }
  } else if (name.startsWith('mcp__') && /(type|fill|insert)/i.test(name)) {
    add([str(input.text), str(input.value)].filter((s): s is string => !!s), {})
  }
  return out.filter((t) => words(t.text) >= 3)
}

function isYouTubeHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host === 'youtube.com' || host.endsWith('.youtube.com')
  } catch {
    return false
  }
}

// Tab id to URL for the browser group. Fails closed: any error or bad JSON gives no tabs.
async function tabUrls($: EngineInterface): Promise<Map<number, string>> {
  const urls = new Map<number, string>()
  try {
    const res = await $.mcp.call('claude-in-chrome', 'tabs_context_mcp', {})
    if (res.isError) return urls
    const block = (res.content as { type?: string; text?: string }[]).find((c) => c.type === 'text' && typeof c.text === 'string')
    if (!block?.text) return urls
    const ctx = JSON.parse(block.text.split('\n')[0] ?? '') as { availableTabs?: { tabId?: number; url?: string }[] }
    for (const t of ctx.availableTabs ?? []) if (typeof t.tabId === 'number' && typeof t.url === 'string') urls.set(t.tabId, t.url)
  } catch {}
  return urls
}

async function readRules($: EngineInterface, voiceFile: string): Promise<string[]> {
  const parts: string[] = []
  try {
    parts.push(await $.fs.read(`${$.plugin.root}/rules.md`))
  } catch {}
  if (voiceFile) {
    try {
      parts.push(await $.fs.read(voiceFile))
    } catch {}
  }
  return parts
}

export const register: Register = (on, options) => {
  const voiceFile = typeof options.voiceFile === 'string' ? options.voiceFile : ''

  on('prompt.compose', ($, e, next) => {
    const text =
      'slopless is active. Text for social media (replies, X posts, LinkedIn posts, captions) must follow the slopless rules. ' +
      'The rules are attached to prompts about social media and to slopless messages. ' +
      'Writes to social folders and text typed into a browser are checked and blocked when they break the rules.'
    return (async () => {
      const res = await next(e)
      return { ...res, sections: [...res.sections, { id: 'slopless:notice', text, scope: 'session' as const }] }
    })()
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      if (TRIGGER.test(e.text)) {
        const parts = await readRules($, voiceFile)
        if (parts.length > 0) {
          rulesShown = true
          return next({ ...e, context: [...(e.context ?? []), ...parts.filter((p) => p.length > 0)] })
        }
      }
    } catch {}
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const name = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const root = $.plugin.root
    const str = (v: unknown) => (typeof v === 'string' ? v : '')

    // Self protection.
    if (name === 'Bash') {
      const cmd = str(input.command)
      if (PLUGIN_OFF.test(cmd) || (root && cmd.includes(root) && ROOT_TOUCH.test(cmd))) return { deny: NO_OFF }
    }
    if (name === 'Write' || name === 'Edit') {
      const path = str(input.file_path)
      const body = name === 'Write' ? str(input.content) : str(input.new_string)
      if (root && (path === root || path.startsWith(`${root}/`))) return { deny: NO_OFF }
      if (/settings(\.local)?\.json$/.test(path) && SETTINGS_OFF.test(body)) return { deny: NO_OFF }
    }

    // Collect text to lint.
    let texts: BrowserText[] = []
    let shell = false
    if (name === 'Write' || name === 'Edit') {
      const path = str(input.file_path)
      if (isSocialFile(path)) texts = [{ text: name === 'Write' ? str(input.content) : str(input.new_string) }]
    } else if (name === 'Bash') {
      const cmd = str(input.command)
      if (bashTouchesSocial(cmd) && WRITES.test(cmd)) {
        texts = [{ text: cmd }]
        shell = true
      }
    } else if (name.startsWith('mcp__')) {
      texts = browserTexts(name, input)
    }
    if (texts.length === 0) return next(e)

    const hits: Hit[] = []
    const lolHistory = await readHistory($)
    let pendingLol: boolean[] = []
    let tabs: Map<number, string> | undefined
    for (const { text: t, tabId } of texts) {
      let textHits = lint(t, { shell })
      if (tabId !== undefined && textHits.some((h) => h.rule === 'hashtag')) {
        tabs ??= await tabUrls($)
        if (isYouTubeHost(tabs.get(tabId) ?? '')) textHits = textHits.filter((h) => h.rule !== 'hashtag')
      }
      const lol = hasLol(t)
      if (lol && [...lolHistory, ...pendingLol].slice(-9).some(Boolean)) {
        textHits.push({ rule: 'lol', match: 'lol: used in one of the last 10 texts' })
      }
      if (textHits.length === 0) pendingLol = [...pendingLol, lol]
      for (const h of textHits) if (!hits.some((x) => x.rule === h.rule && x.match === h.match)) hits.push(h)
    }

    if (hits.length === 0 && rulesShown) {
      try {
        await $.store.set('lolHistory', [...lolHistory, ...pendingLol].slice(-10))
      } catch {}
      return next(e)
    }

    blocked += 1
    $.ui.status(`slopless: ${blocked} blocked`)
    let msg =
      hits.length === 0
        ? 'slopless: read these rules, then write the text again following them.'
        : 'slopless blocked this text. Rewrite it from scratch, do not reword around the rule.\n' +
          hits.map((h) => `- ${h.rule}: "${h.match}"`).join('\n')
    if (!rulesShown) {
      rulesShown = true
      const parts = await readRules($, voiceFile)
      if (parts.length > 0) msg += `\n\n${parts.join('\n\n')}`
    }
    return { deny: msg }
  })
}

async function readHistory($: EngineInterface): Promise<boolean[]> {
  try {
    const v = await $.store.get('lolHistory')
    return Array.isArray(v) ? v.map(Boolean).slice(-10) : []
  } catch {
    return []
  }
}
