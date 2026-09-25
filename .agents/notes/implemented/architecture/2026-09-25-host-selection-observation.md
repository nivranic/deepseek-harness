# Agent Note: Host selection observation and bookmark ownership

Status: implemented

English | [中文](2026-09-25-host-selection-observation.zh.md)

## Problem

Host selection can change without an established connection or a roster update. A Settings view that refreshes only after its own actions cannot reflect those changes. Recording the page origin after a remote selection also associates the admitted Host identity with the wrong endpoint.

## Decision

Connection owns an observable selected origin independently of its admitted generation. Retargeting validates the new origin, retires the current attempt and then publishes changed selection. Settings consumes the target and roster through framework selector hooks. A selection marker makes no authentication or readiness claim. Admitted browser generations record the selected endpoint; injected carriers remain in-process records.

The roster is a bookmark collection. Forgetting a selected bookmark clears its persisted selection but leaves the active connection running. Restricted or full browser storage cannot prevent in-memory selection. Restored bookmarks validate their origins before becoming routable targets.

Cross-origin rows offer a separate Host page without launch credentials or an in-page switch. The target page can still require its current launch link; that grants no cross-origin access to the original page. Served-Web `selectSavedHost` refuses cross-origin bookmarks without changing the connection or storage, and boot clears unusable persisted selections while retaining bookmarks. Low-level retargeting remains available to explicit carrier compositions. The [browser trust decision](2026-07-28-api-browser-trust-boundary.md) and [browser authentication decision](2026-08-24-browser-token-authentication.md) retain Origin checks and cookie ownership; page authorization does not replace Remote Device Trust.

Selection actions and persistence belong to the injected Connection service. Settings imports its types and delegates to `selectSavedHost`, `usePageHost` and `forgetSavedHost`. This preserves the feature-package rule against importing another plugin’s Client runtime and keeps storage policy at the same owner as boot selection.

## Alternatives considered

**Refresh the selected origin on roster notifications or explicit refresh.** Selection may precede admission or fail to connect, leaving no roster event to refresh the view. An independently observed target represents the user’s choice at that point.

**Disconnect when forgetting the selected bookmark.** Bookmark removal does not revoke authorization or express a request to interrupt active work. Returning to the page Host remains a separate action.

**Treat a page link as an authorization link.** The saved origin contains no launch credential. Claiming it authorizes the browser would misrepresent the existing authentication protocol.

**Import Connection runtime helpers from Settings.** Declaring that runtime as a loader external can make a build resolve while still violating feature-package composition rules. Injected service methods provide the existing operations without a second runtime import or duplicated persistence policy.

## Consequences

Settings reflects external selections without polling and separates bookmark actions from connection lifetime. Local Web refuses cross-origin CORS preflight even after the browser independently authorizes both Hosts. Separate-page access preserves that defense; native Remote access and physical-platform acceptance remain separate.

Connection tests cover endpoint recording, observer containment, unavailable storage and same-origin versus cross-origin selection recovery. Settings covers framework subscriptions and bookmark actions; the real two-Host browser scenario confirms preflight remains 403 after independent authorization and an unusable persisted selection cannot block page-Host recovery.
