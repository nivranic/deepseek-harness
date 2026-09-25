# Agent Note: Host selection observation and bookmark ownership

Status: implemented

English | [中文](2026-09-25-host-selection-observation.zh.md)

## Problem

Host selection can change without an established connection or a roster update. A Settings view that refreshes only after its own actions cannot reflect those changes. Recording the page origin after a remote selection also associates the admitted Host identity with the wrong endpoint.

## Decision

Connection owns an observable selected origin independently of its admitted generation. Retargeting validates the new origin, retires the current attempt and then publishes changed selection. Settings consumes the target and roster through framework selector hooks. A selection marker makes no authentication or readiness claim. Admitted browser generations record the selected endpoint; injected carriers remain in-process records.

The roster is a bookmark collection. Forgetting a selected bookmark clears its persisted selection but leaves the active connection running. Restricted or full browser storage cannot prevent in-memory selection. Restored bookmarks validate their origins before becoming routable targets.

Cross-origin rows explain authorization and link to the Host page without storing launch credentials. First-time authorization requires the target Host’s current launch link. The [browser authentication decision](2026-08-24-browser-token-authentication.md) retains token and cookie ownership; the [Host descriptor decision](2026-09-16-host-description-and-capabilities.md) retains admission and operation-capability ownership.

Selection actions and persistence belong to the injected Connection service. Settings imports its types and delegates to `selectSavedHost`, `usePageHost` and `forgetSavedHost`. This preserves the feature-package rule against importing another plugin’s Client runtime and keeps storage policy at the same owner as boot selection.

## Alternatives considered

**Refresh the selected origin on roster notifications or explicit refresh.** Selection may precede admission or fail to connect, leaving no roster event to refresh the view. An independently observed target represents the user’s choice at that point.

**Disconnect when forgetting the selected bookmark.** Bookmark removal does not revoke authorization or express a request to interrupt active work. Returning to the page Host remains a separate action.

**Treat a page link as an authorization link.** The saved origin contains no launch credential. Claiming it authorizes the browser would misrepresent the existing authentication protocol.

**Import Connection runtime helpers from Settings.** Declaring that runtime as a loader external can make a build resolve while still violating feature-package composition rules. Injected service methods provide the existing operations without a second runtime import or duplicated persistence policy.

## Consequences

Settings reflects external selections without polling and keeps bookmark actions separate from connection lifetime. A selection can remain visible while authentication or transport establishment fails. Cross-origin authorization guidance does not establish browser trust, CORS support or physical-platform interoperability.

Connection tests cover endpoint recording, observer ordering and containment, invalid origins and unavailable storage. Settings tests cover framework subscriptions, selection persistence and forgetting without disconnecting. The browser scenario owns the rendered selection and authorization-guidance snapshot; physical-platform and cross-origin connection acceptance remain separate.
