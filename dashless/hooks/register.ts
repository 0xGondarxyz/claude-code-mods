import type { Register } from 'claude-code'
import { fixDashes } from './fix'

const COMMIT_OR_PR = /\bgit\s+commit\b|\bgh\s+(pr|issue)\s+(create|edit|comment)\b/

let total = 0

export const register: Register = (on) => {
  on('tool.call', { tool: 'Write' }, ($, e, next) => {
    try {
      const fixed = fixDashes(e.content)
      if (fixed.count > 0) {
        total += fixed.count
        $.ui.status(`dashless: ${total} em dashes fixed`)
        return next({ ...e, content: fixed.text })
      }
    } catch {}
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, ($, e, next) => {
    try {
      const fixed = fixDashes(e.new_string)
      if (fixed.count > 0) {
        total += fixed.count
        $.ui.status(`dashless: ${total} em dashes fixed`)
        return next({ ...e, new_string: fixed.text })
      }
    } catch {}
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    try {
      if (COMMIT_OR_PR.test(e.command)) {
        const fixed = fixDashes(e.command)
        if (fixed.count > 0) {
          total += fixed.count
          $.ui.status(`dashless: ${total} em dashes fixed`)
          return next({ ...e, command: fixed.text })
        }
      }
    } catch {}
    return next(e)
  })

  on('session.append', ($, e, next) => {
    try {
      if (e.door === 'response') {
        let changed = 0
        const content = e.message.content.map((block) => {
          if (block.type !== 'text' || typeof block.text !== 'string') return block
          const fixed = fixDashes(block.text)
          changed += fixed.count
          return fixed.count > 0 ? { ...block, text: fixed.text } : block
        })
        if (changed > 0) {
          total += changed
          $.ui.status(`dashless: ${total} em dashes fixed`)
          return next({ ...e, message: { ...e.message, content } })
        }
      }
    } catch {}
    return next(e)
  })
}
