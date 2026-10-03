# Agent Note: Section 28 host-switch window evidence lanes

Status: implemented

English | [中文](2026-10-03-active-host-switch.zh.md)

## Problem

Section 28 (specification lines 1093–1116) demands three things of a Host switch: the active Host is always explicit, the Composer is disabled while the switch is in flight, and the UI never shows Host B while a request still travels to Host A. Each mechanism already existed — the composer recovery gate blocks on every non-ready `ConnectionState`, capability facts derive from the single current generation, and `retarget` flips the selected origin before anything else — but no lane pinned the switch window itself end to end: the existing specs covered the target flip, the URL-per-call rule, and the static capability matrix separately.

## Decision

- Two evidence lanes, one per dependency-legal layer. `packages/client/connection/tests/host-switch.client.spec.ts` mounts the real Connection plugin with one gated, origin-reading generation source (Host A admits at once; Host B parks on a gate) and walks the full cycle: ready on A, `retarget` to B, retirement, then release and re-establishment on B. A recorder subscribed to all three observables (`target`, `generation`, `state`) samples every flush and asserts the two forbidden pairings never appear: the new target alongside A's generation facts, or B's generation while routing anywhere else. It also pins that the seam is synchronous (inside the `retarget` call the A generation is already cleared), that no connection attempt is addressed to A once the switch began, and that the roster's current row is the one the selected origin points at after B establishes.
- `packages/client/ui-conversation/tests/host-switch.client.spec.ts` drives the real `createComposerControlSource` through the exact Host-facts sequence the api-gateway `$host` getter produces across a switch: A's facts (descriptor plus capabilities spread from the ready generation), the stable no-capability shell while no generation is established, then B's facts. `prompt` goes true → false → true, every capability surface (interrupt, file upload) follows the facts of the current generation only, and a retained A snapshot stops being `current()` the moment the generation moves. The InputBar formula surface (`controlAvailable: false` disables) keeps its existing coverage in `input-bar.client.spec.tsx`.
- Fidelity note: the mid-switch shell is written with the same members the gateway getter emits (`home`/`platform` undefined, no `capabilities` key), so the lane answers false for the same structural reason the real assembly does.

## Alternatives considered

- **One full-chain lane** (real Connection plugin + real gateway client Service + real control source in one spec): the composition only exists at the app root; ui-conversation cannot depend on the gateway client service and the gateway cannot depend on ui-conversation, so a single lane would cross package boundaries the workspace constraints forbid. The two layers pin the same observables the app assembly consumes.
- **A derived `switching` observable folded into the InputBar disable condition:** redundant with the two owned observables. The disable is already synthesized from the recovery-loop state and `controlAvailable`, and the dedup edge (a state emission being deduplicated so a generation survives `retarget`) is unreachable while a generation is live: a published generation implies the controller's last state is `ready`, so `retarget`'s `reconnecting` emission always fires. A third flag would duplicate owned state.

## Consequences

- The section 28 switch triple now has lane-level claims pinned at both layers the composer actually consumes; the traceability entry records the split honestly instead of claiming a single end-to-end lane.
- No product code changed; both lanes are additive evidence, and the audit client list grows from 43 files / 618 tests to 45 / 621.

## Open work

- True devices, the Swift shell, background/push behavior and the remaining section 28 acceptance stay open; cross-origin visiting remains page-policy scoped (see the Connection README's switch-seam paragraph).
