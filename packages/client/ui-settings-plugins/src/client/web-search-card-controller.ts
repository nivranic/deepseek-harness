/**
 * The web-search card's staged form over the `web-search-deepseek` settings
 * namespace.
 *
 * The key is the one control that does not live in the section: its literal
 * never rides a response, so the card learns only whether one is configured
 * and writes it through the credentials domain, addressed by the reference the
 * section names. It is still staged with the rest of the form, so one save
 * covers everything the card shows.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CardForm, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the DeepSeek search provider. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const WEB_SEARCH_NS = 'web-search-deepseek'

/** Credential reference the provider resolves when the section names none. */
const DEFAULT_API_KEY_REF = 'DEEPSEEK_API_KEY'

/** Form field the credential control stages under. */
const API_KEY_FIELD = 'apiKey'

/** The search-provider fields this card edits. */
export interface WebSearchSettings {
  /** Credential reference naming the environment key. */
  apiKeyEnv?: string
  /** Provider endpoint; blank inherits the provider default. */
  baseURL?: string
  /** Maximum searches served within one request. */
  maxUses?: number
}

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials/set` can affect it; false disables the control. */
  writable: boolean
}

/** What the web-search card renders. */
export interface WebSearchCardState extends CardShell {
  /** Provider endpoint. */
  baseURL: CardFieldState
  /** Searches allowed per request. */
  maxUses: CardFieldState
  /** The staged credential, which starts blank on every load. */
  apiKey: CardFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether this Host supports the credential metadata and write operations used by the field. */
  apiKeySupported: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
}

/** The registration-side face the web-search card's slot entry injects. */
export interface WebSearchCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useWebSearchCard. */
    webSearchCard: SnapshotStore<WebSearchCardState>
  }
}

/** Bridges the `web-search-deepseek` scope and the credentials domain onto the card. */
export class WebSearchCardController {
  private readonly form: CardForm<WebSearchSettings>
  private readonly store: SnapshotStore<WebSearchCardState>
  private credential: CredentialState = { ref: '', configured: false, writable: false }
  private readonly host: ClientContext['remote']['$host']
  private readonly stopScope: () => void
  private readGeneration = 0
  private disposed = false

  /**
   * @param scope - the bound settings scope for the `web-search-deepseek` namespace.
   * @param ctx - the card plugin's context, whose `remote.credentials` namespace
   * answers for the credential the section references.
   */
  constructor(
    private readonly scope: SettingsScope<WebSearchSettings>,
    private readonly ctx: ClientContext,
  ) {
    this.host = ctx.remote.$host
    this.form = new CardForm(
      scope,
      [textField('baseURL'), numberField('maxUses')],
      [{ field: API_KEY_FIELD, write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    this.stopScope = scope.subscribe(() => { void this.readCredential() })
    void this.readCredential()
  }

  private projection(): WebSearchCardState {
    return {
      ...this.form.shell(),
      baseURL: this.form.field('baseURL'),
      maxUses: this.form.field('maxUses'),
      apiKey: this.form.field(API_KEY_FIELD),
      apiKeyConfigured: this.credential.configured,
      apiKeySupported: this.supportsWrite(),
      apiKeyWritable: this.credential.writable,
    }
  }

  /**
   * Ask the credentials domain about the reference the section currently names.
   *
   * The answer is stored with the reference it describes: `apiKeyEnv` can
   * change between the request and its response, and two reads can settle out
   * of order, so only the latest response from the bound Host can publish
   * while it still answers for the reference in force.
   */
  private async readCredential(): Promise<void> {
    const generation = ++this.readGeneration
    if (!this.canRead()) {
      this.credential = { ref: '', configured: false, writable: false }
      this.store.set(this.projection())
      return
    }
    const ref = refOf(this.scope.getSnapshot())
    if (ref !== this.credential.ref) {
      // A new reference knows nothing yet; keeping the old answer would claim
      // the key is configured under a name nobody has checked.
      this.credential = { ref, configured: false, writable: false }
      this.form.reset()
      this.store.set(this.projection())
    }
    const response = await this.ctx.remote.credentials.describe([ref])
    if (!response.ok || generation !== this.readGeneration || !this.canRead() || ref !== refOf(this.scope.getSnapshot())) return
    const view = response.value[ref]
    const next: CredentialState = {
      ref,
      configured: view?.configured ?? false,
      writable: this.supportsWrite() && view?.writable === true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to the reference this card watches.
   *
   * A key can be written from somewhere else — the Models page addresses the
   * same reference — and the settings section does not change when it is, so
   * without this the badge keeps reporting a state the Host already replaced.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): WebSearchCardFace {
    const actions = this.form.actions()
    return {
      hooks: { webSearchCard: this.store },
      edit: (field, text) => {
        if (!this.current() || this.scope.getSnapshot().status !== 'ready') return
        if (field === API_KEY_FIELD ? !this.credential.writable : !this.scope.getSnapshot().writable) return
        actions.edit(field, text)
      },
      resetField: (field) => {
        if (this.current() && this.scope.getSnapshot().writable) actions.resetField(field)
      },
      save: () => { if (this.current()) actions.save() },
      discard: () => { if (this.current()) actions.discard() },
    }
  }

  /** Release observers and discard drafts; retained callbacks cannot act on another Host. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.readGeneration += 1
    this.stopScope()
    this.credential = { ref: '', configured: false, writable: false }
    this.form.dispose()
  }

  private current(): boolean {
    return !this.disposed && this.host === this.ctx.remote.$host
  }

  private canRead(): boolean {
    return this.current() && this.scope.getSnapshot().status === 'ready'
      && this.host.capabilities?.includes('settings.read.v1') === true
      && this.host.capabilities.includes('credentials.describe.v1')
  }

  private supportsWrite(): boolean {
    return this.canRead() && this.host.capabilities?.includes('credentials.write.v1') === true
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    if (!this.supportsWrite() || !this.credential.writable) return false
    const ref = refOf(this.scope.getSnapshot())
    if (this.credential.ref !== ref) return false
    const response = await this.ctx.remote.credentials.set(ref, value)
    if (!response.ok || !this.canRead() || ref !== refOf(this.scope.getSnapshot())) return false
    await this.readCredential()
    return this.canRead() && ref === this.credential.ref && this.credential.configured
  }
}

/**
 * The credential reference the section names, or the provider's default.
 * @param snapshot - the current scope snapshot.
 * @returns the reference to address.
 */
function refOf(snapshot: SettingsScopeSnapshot<WebSearchSettings>): string {
  const declared = snapshot.value?.apiKeyEnv
  return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF
}
