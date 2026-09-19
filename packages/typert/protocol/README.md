---
description: "The shared Typert Remote protocol: decorators, wire descriptors, codecs, and provider contracts used by business packages, generated artifacts, the Host Gateway, and the Client API."
kind: "package-library"
---

# @deepseek-ai/dsh-typert-protocol

English | [中文](README.zh.md)

## Summary

With `dsh-typert-protocol`, business packages can expose Host methods to Remote clients: mark a method with `@Remote` (or `@RemoteScope` for scoped receivers), bind the service to a wire namespace, and associate Host objects and scoped Contexts with wire identities through the merge-extensible protocol maps. Generated artifacts, the Host Gateway, and the Client API consume the same invocation descriptors, codecs, and provider contracts, so one declaration set stays in sync across every face. The package registers no Cordis service and runs no TypeScript analysis; it declares types and decorator markers only.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

This package is for business-package and assembly maintainers who expose Host capabilities to Remote clients. It is a declarations library: mark methods, bind services, and let the generated pipeline and the Gateway do the rest.

### Exposing a Host method

A business package marks a public instance method with `@Remote` (or `@RemoteScope(key)` when the receiver comes from a scoped Context), and the owning service either extends `TypertRemoteService` or declares a `typertRemote` binding through `bindTypertRemote()`:

```text
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export class GoalService extends TypertRemoteService {
  @Remote
  async create(agentId: string, objective: string): Promise<GoalResult> {
    ...
  }
}
```

Generation turns the method into a wire endpoint under the service's namespace; Clients call it as a typed method through `ctx.remote` (see the [API Gateway reference](../../../docs/api-gateway.md)). A method opts into cooperative cancellation by declaring `signal: AbortSignal` as its final parameter — the signal is injected, never a JSON parameter or lookup field.

`bindTypertRemote` and `TypertRemoteService` accept explicit `capabilities` declarations beside `namespace`. Each versioned id names the exported methods required from that owner. The [Gateway](../../api/gateway/README.md) reads their current availability; declarations do not grant caller permissions or infer capabilities from names.

### Associating Host objects and Contexts with wire identities

Complex Host objects cannot cross the wire directly. A business package declares the association through the merge-extensible `TypertLookupMap` and `TypertContextMap`. A Host Context adapter owns the stable wire declaration and resolves wire identities to live Contexts. A Client Context adapter maps in both directions because scoped calls originate from a Client Context and forwarded Host events resolve their explicit wire identity there. Host composition may override its synchronous or asynchronous resolver. A resolver that refuses on policy grounds throws `RemoteError` with its own code, which reaches the caller unchanged.

### Reporting and reading a Remote failure

One class carries every Remote failure: `RemoteError`, holding a stable `<domain>/<reason>` code and the details typed for that code. This package declares the universal carrier codes (`gateway/bad-request`, `gateway/cancelled`, `gateway/internal`) and owns `RemoteErrorDetailsMap`, the merge-extensible table every other package extends beside its own throwing code:

```text
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requested Goal is unavailable. */
    'goal/not-found': { readonly goalId: string }
  }
}
throw new RemoteError('goal/not-found', `goal "${id}" does not exist`, { goalId: id })
```

An owner throws at the failure point; no package writes an error-class family or an exit-mapping function. A caller discriminates by `code` — never by `instanceof` — and a `code` branch narrows `details` with no cast, because `RemoteFailure` is the code-discriminated union of `RemoteError` instances. Infrastructure that must recognize a failure carried across a module or realm copy of the class calls `remoteErrorOf(value)`, which reads a structural marker instead of the prototype chain.

The exported [known-code JSON Schema](remote-error-codes.schema.json) lists this package build's finite repository-owned vocabulary with each owner's JSDoc meaning and source declaration. Regenerate it with `pnpm run gen-remote-error-codes`; `verify-remote-error-codes`, `test:docs` and `doc-sync` reject stale output, duplicate owners, undocumented codes and unbounded declarations. It recognizes code strings only: the TypeScript details annotation is not a JSON Schema for payload validation. Unknown codes from newer Hosts or external plugins remain opaque diagnostics; preserve code, message and details without inferring recovery or permissions. Schema membership does not imply that a capability is mounted.

