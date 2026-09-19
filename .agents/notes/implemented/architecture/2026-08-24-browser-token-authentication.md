# Agent Note: Browser launch-token authentication

Status: implemented

English | [中文](2026-08-24-browser-token-authentication.zh.md)

## Problem

The Web Host runs tool-capable Sessions with the current operating-system user's authority, but its HTTP interface identified privileged callers from request routing facts. In particular, the method-specific loopback list treated a loopback `Host` value as local authority even though an HTTP client controls that header. A caller that could reach the server could therefore name `localhost`, enter configuration methods, and use Host-side operations such as model discovery to disclose stored credentials. Binding the shipped CLI to loopback limits ordinary reachability but does not authenticate a request forwarded or otherwise delivered to that socket.

## Decision

`dsh-client-connection` authenticates the complete Host API before dispatch. Every API Proxy method, Remote unary call, generic Connection channel, and Remote WebSocket stream requires the same browser session; endpoint ownership and method names do not alter authority. The existing Host/Origin checks run first and retain their DNS-rebinding and cross-site-request role, returning 403 when they fail. A trusted Host without a valid browser session receives 401. The browser-trust rules remain owned by the [carrier-level browser trust decision](2026-07-28-api-browser-trust-boundary.md).

Each Host process generates a random launch token, retained by the root application context across Connection hot reloads. `dsh-web-app` prints and opens the normal root URL with that token in the query once per process. `frontend-static` asks Connection to authorize index responses: only `GET /?token=...` exchanges the process token for a cookie, then redirects to clean `/`; the token is not accepted on API paths or in an Authorization header. An obsolete token paired with a valid cookie redirects to clean `/`. Missing and invalid credentials receive one minimal 401 response. Static non-index assets remain public.

The cookie is a signed, authority-bound bearer. Its deterministic name and signed payload both include the normalized hostname plus port, so one Harness home can run independent Web ports without cookie collisions. The payload carries safe-integer issue and expiry times under an absolute lifetime; `cookieMaxAgeDays` defaults to 30. The cookie is host-only, `Path=/`, `HttpOnly`, and `SameSite=Strict`. It omits `Secure` because the shipped server uses loopback HTTP. There is no logout operation or reverse-proxy-specific handling.

The HMAC secret is a versioned `grant` record at `client-connection/browser-session` in `ctx.credentials`; the local provider stores it in `$DSH_HOME/.credentials.yaml`. Connection loads or creates the record during activation and retains the secret for synchronous request verification. An active Connection continues using its loaded secret if the durable record changes; the next activation loads the replacement or creates a missing record, so deleting the record and restarting the process revokes every existing cookie. Invalid owner payloads fail loud instead of being replaced. The launch token itself is never persisted and changes on every process start, while an unexpired cookie remains valid across restarts on the same authority.

The in-page Web Worker preview exposes no network socket. Its page-owned `postMessage` tunnel enters the real route first, then retries a 401 or 403 through the worker-local fetch handler. This keeps Connection interceptors while limiting the authentication bypass to the page that created the Host worker.

The shipped CLI continues to reject `--host 0.0.0.0`. Authentication does not imply supported network deployment, TLS, forwarding-header interpretation, or proxy configuration.

The browser HTTP caller captures the existing Connection generation for each request. HTTP 401 publishes `auth-expired`, withdraws generation readiness and suspends automatic recovery; the state covers absent and invalid credentials as well as expiry because the Host intentionally returns a uniform response. A cancelled request or response from an obsolete generation cannot invalidate a replacement. HTTP 403 remains a trust rejection, not device revocation. Settings provides localized instructions to use the current launch link and then reconnect; it does not echo credentials or resubmit rejected Prompts. Gateway separately owns retry of completed interaction answers. The [discovery-failure decision](../bug-fix/2026-09-17-terminal-host-discovery.md) retains ownership of incompatible and malformed discovery.

Host discovery announces `authenticating` through its generation source before checking access with `host/describe`, then resumes connection establishment. Initial and retry authentication use the same Connection controller and cancellation. Gateway captures initial-admission eligibility before this progress transition, so exposing authentication cannot turn reconnect-time mutations into queued work. Obsolete progress and callbacks after readiness cannot change the active phase. This state describes the access check, not a new login or device grant operation.

