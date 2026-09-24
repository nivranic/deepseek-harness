/** Unified-diff rendering: hunk headers and both line gutters with added/removed colouring. */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { parseUnifiedDiff, type DiffRow } from './parse.ts'
import type { DocumentPreviewProps } from '../document/contract.ts'
import type {} from './locales.ts'
import css from './DiffBody.module.css'

/** Document owner props and this renderer's localized controls. */
export type DiffBodyProps = DocumentPreviewProps & PropsLocale<'sidebarDiffPreview'>

/** One row's two gutter cells; an absent position renders an empty cell. */
function guttersOf(row: DiffRow): readonly [string, string] {
  if (row.type === 'context') return [String(row.oldLine), String(row.newLine)]
  if (row.type === 'add') return ['', String(row.newLine)]
  if (row.type === 'del') return [String(row.oldLine), '']
  return ['', '']
}

/** @param props - accumulated document contents and framework props. @returns the parsed unified diff, or no body for byte contents. */
export function DiffBody({ content, scrollportRef, t }: DiffBodyProps): ReactNode {
  const rows = useMemo(() => content.kind === 'text' ? parseUnifiedDiff(content.text) : [], [content])
  if (content.kind !== 'text') return null
  return (
    <div className={css.renderer} data-diff-preview data-diff-eof={content.eof ? 'true' : 'false'} ref={scrollportRef}>
      {rows.map((row, index) => {
        const [old, next] = guttersOf(row)
        return (
          <div key={index} className={css.row} data-diff-row={row.type}>
            <span className={css.gutter}>{old}</span>
            <span className={css.gutter}>{next}</span>
            <span className={css.text}>{row.text}</span>
          </div>
        )
      })}
      {rows.length === 0 && <div className={css.row} data-diff-empty>{t('empty')}</div>}
    </div>
  )
}
