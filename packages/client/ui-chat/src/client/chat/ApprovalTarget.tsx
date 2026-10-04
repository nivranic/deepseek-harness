/** Chat-owned approval target resolving a correlated Tool call's subject argument. */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import type { ChatNode } from '../contract/chat-nodes.ts'

interface ApprovalToolCall {
  readonly callId: string
  readonly argsRaw: string
}

/**
 * Extract the correlated Tool call's subject — the shell `command` or the
 * filesystem `path` its arguments carry.
 * @param call - Tool call arguments, when a correlated call exists.
 * @returns target text, or undefined for absent, malformed, or unrelated arguments.
 */
export function targetOf(call: ApprovalToolCall | undefined): string | undefined {
  if (call === undefined) return undefined
  try {
    const args = JSON.parse(call.argsRaw) as Record<string, unknown>
    if (typeof args.command === 'string') return args.command
    return typeof args.path === 'string' ? args.path : undefined
  } catch {
    return undefined
  }
}

/**
 * Render the target of the Chat Tool node correlated with an approval.
 * @param props - Approval identity and Session-standard Chat selector hook.
 * @returns target text when the correlated call carries a command or path.
 */
export function ApprovalTarget({ callId, useChat }: PropsRuntime<'conversation.approval.target'>) {
  const target = useChat((snapshot) => {
    for (const node of snapshot.nodes.values()) {
      const root = node.kind === 'tool-call' ? (node as ChatNode<'tool-call'>).data.root : undefined
      if (root !== undefined && root.callId === callId && !('kind' in root)) return targetOf(root)
    }
    return undefined
  })
  return target ?? null
}
