# Agent Note: Section 10 phone-tier header overflow menu

Status: implemented

English | [中文](2026-10-03-header-overflow.zh.md)

## Problem

The section 10 phone wireframe ends its top bar with a ⋮ affordance. The phone-top-bar increment shipped the leading seat, the back-to-Sessions control, and the running-location chip's status dot, but left the overflow menu open on the honest grounds that "its entries depend on a toolbar set that does not exist yet". That blocker was self-coined: no section of the 81-section specification defines ⋮ entries anywhere — the wireframe shows the affordance and nothing more.

## Decision

- The entries question is resolved by aggregation, not fabrication: the ⋮ menu carries the header's two existing secondary lists — `conversation.session.header.actions` and `conversation.session.header.utilities` — which is the only reading with a real control inventory behind it (today: agent preset, jobs, schedule in actions; open-in-app in utilities).
- The ⋮ is the strict header's own phone-tier layout decision, not a new seat: `ConversationSessionHeader` consults `usePhoneTier()` (a `matchMedia('(max-width: 599.5px)')` subscription — the same tier every phone-only affordance in the shell already uses, e.g. the leading back button and the drawer opener) and renders the two lists either inline (wide tier, unchanged markup) or inside `HeaderOverflowMenu` (phone tier). Each list renders exactly once in exactly one container; there is no duplicate mount.
- Placement ruling: the running-location chip stays inline in the bar (section 10 mandates the prominent running-location display and the wireframe shows `Host ●` inline), and the far-right corner keeps its single occupant (the right-sidebar ExpandButton) — the ⋮ trigger sits at the utilities row's end, adjacent to the chip exactly as the wireframe draws `Host ● ⋮`. Displacing the corner occupant or burying the chip were both rejected.
- The trigger renders whenever the phone-tier header renders (the wireframe shows it unconditionally); the portaled panel follows the `ScheduleCatalogAction` recipe (`useAnchoredPosition` + `useDismissOnOutsidePointer` + Escape returning focus to the trigger) and names a localized empty line while neither list renders anything.
- One new hand-authored glyph (`IconOverflowVertical16`) joins the primitives icon set per the existing hand-authored product-glyph practice; two locale keys (`session.overflow.aria` / `session.overflow.empty`) land in both dictionaries.

## Alternatives considered

- **Waiting for a real "toolbar collection":** the pointer named no section and no control inventory; waiting on it blocks a wireframe affordance indefinitely.
- **A new `header.overflow` seat:** the overflow is a layout decision of the header's owner, not a new control registration point; the existing seats keep their owners.
- **CSS-only collapsing:** media queries cannot move mounted elements between containers, and rendering the lists twice (inline + panel) would double-mount stateful occupants.

## Consequences

- Phone-tier users get every header control in one fixed place; wide-tier markup is byte-identical to before (the wide tier is also the default when `matchMedia` is absent, e.g. node e2e boots).
- Occupants of the two lists render inside the portaled panel without changes; nothing outside `ui-conversation` and the icon set changed.

## Open work

- Full size/theme/state/accessibility matrices, iOS/Android real-device input, background and native attachment acceptance stay open for section 10; the ⋮ panel's pointer ergonomics on touch devices are covered only by the shared anchored-panel machinery, not device lanes.
