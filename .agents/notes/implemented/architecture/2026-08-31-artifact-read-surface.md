# Agent Note: The Artifact Read Surface

Status: implemented

English | [中文](2026-08-31-artifact-read-surface.zh.md)

## Problem

The artifact producer shipped create-only: the model could author an artifact but never read one back, and a paired companion saw references and status without a wire path to the bytes. Chapter 56's split pins the design for the read face too — the journal proves the reference, the resource channel serves the bytes.

## Decision

Two symmetric read faces land over the existing channel. `artifact_read` is the model-facing tool: `ctx.artifacts.get` by reference id, loud failure when the channel never stored the id (`found no content stored under id "<id>"`), the complete content returned verbatim with `kind` and `title` enriched from the calling session's `artifact/created` when it journaled one — reading requires no owning session, because it changes nothing. `session/artifact` is the remote wire face, mirroring `session/attachment`: a paired observer posts `{request: {sessionId, artifactId}}`; authorization is the journal itself (the session's log must carry an `artifact/created` for the id — `ARTIFACT_NOT_REFERENCED` otherwise), the channel serves base64 bytes (`ARTIFACT_CONTENT_MISSING` when the reference outlives its content — loud, never a silent empty read), and the response carries the journaled metadata. The link contracts grow `LinkArtifactReadValue` with a golden fixture, regenerated into the Swift and Kotlin models; both companions consume it — `RemoteSessionViewModel.readArtifact(_:)` and `SessionModel.readArtifact` cache decoded bytes by id exactly like the attachment reads, nulling on refusal.

## Consequences

The artifact lifecycle is round-trip complete: create journals a reference, the channel keeps bytes, and both the model (in-session) and a paired companion (over the wire) can read the content back. Remaining on this face: paged reads (a full content round-trip per read costs an artifact's size), binary input, and a retention policy for stored bytes.

## Alternatives considered

Serving reads through the workspace-file channel was rejected — artifacts live under `DSH_HOME`, outside every workspace root the containment check guards, so the files browse would have to punch its own boundary. Deriving `kind` and `title` from the channel (storing metadata beside the bytes) was rejected — the journal already owns metadata; storing a second copy invites drift between what replay shows and what reads return. A silent null for missing content on the wire was rejected — the remote face distinguishes "never referenced" from "referenced but content gone" so a companion can render each honestly.
