# Agent Note: Phone tier renders the sidebar as an overlay drawer

Status: implemented

English | [中文](2026-09-20-phone-tier-overlay-drawer.zh.md)

## Problem

Specification §7 requires that below 600px the sidebar stop occupying a grid track: the conversation spans the full width, and navigation reaches the user as an overlay drawer. The frame instead kept the 56px collapsed rail on every tier, so a 375px viewport ran the conversation at ~319px with the rail permanently bolted to its left edge, and expanding the sidebar squeezed content further.

## Current upstream boundary

A live chrome-devtools matrix over the shipped web UI (four tiers at 375/720/960/1440 plus the 599/600 boundary; log and screenshots in `.artifacts/responsive-matrix/`) is the acceptance record for §6/§7 layout behavior. jsdom component tests cannot serve as that record: they assert the component's own state, not real grid layout, which is how the track-slide defect below survived a green suite.

## Decision

- `ui-layout`: below `SIDEBAR_OVERLAY_MAX` (600) the frame reserves no sidebar track. The sidebar column leaves flow entirely (absolute, 280px, shadowed) and slides in behind a scrim when open; scrim click and Escape both dismiss through the same `toggleSidebar` action. The three frame columns carry explicit `grid-column: 1/2/3`: an out-of-flow child holds no track, so without explicit placement auto-placement slid the center column into the sidebar's zero-width track (measured center=0 in the first live pass — invisible to jsdom, obvious in a real browser).
- `ui-sidebar`: registers `PhoneDrawerButton` (32px, panel glyph, shown only by the `max-width: 599.5px` query) into the composer's `conversation.input.left` list as `sidebar.phoneDrawer`. The composer is the only chrome mounted in every state, so the drawer is reachable from the blank hero as well as an active conversation.
- `ui-conversation`: `conversation.input.left` widens from `session` to `session-maybe` scope and renders unconditionally like `conversation.input.attachments`, so occupants exist without a Session. The slot catalog regenerates from the contract (`pnpm run gen-client-catalog`).

## Alternatives considered

Keeping the rail at phone width and shrinking the drawer instead was rejected: §7 names full-width conversation as the requirement. Placing the opener in the conversation header corner seat would copy ui-sidebar-right's `ExpandButton` pattern, but that seat exists only with a Session — the blank hero, the phone's most common entry state, would have no opener at all. Delegating the drawer's open state to a store was unnecessary: the layout store's `narrowExpanded` override already exists for the below-1024 collapse tier, and the drawer reuses it.

## Consequences

Below 600px: sidebar track 0px, center full-width, no horizontal overflow; drawer opens to 280px over the scrim, center and composer widths unchanged; scrim click and Escape close. At exactly 600px the rail tier returns. Above 599.5px the drawer opener is `display:none`. `PhoneDrawerButton` owns no store; the frame owns geometry, the sidebar plugin owns the affordance. The composer's left input region is now session-maybe and renders in the no-Session state, so future occupants must tolerate `sessionId === undefined` (the same tolerance `conversation.input.attachments` occupants already carry).
