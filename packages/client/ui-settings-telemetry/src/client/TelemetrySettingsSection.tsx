/** The section 44 telemetry consent section: one independent switch per data kind. */

import { useEffect, useState, type ReactNode } from 'react'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type { TelemetryConsent, TelemetryDataKind } from '@deepseek-ai/dsh-session-telemetry'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './TelemetrySettingsSection.module.css'

/**
 * The five consent kinds in display order. The union authority is
 * `TelemetryDataKind`; the dictionary key set is derived from the same union,
 * so a kind added or renamed there fails this package's build until the row
 * and its copy follow.
 */
export const TELEMETRY_CONSENT_KINDS = [
  'sessionTelemetry',
  'providerMetadata',
  'relayMetadata',
  'deviceTrustMetadata',
  'crashDiagnostics',
] as const satisfies readonly TelemetryDataKind[]

/** Registration-side settings face used by the section. */
export interface TelemetrySettingsSectionInjected {
  /** When the Host-side owner applies committed consent changes. */
  readonly applies: SettingsNamespaceView['applies']
  /** Reactive consent scope; the renderer binds this member as `useConsent`. */
  readonly hooks: { consent: SettingsScope<TelemetryConsent> }
  /** Queue one kind's switch through the settings scope's revision-fenced write path. */
  set: (kind: TelemetryDataKind, value: boolean) => Promise<void>
}

/** Full component props assembled by the Settings slot renderer. */
export type TelemetrySettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.telemetry'>
  & InjectFace<TelemetrySettingsSectionInjected>

/** Per-kind local gesture state: a value means the kind's write is in flight. */
type KindFlags = Partial<Record<TelemetryDataKind, boolean>>

/**
 * Render the telemetry consent section. Switch positions derive only from the
 * scope snapshot: a write the Host refused (including a revision conflict)
 * never moves a switch — the re-read value stands and the row says so.
 * @param props - composed slot props.
 * @returns the section element tree, the loading line, or null when the namespace is gone.
 */
export function TelemetrySettingsSection(
  { t, applies, set, useConsent }: TelemetrySettingsSectionProps,
): ReactNode {
  const snapshot = useConsent(s => s)
  const [writing, setWriting] = useState<KindFlags>({})
  const [pending, setPending] = useState<KindFlags>({})
  const [notApplied, setNotApplied] = useState<KindFlags>({})

  // One settled gesture reports itself against the snapshot the write answer
  // or the recovery re-read published; the comparison never optimistically
  // moves the switch, so a refused write reads back as "did not take".
  useEffect(() => {
    const settled = (kind: TelemetryDataKind): boolean =>
      pending[kind] !== undefined && writing[kind] !== true
    if (!TELEMETRY_CONSENT_KINDS.some(settled)) return
    // Rebuilt key-by-key rather than deleted: the flags records stay small
    // and monomorphic across gestures.
    const nextPending: KindFlags = {}
    const nextNotApplied: KindFlags = {}
    for (const kind of TELEMETRY_CONSENT_KINDS) {
      if (settled(kind)) {
        nextNotApplied[kind] = (snapshot.value?.[kind] === true) !== (pending[kind] === true)
      } else {
        if (pending[kind] !== undefined) nextPending[kind] = pending[kind]
        if (notApplied[kind] !== undefined) nextNotApplied[kind] = notApplied[kind]
      }
    }
    setPending(nextPending)
    setNotApplied(nextNotApplied)
  }, [snapshot, pending, writing, notApplied])

  const requestWrite = (kind: TelemetryDataKind, value: boolean): void => {
    setWriting(current => ({ ...current, [kind]: true }))
    setPending(current => ({ ...current, [kind]: value }))
    setNotApplied(current => ({ ...current, [kind]: false }))
    // A write rejection never moves a switch; the settled-gesture comparison
    // reports the miss, so the rejection itself needs no second channel.
    void set(kind, value).catch(() => {}).finally(() => {
      setWriting((current) => {
        const next: KindFlags = {}
        for (const held of TELEMETRY_CONSENT_KINDS) {
          if (held !== kind && current[held] !== undefined) next[held] = current[held]
        }
        return next
      })
    })
  }

  if (snapshot.status !== 'ready') {
    return snapshot.status === 'unavailable' ? null : <p className={css.status}>{t('loading')}</p>
  }

  return (
    <section className={css.section} aria-label={t('title')}>
      <div className={css.heading}>
        <h3>{t('title')}</h3>
        <p className={css.subtitle}>{t('subtitle')}</p>
        {applies === 'restart' && <p className={css.restart}>{t('restartHint')}</p>}
      </div>
      <ul className={css.kinds}>
        {TELEMETRY_CONSENT_KINDS.map(kind => (
          <li key={kind} className={css.kind} data-kind={kind}>
            <div className={css.kindMain}>
              <span className={css.kindName}>{t(`kind.${kind}`)}</span>
              <Switch
                checked={snapshot.value?.[kind] === true}
                onChange={(next) => { requestWrite(kind, next) }}
                label={t(`kind.${kind}`)}
                disabled={!snapshot.writable || writing[kind] === true}
                title={snapshot.writable ? undefined : t('readonlyHint')}
              />
            </div>
            <p className={css.kindDesc}>{t(`desc.${kind}`)}</p>
            {notApplied[kind] === true && <p className={css.notice} role="alert">{t('writeNotApplied')}</p>}
          </li>
        ))}
      </ul>
    </section>
  )
}
