/** Composer takeover for one pending approval waterfall. */
import { useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ApprovalComposerProps, PendingApproval } from './contract/slots.ts'
import css from './ApprovalPanel.module.css'

/**
 * Render one pending approval, its fact block, and its optional Tool-owned detail.
 * @param props - selector-matched request and standard Slot props.
 * @returns The approval composer takeover.
 */
export function ApprovalPanel(props: ApprovalComposerProps) {
  const approval = props.matched
  const host = props.useHostFacts(value => value)
  const workspaces = props.useWorkspaces(value => value)
  const workspace = workspaces.items.find(item => item.sessionIds.includes(props.sessionId))
  const detail = approval.callId === undefined
    ? null
    : props.renderSlot('conversation.approval.detail', { callId: approval.callId })
  return (
    <ApprovalFlow
      key={approval.key}
      pending={approval}
      host={host === undefined ? undefined : host.descriptor?.displayName ?? host.platform}
      workspace={workspace?.title}
      detail={detail}
      t={props.t}
    />
  )
}

function ApprovalFlow({ pending, host, workspace, detail, t }: {
  pending: PendingApproval
  host: string | undefined
  workspace: string | undefined
  detail: ReactNode
  t: ApprovalComposerProps['t']
}) {
  const [answered, setAnswered] = useState(false)
  const answer = (outcome: 'allowed-once' | 'rejected'): void => {
    setAnswered(true)
    void pending.answer(outcome).catch(() => { setAnswered(false) })
  }
  // Specification §38: a dangerous operation never shows a bare "allow?" —
  // every fact row that has data is named beside the decision.
  const facts = ([
    [t('fact.operation'), pending.toolName],
    [t('fact.host'), host ?? ''],
    [t('fact.workspace'), workspace ?? ''],
    [t('fact.risk'), pending.risk === undefined ? '' : t(`risk.${pending.risk}`)],
    [t('fact.escalation'), pending.reason ?? ''],
  ] as readonly (readonly [string, string])[]).filter(([, value]) => value !== '')
  return (
    <div className={css.root} data-approval-key={pending.key}>
      <div className={css.card}>
        <div className={css.strip}><span className={css.dot} />{t('waiting')}</div>
        <div
          className={css.body}
          data-approval-scroll=""
          tabIndex={0}
          role="group"
          aria-label={t('detail.aria')}
        >
          <div className={css.headline}>{t('escalation', { toolName: pending.toolName })}</div>
          {facts.length > 0 && (
            <dl className={css.facts} data-approval-facts="">
              {facts.map(([label, value]) => (
                <div key={label} className={css.factRow}>
                  <dt className={css.factLabel}>{label}</dt>
                  <dd className={css.factValue}>{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {detail !== null && (
            <div className={css.command}>
              <div className={css.factLabel}>{t('fact.preview')}</div>
              {detail}
            </div>
          )}
        </div>
        <div className={css.actionRow}>
          <Button variant="outline" className={css.reject} disabled={answered} onClick={() => { answer('rejected') }}>
            {t('reject')}
          </Button>
          <Button variant="primary" disabled={answered} onClick={() => { answer('allowed-once') }}>
            {t('allowOnce')}
          </Button>
        </div>
      </div>
    </div>
  )
}
