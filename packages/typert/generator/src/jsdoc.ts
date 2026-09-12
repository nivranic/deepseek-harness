/** JSDoc prose and tag projection for the Cordis catalog. */

function tagText(text: string): string | null {
  let value = text.trimStart()
  if (/^[-—–]/.test(value)) value = value.slice(1).trimStart()
  return /[\n\r\u2028\u2029]/.test(value) ? null : value
}

function inlineLinks(text: string): string {
  const parts: string[] = []
  let copied = 0
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf('{@link', cursor)
    if (start < 0) break
    const separator = start + '{@link'.length
    let target = separator
    while (target < text.length && /\s/.test(text.charAt(target))) target += 1
    if (target === separator) {
      cursor = separator
      continue
    }
    const end = text.indexOf('}', target)
    if (end < 0) break
    cursor = end + 1
    // Both the separator and target must be nonempty, even when the target is whitespace.
    if (target === end) {
      if (target - separator < 2) continue
      target -= 1
    }
    parts.push(text.slice(copied, start), text.slice(target, end))
    copied = cursor
  }
  parts.push(text.slice(copied))
  return parts.join('')
}

/** Prose and recognized tags; absent return tags differ from empty descriptions. */
interface ParsedJsDoc {
  readonly doc: string
  readonly params: ReadonlyMap<string, string>
  readonly returns: string | null
  readonly throws: readonly string[]
  readonly deprecated: boolean
}

/**
 * Normalize comment prose and supported tags for Cordis catalog validation.
 * @param raw - JSDoc text, with or without comment delimiters.
 * @returns parsed prose and tags; empty recognized descriptions remain empty for validation.
 */
export function parseJsDoc(raw: string): ParsedJsDoc {
  const lines = raw
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(line => line.replace(/^\s*\*?\s?/, '').trimEnd())
  const blocks: string[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let item: string[] = []
  let inTags = false
  const join = (parts: readonly string[]): string => parts.join(' ').replace(/\s+/g, ' ').trim()
  const flushItem = (): void => {
    if (item.length > 0) list.push(join(item))
    item = []
  }
  const flushList = (): void => {
    flushItem()
    if (list.length > 0) blocks.push(list.join('\n'))
    list = []
  }
  const flushParagraph = (): void => {
    flushList()
    if (paragraph.length > 0) blocks.push(join(paragraph))
    paragraph = []
  }
  for (const line of lines) {
    const tagLine = line.trimStart()
    if (tagLine.startsWith('@')) {
      flushParagraph()
      inTags = true
      continue
    }
    if (inTags) continue
    if (line.trim() === '') {
      flushParagraph()
      continue
    }
    if (/^-\s+/.test(line)) {
      flushItem()
      if (paragraph.length > 0) {
        blocks.push(join(paragraph))
        paragraph = []
      }
      item.push(line)
      continue
    }
    if (item.length > 0) item.push(line)
    else paragraph.push(line)
  }
  flushParagraph()

  const params = new Map<string, string>()
  let returns: string | null = null
  const throws: string[] = []
  let deprecated = false
  let sink: ((text: string) => void) | undefined
  for (const line of lines) {
    if (/^@deprecated(?:\s|$)/.test(line)) {
      deprecated = true
      sink = undefined
      continue
    }
    const param = /^@param\s+(\[?[\w$]+\]?)/.exec(line)
    const paramText = param === null ? null : tagText(line.slice(param[0].length))
    if (param !== null && paramText !== null) {
      const name = (param[1] ?? '').replace(/^\[|\]$/g, '')
      let value = paramText
      params.set(name, value)
      sink = (text) => {
        value = value === '' ? text : `${value} ${text}`
        params.set(name, value)
      }
      continue
    }
    const returnsTag = /^@returns?(?=\s|$)/.exec(line)
    const returnsText = returnsTag === null ? null : tagText(line.slice(returnsTag[0].length))
    if (returnsText !== null) {
      let value = returnsText
      returns = value
      sink = (text) => {
        value = value === '' ? text : `${value} ${text}`
        returns = value
      }
      continue
    }
    const throwsTag = /^@throws?(?=\s|$)/.exec(line)
    const throwsText = throwsTag === null ? null : tagText(line.slice(throwsTag[0].length))
    if (throwsText !== null) {
      let value = throwsText
      throws.push(value)
      const index = throws.length - 1
      sink = (text) => {
        value = value === '' ? text : `${value} ${text}`
        throws[index] = value
      }
      continue
    }
    if (line.startsWith('@') || line.trim() === '') sink = undefined
    else sink?.(line.trim())
  }
  return {
    doc: inlineLinks(blocks.join('\n\n')).trim(),
    params,
    returns,
    throws,
    deprecated,
  }
}