The response-side cancellation check runs before HTTP classification. A response arriving after caller cancellation or generation replacement cannot become a new authentication failure. When an active 401 itself invalidates the generation, Gateway preserves `gateway/authentication-required` for the failed operation instead of relabeling it as cancellation. Caller or contribution cancellation still wins. The [Remote failure decision](2026-08-28-ctx-remote-failure-vocabulary.md) owns HTTP-to-code mapping; lifecycle retry and answer retention remain unchanged.

## Verification

Unit coverage pins process-token retention across Connection reloads, one secret load per activation, synchronous verification without credential-provider reads, cookie attributes, HMAC and payload validation, authority and lifetime checks, record deletion taking effect on the next activation, invalid durable records, and cleanup of obsolete token URLs backed by valid cookies. Host transport suites pin uniform 401/403 behavior for generic RPC, Typert Remote HTTP, exact Fetch routes, and WebSocket upgrade paths. The frontend real-composition test boots credentials, Connection, webserver, and static serving through Loader and proves token exchange before index reads while static assets remain public. Packed-worker tests prove portable cookie encoding and worker-local retry for both authentication and trust rejection. A real-CLI test starts `dsh web` twice on one port with a temporary `DSH_HOME`, proves that forged `Host: localhost` is unauthenticated, calls `settings/describe` with the exchanged cookie, observes a new process token, and reuses the old cookie after restart.

Client tests cover 401 before readiness and during a live generation, no automatic retry, explicit recovery, and ignored 401 responses after replacement or caller cancellation. Recorded Web-profile cases remove the browser cookie during discovery, Prompt or Question answer delivery. Reauthentication and explicit reconnect preserve the difference between resubmitting a rejected Prompt and retrying a pending answer. Answers already accepted or superseded by an independently authenticated Client are not resent; complete Sessions match unchanged fixtures. Separate process tests cancel Approval and Question through another authenticated Client while recovery is paused, verify no approval side effect, and reject old answers during a new turn. Cookie removal exercises the shared 401 path, not natural expiry or device revocation.

## Alternatives considered

**Determine privileged callers from the TCP peer address.** A direct peer address still identifies a local forwarding process rather than the browser user, retains a second authority model beside the API's command-execution capability, and requires proxy policy to answer who the original caller was. One application credential is the enforceable identity used for every operation.

**Keep a method-specific privileged list and restrict stored credentials to configured targets.** The list can omit new endpoints and does not constrain callers that already control a tool-capable Session. A `discoverModels` target rule would not form a security boundary because the same authenticated principal can update settings and run commands. Uniform authentication covers the operation that grants process control.

**Persist or accept the launch token as an API bearer.** A durable launch token would become a second long-lived credential, while Authorization-header support would add a non-browser client contract with no current consumer. The process token performs one browser-cookie exchange only.

**Rotate the signing secret on every restart.** This prevents an existing browser from reconnecting after an ordinary DSH restart. Persisting only the signing secret keeps that workflow while process-token rotation limits the startup URL to one process lifetime.

**Add logout, TLS-proxy, and forwarding-header configuration.** None is required by the loopback Web application or the reported authentication gap. Adding them would define deployment contracts without current consumers. Browser site-data controls revoke one browser session; deleting the credential record and restarting the process revokes all sessions.

## Consequences

Possession of the browser cookie authorizes the complete tool-capable Host API, matching the authority the Web application exposes after Session creation. `Host` does not grant a higher method tier, and a method migration between API Proxy and Typert Remote cannot change its caller set.

The persistent secret makes cookies survive restarts but gives a stolen cookie up to the configured absolute lifetime. Deleting the record and restarting the process is the global revocation mechanism; the active Connection intentionally avoids credential-provider work on each request. Omitting `Secure` preserves loopback HTTP and permits plaintext transmission if an operator makes the same cookie authority reachable over an unencrypted network. The startup URL contains a process credential and must be treated as sensitive output; runtime diagnostics do not repeat it.

The decision partially supersedes the authentication deferral and unauthenticated non-loopback consequences in the [browser trust note](2026-07-28-api-browser-trust-boundary.md). That note remains active authority for media-type, Host, Origin, Fetch-Metadata, and configured-authority validation. No active Agent Note is archived: the overlap is partial and both security rules retain future decision value.
