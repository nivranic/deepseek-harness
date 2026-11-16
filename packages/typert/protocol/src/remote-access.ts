/**
 * Resources of Remote access control: identity-less `global` and `host`,
 * and identities of kinds declared in `TypertResourceMap`. A `host` binding
 * explicitly grants its actions across resources; other bindings remain independent.
 * @module @deepseek-ai/dsh-typert-protocol/remote-access
 */

/* oxlint-disable typescript/no-redundant-type-constituents --
 * `TypertResourceKind` is the declare-merge key pattern: the resource map is
 * empty in this compilation unit, so the rule sees `never`, while every
 * domain that declares a kind merges its key in. */
import type {
  TypertResourceId,
  TypertResourceKind,
  TypertResourceMap,
} from './types.ts'

/** One resource kind: a built-in kind or a declared kind. */
export type RemoteAccessResourceKind = 'global' | 'host' | TypertResourceKind

/**
 * A binding target or a resource touched by a call or forwarded event.
 * `host` is an explicit Host-wide binding target; `global` names operations
 * without a domain resource. Domain identities are wire values read before lookup.
 */
export type RemoteAccessResource =
  | { readonly kind: 'global' }
  | { readonly kind: 'host' }
  | {
    [Kind in TypertResourceKind]: { readonly kind: Kind; readonly id: TypertResourceId<TypertResourceMap[Kind]> }
  }[TypertResourceKind]

/**
 * The resource variant of one kind; built-in kinds carry no identity.
 * @template K - the resource kind to select.
 */
export type RemoteAccessResourceOf<K extends RemoteAccessResourceKind> = Extract<RemoteAccessResource, { readonly kind: K }>
