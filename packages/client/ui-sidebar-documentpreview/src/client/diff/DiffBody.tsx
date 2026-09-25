/** Unified-diff rendering: hunk headers and both line gutters with added/removed colouring. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseFileAddress, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { parseUnifiedDiff, type DiffRow } from './parse.ts'
import type { DocumentPreviewProps } from '../document/contract.ts'
import type {} from './locales.ts'
import { diffFiles } from './files.ts'
import { highlightDiffRows } from './syntax.ts'
import css from './DiffBody.module.css'

/** Document owner props and this renderer's localized controls. */
export type DiffBodyProps = DocumentPreviewProps & PropsLocale<'sidebarDiffPreview'> & InjectFace<DiffBodyInjected>

/** Framework observations and the originating Host's file-opener admission. */
export interface DiffBodyInjected {
  readonly hooks: {
    readonly grammars: ObservableSnapshot<number>
    readonly fileOpeners: ObservableSnapshot<readonly SidebarRightTabDefinition[]>
  }
  /** @param address - addressed Session file. @returns whether the originating Host and a matching viewer remain available. */
  readonly canOpenFile: (address: string) => boolean
}

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
export function DiffBody({
  resourceAddress, content, scrollportRef, useTabInfo, useGrammars, useFileOpeners, canOpenFile, t,
}: DiffBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const grammarVersion = useGrammars(value => value)
  useFileOpeners(value => value)
  const rows = useMemo(() => content.kind === 'text' ? parseUnifiedDiff(content.text) : [], [content])
  const files = useMemo(() => diffFiles(rows), [rows])
  const syntax = useMemo(() => highlightDiffRows(rows, files), [rows, files, grammarVersion])
  const fileAddress = parseFileAddress(resourceAddress)
  const scrollElement = useRef<HTMLDivElement | null>(null)
  const bindScrollport = useCallback((node: HTMLDivElement | null) => {
    scrollElement.current = node
    scrollportRef(node)
  }, [scrollportRef])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollElement.current,
    estimateSize: () => {
      const node = scrollElement.current
      if (node === null) return 21
      const style = getComputedStyle(node)
      const height = Number.parseFloat(style.lineHeight)
      return Number.isFinite(height) ? height : Number.parseFloat(style.fontSize) * 1.6 || 21
    },
  })
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
    <div className={css.renderer} data-diff-preview data-diff-eof={content.eof ? 'true' : 'false'} data-diff-total-rows={rows.length}>
      <div className={css.toolbar}>
        {visibleResult?.ok === false && <span role="status">{t('copyFailed')}</span>}
        <Button variant="toolbar" size="sm" onClick={copy} disabled={content.text.length === 0}>
          {visibleResult?.ok === true ? t('copied') : t(content.eof ? 'copy' : 'copyLoaded')}
        </Button>
      </div>
      <div className={css.body} ref={bindScrollport} data-diff-scrollport>
        <div className={css.rows} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const index = item.index
            const row = rows[index] as DiffRow
            const [old, next] = guttersOf(row)
            const file = files.get(index)
            const path = file?.actionRow === index ? file.newPath : undefined
            const address = path === undefined || fileAddress?.scope !== 'session' ? undefined : sessionFileAddress(fileAddress.sessionId, path)
            const openable = path !== undefined && address !== undefined && !tab.signal.aborted && canOpenFile(address)
            const spans = syntax.get(index)
            return (
              <div key={item.key} ref={virtualizer.measureElement} className={clsx(css.row, css.virtualRow, ROW_CLASS[row.type])}
                data-index={index} data-diff-index={index} data-diff-row={row.type} style={{ transform: `translateY(${item.start}px)` }}>
                <span className={css.gutter}>{old}</span>
                <span className={css.gutter}>{next}</span>
                <span className={css.marker}>{row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}</span>
                <span className={css.text}>
                  {openable ? (
                    <button type="button" className={css.fileLink} aria-label={t('openFile', { path })} onClick={() => {
                      if (!tab.signal.aborted && canOpenFile(address)) tab.actions.openResource(address)
                    }}>{row.text}</button>
                  ) : spans === undefined ? row.text : spans.map((span, token) => <span key={token} style={span.style}>{span.text}</span>)}
                </span>
              </div>
            )
          })}
        </div>
        {rows.length === 0 && <div className={css.row} data-diff-empty>{t('empty')}</div>}
      </div>
    </div>
  )
}
