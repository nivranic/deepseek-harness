/** Binary fact card: byte count and a bounded hex window; never a decode attempt. */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { formatByteCount, hexRowsOf, MAX_PREVIEW_BYTES } from './bytes.ts'
import type { DocumentPreviewProps } from '../document/contract.ts'
import type {} from './locales.ts'
import css from './BinaryBody.module.css'

/** Document owner props and this renderer's localized controls. */
export type BinaryBodyProps = DocumentPreviewProps & PropsLocale<'sidebarBinaryPreview'>

/** @param props - complete document bytes and framework props. @returns the fact card, or no body for text contents. */
export function BinaryBody({ content, scrollportRef, t }: BinaryBodyProps): ReactNode {
  const rows = useMemo(() => content.kind === 'bytes' ? hexRowsOf(content.data) : [], [content])
  if (content.kind !== 'bytes') return null
  const size = content.data.byteLength
  return (
    <div className={css.renderer} data-binary-preview data-binary-bytes={size} ref={scrollportRef}>
      {size === 0
        ? <p className={css.empty} data-binary-empty>{t('emptyFile')}</p>
        : (
          <>
            <p className={css.heading}>
              {t('binaryFile')} · {t('bytes', { count: formatByteCount(size) })}
              {size > MAX_PREVIEW_BYTES ? ` · +${formatByteCount(size - MAX_PREVIEW_BYTES)}` : ''}
            </p>
            {rows.map(row => (
              <div key={row.offset} className={css.hexRow} data-binary-hex-row={row.offset}>
                <span className={css.offset}>{row.offset.toString(16).padStart(8, '0')}</span>
                <span className={css.cells}>{row.cells.join(' ')}</span>
              </div>
            ))}
          </>
        )}
    </div>
  )
}
