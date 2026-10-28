/** The §41 Host readiness section: the verdict line plus one row per health component. */

import { useEffect, useState, type ReactNode } from 'react'
import type { ComponentHealth, HealthSnapshot } from '@deepseek-ai/dsh-api-host-diagnostics/client'
import { StateDot, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { StateDotState, TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { HostStatusComponentName } from './locales.ts'
import css from './HostStatusSection.module.css'

/**
 * The six §41 health components in display order. The union authority is
 * `HealthSnapshot`; the dictionary key set derives from the same union, so
 * a component added or renamed there fails this package's build until the
 * row and its copy follow.
 */
export const HOST_STATUS_COMPONENTS = [
  'process',
  'runtime',
  'sessionStore',
  'pluginState',
  'connection',
  'modelProvider',
] as const satisfies readonly HostStatusComponentName[]

/** Registration-side Remote face used by the section. */
export interface HostStatusSectionInjected {
  /** Read one current §41 health snapshot from the Host. */
  readonly health: () => Promise<HealthSnapshot>
}

/** Full component props assembled by the Settings slot renderer. */
export type HostStatusSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.hostStatus'>
  & InjectFace<HostStatusSectionInjected>

type Translate = HostStatusSectionProps['t']

/** One read attempt of the Host health snapshot. */
type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: HealthSnapshot }

/* StateDotState's legal values are done, warning, ongoing, error, idle.
 * `ongoing` is the animated blue running ring reserved for live transitions
 * (the plugin inventory maps loading and unloading to it), so §41 `degraded`
 * — a settled partial failure — maps to the amber `warning` dot, the nearest
 * legal value; `up` is the green `done` dot and `down` the red `error` dot. */
const COMPONENT_DOT_STATES = {
  up: 'done',
  degraded: 'warning',
  down: 'error',
} as const satisfies Record<ComponentHealth, StateDotState>

/** Verdict tag palette; readiness is green, every other verdict asks for attention. */
const VERDICT_TAG_TONES = {
  ready: 'success',
  notReady: 'warning',
} as const satisfies Record<'ready' | 'notReady', TagTone>

/** Localized accessible name for one component state; StateDot itself is aria-hidden. */
function stateLabel(state: ComponentHealth, t: Translate): string {
  return t(`state.${state}`)
}

/**
 * Render the §41 Host readiness section. The verdict comes from the
 * snapshot verbatim — the Host derived it — followed by one row per health
 * component with its state dot and probe detail.
 * @param props - composed slot props.
 * @returns the section element tree, the busy loading line, or the error block with its retry button.
 */
export function HostStatusSection({ t, health }: HostStatusSectionProps): ReactNode {
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => health()).then(
      (snapshot) => { if (current) setState({ status: 'ready', snapshot }) },
      () => { if (current) setState({ status: 'error' }) },
    )
    return () => { current = false }
  }, [health, request])

  const retry = (): void => {
    setState({ status: 'loading' })
    setRequest(value => value + 1)
  }

  if (state.status === 'loading') {
    return <p className={css.status} aria-busy="true">{t('loading')}</p>
  }
  if (state.status === 'error') {
    return (
      <div className={css.failure}>
        <p role="alert">{t('error')}</p>
        <button type="button" onClick={retry}>{t('retry')}</button>
      </div>
    )
  }

  const { snapshot } = state
  const verdict = snapshot.ready ? 'ready' : 'notReady'
  return (
    <section className={css.section} aria-label={t('title')}>
      <div className={css.heading}>
        <h3>{t('title')}</h3>
        <p className={css.subtitle}>{t('subtitle')}</p>
      </div>
      <div className={css.verdict} data-host-ready={snapshot.ready ? 'true' : 'false'}>
        <Tag tone={VERDICT_TAG_TONES[verdict]}>{t(verdict)}</Tag>
      </div>
      <ul className={css.components}>
        {HOST_STATUS_COMPONENTS.map((name) => {
          const component = snapshot[name]
          const label = stateLabel(component.state, t)
          return (
            <li
              key={name}
              className={css.component}
              data-component={name}
              data-component-state={component.state}
            >
              <span className={css.componentDot} role="img" aria-label={label} title={label}>
                <StateDot state={COMPONENT_DOT_STATES[component.state]} />
              </span>
              <span className={css.componentName}>{t(`component.${name}`)}</span>
              <span className={css.componentDetail}>{component.detail}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
