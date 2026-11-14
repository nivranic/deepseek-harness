# Agent Note: Web handoff action renders the view-location link as a QR code

Status: implemented

English | [中文](2026-10-04-view-handoff-qr.zh.md)

## Problem

The §26 Web capture side delivered link copy, but cross-device delivery still required the person to paste the link into some messaging channel. The specification leaves "QR rendering and the real cross-device delivery channel" as outer-shell work; the QR half is locally deliverable — a phone camera is a delivery channel that needs no messaging round-trip, and the repo already ships `qrcode.react` for the device-pairing panel.

## Decision

Render the exact handoff link — the same string that is copied — as a QR code in an anchored popover opened by the same click:

- `qrcode.react@^4.2.0` joins this package's `devDependencies` (browser third-party build input; tsdown inlines it into `lib/client.js`), rendering `QRCodeSVG` with `size` 200 and `marginSize` 4, matching the pairing panel. No new supply-chain surface: the library was already a repo dependency.
- The popover follows the repo's anchored-panel recipe verbatim (`ui-schedule` ScheduleCatalogAction / `ui-conversation` HeaderOverflowMenu): `useAnchoredPosition` bottom-anchored with a hidden measuring pass, `useDismissOnOutsidePointer` with the portaled panel counted as inside, Escape closes and refocuses the trigger, panel portaled to `document.body` with the shared card recipe (fixed, z-100, `--dsw-specific-menu`, radius 20, elevation variables).
- The trigger keeps its behavior — encode, set link, copy, dress — and additionally opens the popover; the QR encodes exactly the copied link, so a scan delivers the identical fragment. The clipboard-refusal title-degrade fallback is unchanged and remains the path when portaling is unavailable.
- A11y: `aria-haspopup="dialog"` + `aria-expanded` on the trigger (this is a free-content popover, not an items menu), panel labeled by the localized `scan` key, which also titles the SVG (the pairing-panel test hook precedent).

## Alternatives considered

- **Render on canvas or as a data URL**: rejected — `QRCodeSVG` is pure SVG, assertable in jsdom with no canvas mocks (the pdf lane's canvas factory fake would otherwise be needed).
- **A second interaction (separate "show QR" button)**: rejected — one click doing copy + show matches the action's single quiet affordance; the QR content never differs from the clipboard string.
- **A new QR library (`uqr`, `qrcode-generator`)**: rejected — `qrcode.react` is already in the tree, ISC-licensed, typed, zero runtime deps; a second QR implementation would add surface without deleting owned code.

## Consequences

- The lane grows three cases (QR renders portaled with the localized title, Escape closes and returns focus, outside pointer dismisses); the five existing cases pass unchanged.
- `react-dom` and `@types/react-dom` join `devDependencies` (the package previously had no `createPortal` consumer).
- `THIRD_PARTY_NOTICES.md` needs no new row (the qrcode.react ISC row already exists); the lockfile records the workspace link only.
- Deep links and platform share routing remain open §26 outer-shell work; this delivers the QR rendering clause only. No model-visible surface changes.

## Open follow-ups

- Deep links (`#dsh-view=` intake on native platforms) and platform share routes stay deferred §26 work.
- Real physical-device scanning acceptance stays part of the §26 device matrix.
