/** Unified-diff rendering: hunk headers and both line gutters with added/removed colouring. */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseUnifiedDiff, type DiffRow } from './parse.ts'
import type { DocumentPreviewProps } from '../document/contract.ts'
import type {} from './locales.ts'
import css from './DiffBody.module.css'

/** Document owner props and this renderer's localized controls. */
export type DiffBodyProps = DocumentPreviewProps & PropsLocale<'sidebarDiffPreview'>

const ROW_CLASS: Record<DiffRow['type'], string | undefined> = {
  preamble: css.preamble, hunk: css.hunk, context: undefined, add: css.add, del: css.del, note: css.note,
}

interface CopyResult {
  readonly content: DiffBodyProps['content']
  readonly address: string
  readonly ok: boolean
}

/** One row's two gutter cells; an absent position renders an empty cell. */
function guttersOf(row: DiffRow): readonly [string, string] {
  if (row.type === 'context') return [String(row.oldLine), String(row.newLine)]
  if (row.type === 'add') return ['', String(row.newLine)]
  if (row.type === 'del') return [String(row.oldLine), '']
  return ['', '']
}

/** @param props - accumulated document contents and framework props. @returns the parsed unified diff, or no body for byte contents. */
export function DiffBody({ resourceAddress, content, scrollportRef, t }: DiffBodyProps): ReactNode {
  const rows = useMemo(() => content.kind === 'text' ? parseUnifiedDiff(content.text) : [], [content])
  const [copyResult, setCopyResult] = useState<CopyResult>()
  const copyAttempt = useRef(0)
  useEffect(() => () => { copyAttempt.current += 1 }, [resourceAddress, content])
  if (content.kind !== 'text') return null
  const visibleResult = copyResult?.content === content && copyResult.address === resourceAddress ? copyResult : undefined
  const copy = (): void => {
    const attempt = ++copyAttempt.current
    setCopyResult(undefined)
    void writeClipboard(content.text).then((ok) => {
      if (copyAttempt.current === attempt) setCopyResult({ content, address: resourceAddress, ok })
    })
  }
  return (
    <div className={css.renderer} data-diff-preview data-diff-eof={content.eof ? 'true' : 'false'}>
      <div className={css.toolbar}>
        {visibleResult?.ok === false && <span role="status">{t('copyFailed')}</span>}
        <Button variant="toolbar" size="sm" onClick={copy} disabled={content.text.length === 0}>
          {visibleResult?.ok === true ? t('copied') : t(content.eof ? 'copy' : 'copyLoaded')}
        </Button>
      </div>
      <div className={css.body} ref={scrollportRef} data-diff-scrollport>
        {rows.map((row, index) => {
          const [old, next] = guttersOf(row)
          return (
            <div key={index} className={clsx(css.row, ROW_CLASS[row.type])} data-diff-row={row.type}>
              <span className={css.gutter}>{old}</span>
              <span className={css.gutter}>{next}</span>
              <span className={css.marker}>{row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}</span>
              <span className={css.text}>{row.text}</span>
            </div>
          )
        })}
        {rows.length === 0 && <div className={css.row} data-diff-empty>{t('empty')}</div>}
      </div>
    </div>
  )
}
