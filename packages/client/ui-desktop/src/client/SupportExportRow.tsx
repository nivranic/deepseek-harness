/** User-triggered local diagnostics export through the desktop Gateway. */
import { useEffect, useRef, useState } from 'react'
import type { DesktopSupportResult } from '@deepseek-ai/dsh-host-electron-ipc/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PreferenceRowLayout } from './PreferenceRowLayout.tsx'
import css from './SupportExportRow.module.css'

/** Native export operation injected by the desktop plugin registration. */
export interface SupportExportRowInjected {
  /** Request one scanned local export and return its saved, cancelled or refused outcome. */
  exportSupport: () => Promise<DesktopSupportResult>
}

/** Composed General-settings slot props. */
export type SupportExportRowProps = PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.desktop'> & InjectFace<SupportExportRowInjected>

/**
 * Render the local export action and its outcome without displaying host paths or native errors.
 * @param props - localized slot props and the native export callback.
 * @returns the diagnostics preference row.
 */
export function SupportExportRow({ exportSupport, t }: SupportExportRowProps) {
  const [state, setState] = useState<DesktopSupportResult | { readonly status: 'working' }>()
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const run = (): void => {
    setState({ status: 'working' })
    void exportSupport().then(
      (result) => { if (mounted.current) setState(result) },
      () => { if (mounted.current) setState({ status: 'failed', reason: 'unavailable' }) },
    )
  }
  const message = state === undefined ? undefined
    : state.status === 'saved' ? t('supportSaved')
      : state.status === 'cancelled' ? t('supportCancelled')
        : state.status === 'busy' ? t('supportBusy')
          : state.status === 'working' ? t('supportWorking')
            : state.reason === 'unavailable' ? t('supportUnavailable') : t('supportRejected')
  return (
    <PreferenceRowLayout title={t('supportTitle')} description={t('supportDescription')}>
      <div className={css.actions}>
        <button type="button" className={css.button} data-support-export disabled={state?.status === 'working'} onClick={run}>
          {t('supportExport')}
        </button>
        {message !== undefined && <p role="status" className={css.status} data-support-result={state?.status}>{message}</p>}
      </div>
    </PreferenceRowLayout>
  )
}
