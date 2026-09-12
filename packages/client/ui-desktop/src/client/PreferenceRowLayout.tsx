/** Shared title, description, and control layout for desktop preference rows. */

import type { ReactNode } from 'react'
import css from './CloseActionRow.module.css'

interface PreferenceRowLayoutProps {
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}

/**
 * Render the common desktop preference frame around one row-specific control.
 * @param props - localized copy and the row's control.
 * @returns the preference row.
 */
export function PreferenceRowLayout({ title, description, children }: PreferenceRowLayoutProps) {
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{title}</div>
        <div className={css.desc}>{description}</div>
      </div>
      {children}
    </div>
  )
}
