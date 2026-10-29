/**
 * The About section: product identity and the host environment facts
 * (installation version, Chromium/Electron/Node, OS), read from `ctx.appInfo`
 * (the boot document's installation facts, provided by the client-modules
 * wrapper plugin).
 */
import type { AppInfo } from '@deepseek-ai/dsh-client-modules/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsKey } from './locales.ts'
import css from './AboutSection.module.css'

/** Injected dependencies of {@link AboutSection} (slot `inject`). */
export interface AboutSectionInjected {
  /** Installation facts from the boot document. */
  appInfo: AppInfo
}

/** Full component props: the section owner share, locale seat, and inject face. */
export type AboutSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings'> & Partial<AboutSectionInjected>

/**
 * Render the About section content column: one label/value row per fact, `—`
 * where the boot document carried none.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function AboutSection({ appInfo, t }: AboutSectionComponentProps) {
  const runtime = appInfo?.runtime
  const rows: ReadonlyArray<readonly [label: SettingsKey, value: string | undefined]> = [
    ['about.product', 'DeepSeek Harness'],
    ['about.version', appInfo?.version],
    ['about.kernel', runtime?.chrome],
    ['about.electron', runtime?.electron],
    ['about.node', runtime?.node],
    ['about.os', runtime?.os],
  ]
  return (
    <div className={css.section}>
      {rows.map(([label, value]) => (
        <div className={css.row} key={label}>
          <span className={css.title}>{t(label)}</span>
          <span className={css.value}>{value ?? '—'}</span>
        </div>
      ))}
    </div>
  )
}
