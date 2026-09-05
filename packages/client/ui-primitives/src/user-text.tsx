/**
 * Display projection of reference forms in sent user text (bubble and queue
 * rows). The logged model text remains the single truth; this is presentation
 * only, and every part renders inline so a single-line message never breaks
 * across lines. Three decoration sources, by precedence: the wire session form
 * `@[label](dsh-session:...)` folds to its label; exact session labels
 * supplied by an adjacent recall decorate their bare `@label` mention; and
 * plain `/name` / `@name` word-boundary tokens decorate by shape alone (sent
 * tokens were validated at compose time).
 */
import type { ReactNode } from 'react'
import { ReferenceIcon } from './ReferenceIcon.tsx'
import css from './user-text.module.css'

/** The display grammar accepts any nonempty URI payload without whitespace or `)`. */
const SESSION_WIRE_MIDDLE = '](dsh-session:'

interface DecorationRange {
  readonly start: number
  readonly end: number
  /** Matched source text (hover title). */
  readonly label: string
  readonly kind: 'session' | 'plain'
  /** Pre-resolved display text (wire folds); derived from label when absent. */
  readonly display?: string
}

/**
 * Split one sent text into inline plain runs and reference chips.
 * @param text - the logged model text of the message or queue row.
 * @param sessionLabels - exact session mention labels associated by an adjacent recall.
 * @returns inline nodes covering the whole text.
 */
export function projectUserText(text: string, sessionLabels: readonly string[]): ReactNode {
  const ranges: DecorationRange[] = []
  let start = text.indexOf('@[')
  let labelEnd = -1
  let uriEnd = -1
  while (start >= 0) {
    const labelStart = start + 2
    // Nested unfinished candidates share delimiters; neither suffix is rescanned.
    if (labelEnd < labelStart) {
      labelEnd = labelStart
      while (labelEnd < text.length && text[labelEnd] !== ']' && text[labelEnd] !== '\n') labelEnd++
    }
    let next = labelStart
    if (labelEnd > labelStart && text.startsWith(SESSION_WIRE_MIDDLE, labelEnd)) {
      const uriStart = labelEnd + SESSION_WIRE_MIDDLE.length
      if (uriEnd < uriStart) {
        uriEnd = uriStart
        while (uriEnd < text.length && text[uriEnd] !== ')' && !/\s/u.test(text.charAt(uriEnd))) uriEnd++
      }
      if (uriEnd > uriStart && text[uriEnd] === ')') {
        next = uriEnd + 1
        ranges.push({ start, end: next, label: text.slice(start, next), kind: 'session', display: text.slice(labelStart, labelEnd) })
      }
    }
    start = text.indexOf('@[', next)
  }
  for (const rawLabel of [...new Set(sessionLabels)].sort((a, b) => b.length - a.length)) {
    const label = `@${rawLabel}`
    let start = text.indexOf(label)
    while (start >= 0) {
      ranges.push({ start, end: start + label.length, label, kind: 'session' })
      start = text.indexOf(label, start + label.length)
    }
  }
  const re = /(^|\s)(\/[\w-]+|@"[^"\n]+"|@[^\s]+)/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tokenStart = m.index + (m[1] as string).length // (^|\s) captures '' at line start
    const rawLabel = m[2] as string // non-optional alternation capture
    let labelLength = rawLabel.length
    if (!rawLabel.startsWith('@"')) {
      while (/[.,;:!?，。；：！？]/u.test(rawLabel.charAt(labelLength - 1))) labelLength--
    }
    const label = rawLabel.slice(0, labelLength)
    if (label.length <= 1) continue
    ranges.push({ start: tokenStart, end: tokenStart + label.length, label, kind: 'plain' })
  }
  const rankOf = (range: DecorationRange): number => range.kind === 'session' ? 0 : 1
  ranges.sort((a, b) => a.start - b.start || rankOf(a) - rankOf(b) || b.end - a.end)
  const parts: ReactNode[] = []
  let cursor = 0
  const pushPlain = (from: number, to: number): void => {
    parts.push(<span key={`t${from}`} className={css.plainRun}>{text.slice(from, to)}</span>)
  }
  for (const range of ranges) {
    if (range.start < cursor) continue
    const { start: tokenStart, end, label, kind } = range
    if (tokenStart > cursor) pushPlain(cursor, tokenStart)
    const referenceKind = kind === 'session'
      ? 'session'
      : label.startsWith('@')
        ? label.endsWith('/') ? 'folder' : 'file'
        : undefined
    const displayLabel = range.display
      ?? (referenceKind === undefined
        ? label
        : referenceKind === 'session'
          ? label.slice(1)
          : label.slice(1).replace(/^"|"$/gu, '').split(/[\\/]/u).filter(Boolean).at(-1) ?? label.slice(1))
    parts.push(
      <span
        key={tokenStart}
        className={css.refChip}
        data-ref-chip={referenceKind ?? 'skill'}
        title={label}
      >
        {referenceKind !== undefined && (
          <ReferenceIcon kind={referenceKind} size={16} className={css.refIcon} />
        )}
        {displayLabel}
      </span>,
    )
    cursor = end
  }
  if (parts.length === 0) return <span className={css.plainRun}>{text}</span>
  if (cursor < text.length) pushPlain(cursor, text.length)
  return <>{parts}</>
}
