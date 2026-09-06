# Agent Note: Optional WebServer binding in the Link composition

Status: implemented

English | [中文](2026-09-02-optional-webserver-link-composition.zh.md)

## Problem

`dsh-client-connection` serves both Web compositions with `ctx.webServer` and webless compositions that carry `/api` through another transport. Its optional binding checked `ctx.get('webServer')` but registered the route through `ctx.webServer`, which Cordis refuses because the plugin deliberately does not declare the optional service as a required injection. Gateway transport tests therefore failed when the service was present, while the shipped Link composition also failed before activation because one base-patch prose line was not a YAML comment. The carrier-level test isolated settings, sessions, storage, and Device Trust in a temporary Harness home but left credentials at the user default, so a clean sandbox attempted to lock the user's credential file.

## Decision

The base patch keeps the Artifact explanation as a valid YAML comment. Connection resolves the optional WebServer once with `ctx.get('webServer')`, captures that service for route registration, and retains `inject = ['credentials']`; it still provides `ctx.connection` without a WebServer and its existing `ctx.inject(['webServer'], ...)` watcher binds `/api` when the service appears later. The shipped Link test maps the local credential provider to the same temporary Harness home as its other durable stores, with file watching disabled, so the real desktop composition never reads or writes the developer's credentials.

## Alternatives considered

**Declare `webServer` as a required injection.** Rejected because desktop and other webless carriers require the Connection service without an HTTP server.

**Check with `ctx.get` and then use `ctx.webServer`.** Rejected because a presence check does not authorize Cordis property access outside the plugin's declared injections.

**Disable Connection, Electron IPC, or credentials in the carrier test.** Rejected because the test must boot the shipped desktop composition and prove the real browser/Gateway chain without touching user state.

## Consequences

Gateway transport coverage exercises the real optional route binding instead of failing during setup, and the shipped Link slice reaches pairing, Session list, the Remote event stream, and the independent approval switch. The test requires built Host and Web artifacts because the shipped Loader resolves package exports and Electron IPC validates the frontend distribution; those build products remain artifact-plane prerequisites rather than source fallbacks.
