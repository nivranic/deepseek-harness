/**
 * The About section: product identity and the installation version, read
 * from `ctx.appInfo` (the boot document's installation facts, provided by the
 * client-modules wrapper plugin).
 */
import type { AppInfo } from '@deepseek-ai/dsh-client-modules/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
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
 * Render the About section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function AboutSection({ appInfo, t }: AboutSectionComponentProps) {
  const version = appInfo?.version
  return (
    <div className={css.section}>
      <div className={css.row}>
        <span className={css.title}>{t('about.product')}</span>
        <span className={css.value}>DeepSeek Harness</span>
      </div>
      <div className={css.row}>
        <span className={css.title}>{t('about.version')}</span>
        <span className={css.value}>{version ?? '—'}</span>
      </div>
    </div>
  )
}