The [Remote failure JSON Schema](remote-errors.schema.json) validates `code`, `message` and object `details`. Known codes select their generated details schema; unknown codes retain opaque object diagnostics, and a malformed known code cannot use that fallback. Input validation accepts extension fields and does not alter the original diagnostic. Regenerate with `pnpm run gen-remote-error-envelope`; `verify-remote-error-envelope` in `doc-sync` verifies the independent inventory, resolved details roots, cross-face agreement and artifact freshness. See [the generator API](../generator/README.md#analyzing-a-workspace-statically). Tuple details fail generation because the current converter omits tuple cardinality. Consumers need a complete draft-2020-12 validator, including `not`; Zod’s reverse JSON Schema conversion does not support that keyword.

`classifyRemoteFailureCode(code)` — or `classifyRemoteFailure(error)` for a caught value — maps a code onto the closed `RemoteFailureClass` presentation semantics shared by every Client: `authentication`, `permission`, `host-state`, `compatibility`, `carrier-invalid`, `transport`, `conflict`, `unavailable`, `invalid-input`, and `unknown`. The classification lists only codes with agreed cross-Client meaning; the merge-extensible vocabulary deliberately leaves the rest, including every future code, as `unknown`, presented as an opaque diagnostic without inferring recovery or permissions. The repository `verify-remote-error-envelope` gate rejects a classification that references codes missing from the declared inventory.

`gateway/bad-request` carries optional `RemoteValidationIssue` entries with `code`, `message`, and `path` (string keys or numeric indices). Owners use `remoteValidationIssues` to copy those fields from validator output; symbol path keys become diagnostic strings. Validator-specific metadata and input values are omitted. Diagnostic messages remain owner-authored and are not redacted by this helper.

### Receiving forwarded Host events on the Client

The Host assembly extends `TypertRemoteEventSelection` with the Cordis events it forwards to consumers, which narrows the `ctx.remote.$on` key set. `TypertForwardableEvent` accepts unscoped `void` notifications and scoped async waterfalls whose final `next()` callback returns the event's result type. `TypertClientEventListener` derives the Client listener from that same `Events` member while preserving signals, optional and readonly fields, arrays, callbacks, and result types. `TypertClientRemote` exposes only `$mount()` and `$on()`; event transport remains private to Gateway.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the declarations stay compiler-independent and where each contract is enforced; the programming model is covered in [Use this package](#use-this-package).

### Design concept

The package keeps strict reflection in the compiler: decorator initializers retain minimal markers in a versioned descriptor on the Service prototype. The descriptor uses a stable string property name, so another installed copy of the protocol package can read the same markers. Full parameter, result, lookup, and schema reflection is the Typert build pipeline's job, delivered through `InvocationDescriptor`.

### Remote markers

`@Remote` and `@RemoteScope` schedule an initializer that appends the method name, an optional export name, and the invocation mode to the prototype descriptor; `remoteMethods(service)` validates its version and returns a detached declaration-order snapshot that the Gateway's source-mode fallback reads. Markers require public, non-static instance methods with string names, and conflicting markers on one method are rejected.

### Protocol maps and descriptors

The merge-extensible protocol maps keep static associations in the type system, while runtime providers register resolution with `ctx.typert`; the map names and shapes live in [`src/types.ts`](src/types.ts). `InvocationDescriptor` is the shared runtime form consumed by the registry, the Gateway, and the Client Remote, covering direct and Context receivers, JSON and lookup parameters, scope projections, cancellation, and result codecs.

### Wire identity grammar

Every namespace, method, lookup, and Context segment must satisfy `isTypertRemoteSegment()`, so generated names cross the shared RPC carrier unchanged. Strict codecs carry generated schemas; `src-json` codecs identify the weaker source-launch path.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Decorators, Gateway bindings, `remoteMethods`, segment validation |
| [`src/remote-error.ts`](src/remote-error.ts) | `RemoteError` and the structural `remoteErrorOf` recognizer |
| [`src/failure-classes.ts`](src/failure-classes.ts) | `RemoteFailureClass`, `classifyRemoteFailure*`, and the inventory-verified classification map |
| [`src/types.ts`](src/types.ts) | Protocol maps, `RemoteErrorDetailsMap`, `RemoteResult`, `InvocationDescriptor`, codecs, provider contracts, registry interfaces, `TypertClientRemote` |
| — | No runtime invariant companion is published; decorators retain private immutable declarations and bindings are frozen values with no independent event stream to cross-check. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough; they move from the declarations to the runtime and the call path.

- [API Gateway reference](../../../docs/api-gateway.md) — how the declarations become running Host-to-Client calls.
- [Typert subsystem reference](../../../docs/subsystems/typert.md) — the literal public contracts recorded from protocol and Gateway types.
- [Typert registry](../registry/README.md) — where descriptors and providers are stored at runtime.
- [Typert generator](../generator/README.md) — what generates the consumer-side declarations and descriptors.
- [Remote-call Agent Note](../../../.agents/notes/implemented/architecture/2026-08-02-typert-remote-method-calls.md) — the architecture and transport decisions behind Remote calls.

-----

<a id="model-experience"></a>
## Model Experience

None, as compiler-independent Remote protocol declarations register nothing model-facing.

#### KV Cache effect

No direct effect; the declared contracts reach a request only when an assembly places them in one.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the declarations can represent; they are current package constraints, not a task backlog.

- **Decorator markers are minimal** — markers contain only the method name and the direct or Context invocation mode; parameter, result, lookup, and schema reflection require the Typert build pipeline.
- **Remote signatures are restricted** — decorators accept only public, non-static instance methods with string names, and source-mode execution cannot represent overloaded, destructured, defaulted, or rest-parameter signatures.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
