/** Unified-diff rendering: hunk headers and both line gutters with added/removed colouring. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button, writeClipboard, type HighlightSpan } from '@deepseek-ai/dsh-client-ui-primitives'
import { parseFileAddress, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { parseUnifiedDiff, type DiffRow } from './parse.ts'
import { splitRows, type SplitRow } from './split.ts'
import type { DocumentPreviewProps } from '../contract/document.ts'
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

/** A split half's own gutter number, change marker, and text; absent sides render blank. */
function splitSideCells(row: DiffRow | undefined): readonly [string, string, string] {
  if (row === undefined) return ['', ' ', '']
  if (row.type === 'context') return [String(row.oldLine), ' ', row.text]
  if (row.type === 'add') return [String(row.newLine), '+', row.text]
  if (row.type === 'del') return [String(row.oldLine), '-', row.text]
  return ['', ' ', '']
}

/** @param props - accumulated document contents and framework props. @returns the parsed unified diff, or no body for byte contents. */
export function DiffBody({
  resourceAddress, content, scrollportRef, useTabInfo, useGrammars, useFileOpeners, canOpenFile, t,
}: DiffBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const grammarVersion = useGrammars(value => value)
  useFileOpeners(value => value)
  const [view, setView] = useState<'unified' | 'split'>('unified')
  const rows = useMemo(() => content.kind === 'text' ? parseUnifiedDiff(content.text) : [], [content])
  const split = useMemo(() => view === 'split' ? splitRows(rows) : undefined, [rows, view])
  const files = useMemo(() => diffFiles(rows), [rows])
  const syntax = useMemo(() => highlightDiffRows(rows, files), [rows, files, grammarVersion])
  const fileAddress = parseFileAddress(resourceAddress)
  const scrollElement = useRef<HTMLDivElement | null>(null)
  const bindScrollport = useCallback((node: HTMLDivElement | null) => {
    scrollElement.current = node
    scrollportRef(node)
  }, [scrollportRef])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: split?.length ?? rows.length,
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
  const openableAt = (index: number): { readonly path: string; readonly address: string } | undefined => {
    const file = files.get(index)
    const path = file?.actionRow === index ? file.newPath : undefined
    const address = path === undefined || fileAddress?.scope !== 'session' ? undefined : sessionFileAddress(fileAddress.sessionId, path)
    return path !== undefined && address !== undefined && !tab.signal.aborted && canOpenFile(address) ? { path, address } : undefined
  }
  const renderSpans = (text: string, spans: readonly HighlightSpan[] | undefined): ReactNode =>
    spans === undefined ? text : spans.map((span, token) => <span key={token} style={span.style}>{span.text}</span>)
  return (
    <div className={css.renderer} data-diff-preview data-diff-view={view} data-diff-eof={content.eof ? 'true' : 'false'} data-diff-total-rows={rows.length}>
      <div className={css.toolbar}>
        {visibleResult?.ok === false && <span role="status">{t('copyFailed')}</span>}
        <Button variant="toolbar" size="sm" aria-pressed={view === 'split'} onClick={() => { setView(view === 'unified' ? 'split' : 'unified') }}>
          {t(view === 'unified' ? 'viewSplit' : 'viewUnified')}
        </Button>
        <Button variant="toolbar" size="sm" onClick={copy} disabled={content.text.length === 0}>
          {visibleResult?.ok === true ? t('copied') : t(content.eof ? 'copy' : 'copyLoaded')}
        </Button>
      </div>
      <div className={css.body} ref={bindScrollport} data-diff-scrollport>
        <div className={css.rows} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const index = item.index
            const row = split === undefined ? (rows[index] as DiffRow) : undefined
            const splitRow = split === undefined ? undefined : (split[index] as SplitRow)
            const unifiedIndex = row !== undefined ? index : splitRow?.type === 'pair' ? undefined : splitRow?.index
            const openable = unifiedIndex === undefined ? undefined : openableAt(unifiedIndex)
            const spans = unifiedIndex === undefined ? undefined : syntax.get(unifiedIndex)
            return (
              <div key={item.key} ref={virtualizer.measureElement}
                className={clsx(css.row, css.virtualRow, row !== undefined ? ROW_CLASS[row.type] : splitRow?.type === 'pair' ? undefined : ROW_CLASS[splitRow?.type ?? 'preamble'])}
                data-index={index} data-diff-index={index}
                data-diff-row={row?.type ?? splitRow?.type}
                style={{ transform: `translateY(${item.start}px)` }}>
                {row !== undefined && (
                  <>
                    <span className={css.gutter}>{guttersOf(row)[0]}</span>
                    <span className={css.gutter}>{guttersOf(row)[1]}</span>
                    <span className={css.marker}>{row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}</span>
                    <span className={css.text}>
                      {openable !== undefined ? (
                        <button type="button" className={css.fileLink} aria-label={t('openFile', { path: openable.path })} onClick={() => {
                          if (!tab.signal.aborted && canOpenFile(openable.address)) tab.actions.openResource(openable.address)
                        }}>{row.text}</button>
                      ) : renderSpans(row.text, spans)}
                    </span>
                  </>
                )}
                {row === undefined && splitRow?.type === 'pair' && (
                  <div className={css.splitRow}>
                    {([['old', splitRow.old, css.del], ['next', splitRow.next, css.add]] as const).map(([side, half, changeClass]) => {
                      const [gutter, marker, text] = splitSideCells(half?.source)
                      return (
                        <div key={side} className={clsx(css.splitHalf, half !== undefined && half.source.type !== 'context' ? changeClass : undefined)}
                          data-diff-side={side} data-diff-side-kind={half?.source.type ?? 'empty'}>
                          <span className={css.gutter}>{gutter}</span>
                          <span className={css.marker}>{marker}</span>
                          <span className={css.text}>{half === undefined ? '' : renderSpans(text, syntax.get(half.index))}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
                {row === undefined && splitRow !== undefined && splitRow.type !== 'pair' && (
                  <>
                    <span className={css.gutter}>{''}</span>
                    <span className={css.gutter}>{''}</span>
                    <span className={css.marker}>{' '}</span>
                    <span className={css.text}>
                      {openable !== undefined ? (
                        <button type="button" className={css.fileLink} aria-label={t('openFile', { path: openable.path })} onClick={() => {
                          if (!tab.signal.aborted && canOpenFile(openable.address)) tab.actions.openResource(openable.address)
                        }}>{splitRow.text}</button>
                      ) : renderSpans(splitRow.text, spans)}
                    </span>
                  </>
                )}
              </div>
            )
          })}
        </div>
        {rows.length === 0 && <div className={css.row} data-diff-empty>{t('empty')}</div>}
      </div>
    </div>
  )
}
