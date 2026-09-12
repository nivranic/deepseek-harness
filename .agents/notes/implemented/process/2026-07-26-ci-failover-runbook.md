# Agent Note: CI failover runbook — hosted pools → in-house pool

Status: implemented

English | [中文](2026-07-26-ci-failover-runbook.zh.md)

## Problem

Required CI workers cannot finish when their configured runner labels are unavailable. A fork does not inherit an upstream enterprise pool, and a hosted-pool outage can also leave required checks queued. Merging a workflow repair may itself depend on those checks. Linux and Windows therefore need independent runner selection and failover, with standard hosted defaults that a new repository can use.

## Decision

The three Linux workers default to `ubuntu-24.04`; the four native Windows jobs default to `windows-2025`. Repository variables `DSH_CI_LINUX_RUNNER` and `DSH_CI_WINDOWS_RUNNER` select provisioned hosted labels. `DSH_CI_FAILOVER_LINUX=selfhosted` takes precedence for the Linux workers and `all checks passed`, selecting `vm-backup`; `DSH_CI_FAILOVER_WINDOWS=selfhosted` selects `dsh-win-ci` for native Windows jobs. Dependabot remains excluded from both self-hosted pools. Linux failover skips hosted pnpm cache restores. The independent concurrency variables in `ci.yml` retain bounded defaults suitable for standard runners; a provisioned larger pool may raise them explicitly. Every required test and the aggregate dependency list remain unchanged. Repository writers can change these variables without a merge; the master standby lanes verify the configured self-hosted pools.

`ci-master.yml` exempts exactly one event from `cancel-in-progress` (`${{ github.event_name != 'push' }}`), so one master push does not cancel the drill still running from the previous one. Each drill runs its complete unsharded aggregate with one gate worker, which takes longer than the interval between master merges; under unconditional cancellation a drill is superseded before reaching a verdict and the lane yields no readiness evidence for a responder to check.

The exemption is narrower than "a drill always finishes", in two ways. GitHub keeps a single pending entry per group, so a newer pending run displaces an older one and intermediate push runs still end as `cancelled` during busy periods. And the expression is evaluated against the *newly triggered* run, so a run whose own event is not `push` — a benchmark dispatched on master within `ci-master.yml`, sharing its group `CI master-<ref>` — evaluates to `true` and does cancel a drill that is mid-flight. That is a rare manual action and the next master push restores the evidence, so it does not warrant further mechanism. What the carve-out buys is that the lane periodically reaches a verdict at all, which is what makes it usable as evidence.

The decision belongs at workflow level because cancellation applies to the whole superseded run: a job-level `concurrency` group does not exempt its job. The negated form is load-bearing rather than cosmetic: naming `pull_request` alone would also stop cancelling `workflow_dispatch`, and each runner benchmark fans out to twelve larger runners for up to fifteen minutes inside this same group on master, so a re-dispatch would queue ahead of a drill instead of replacing a stale measurement. What bounds the cost is that a master push in `ci-master.yml` carries only `wine-apt-cache` and these two drills; the pull-request jobs live in the separate `ci.yml` (which does not see `push`), and the benchmarks are `workflow_dispatch`-gated within `ci-master.yml`. `scripts/ci-workflow.spec.ts` pins that push-reachable set — classifying by exact condition, since a negated event test mentions the event it excludes — so a new push-reachable job cannot quietly start accumulating uncancelled runs.

### What the in-house pool is

`vm-backup`: one 64-core VM, six always-on systemd-managed runner instances. Its image must preinstall Playwright Chromium's Linux system packages; CI downloads the lockfile-selected browser but never runs `apt` on this persistent shared host. Check the latest `serial / linux (self-hosted standby)` run before switching: its aggregate includes browser replay, so a green standby verifies both ordinary capacity and this browser prerequisite.

#### Windows pool

`dsh-win-ci`: 32 always-on runner instances (scheduled tasks `GH-Runner-01`…`GH-Runner-32`) on the in-house Windows CI server (one 96-core / 580 GB machine). Labels: `[self-hosted, dsh-win-ci, windows]`. The image must preinstall Node 24, pnpm, Git (with Git Bash on `PATH`, i.e. `C:\Program Files\Git\bin` — the `bash` tool spawns `bash` by name), PowerShell 7, and enable Developer Mode for symlink support. Check the latest `serial / windows (self-hosted standby)` run before switching: a green standby verifies the pool can execute `check:ci:windows-complete` end-to-end.

### Switch (any repository writer, ~1 minute, no merge)

The two switches are independent: flip only the one whose platform is degraded.

1. Repository **Settings → Secrets and variables → Actions → Variables → New repository variable**: name `DSH_CI_FAILOVER_LINUX` (Linux pool outage) or `DSH_CI_FAILOVER_WINDOWS` (Windows pool outage), value `selfhosted`.
2. Retrigger the required jobs so they re-resolve their pool. Jobs already **queued** for the hosted labels do not retarget and cannot be re-run in place, so for the documented indefinite-queue outage, cancel the stuck run and re-run all jobs, or push a new commit; "Re-run failed jobs" only helps once a job has actually failed rather than queued.
3. Re-run the affected jobs. Linux failover skips hosted pnpm cache restoration because the persistent store serves warm installs. `DSH_CI_SNAPSHOT_MAX_CONCURRENCY` controls replay concurrency independently of runner selection, defaulting to 4. Coverage retains four instrumented partitions and two exempt workers. The Windows switch changes only runner selection.

#**Dependabot exception.** Both switches' selectors deliberately exclude `dependabot[bot]`: under failover, Dependabot PRs stay queued for the hosted pool rather than executing dependency-supplied code on the persistent VMs. A Dependabot PR that remains queued during an outage is expected behavior, not a failed switch; it completes when the hosted pool recovers.

**Who can flip the variable.** GitHub's API lets any collaborator with write access manage repository variables, so each switch is writer-level, not strictly admin-only. In this repository's trust model that is not an escalation: the runner groups admit all workflows of this private, fork-disabled repository (a deliberate trade to make PR-ref failover possible at all), so any writer could already reach the VMs by pushing a branch workflow. The boundary against untrusted code is repository membership; the variables only route work for members.

## Capacity during failover

Six always-on instances absorb normal PR traffic (the pool's steady-state load is one serial standby job per master push, so failover capacity is effectively the full pool). If queues still build, register additional instances with an org registration token (org Settings → Actions → Runners → New runner). Clone an existing runner directory **excluding its identity files** — `rsync -a --exclude '.runner*' --exclude '.credentials*' --exclude '_diag' --exclude '_work' <src>/ <dst>/` (the globs also catch `.runner_migrated`/`.credentials_migrated`, which GitHub writes on migrated runners and which equally trigger the already-configured refusal) — then run `config.sh` (copying `.runner`/`.credentials` verbatim makes it refuse with "already configured"), and **start the listener**: `sudo ./svc.sh install ubuntu && sudo ./svc.sh start`. Registration alone leaves the runner offline; only a started service adds capacity. About a minute per instance.


### Switch back

Delete the `DSH_CI_FAILOVER_LINUX` or `DSH_CI_FAILOVER_WINDOWS` variable (or set it to anything other than `selfhosted`). New runs resolve back to the hosted enterprise pools. Remove any extra instances that were registered during the incident.

### Trust boundary

The variables are writer-manageable repository state; a pull request event itself can neither set them nor read a different value into effect, and the selector expressions live in workflow definitions. Note that under failover, `pull_request` runs execute the PR merge ref's own workflow definition — the boundary against untrusted code is repository membership (private, forking disabled, Dependabot excluded by the selectors), not the variable. Note on runner-group policy: pinning the runner group to the master-ref workflow is **incompatible** with this failover — the five failover jobs are `pull_request` runs evaluated from PR merge refs, and a master-pinned group leaves them queued (observed live on 2026-07-27; the group was widened to all workflows of this repository to unblock the switch). A stricter runner-side policy therefore costs PR failover; the shipped posture accepts repository-scoped, all-workflow group access.

## Alternatives considered

**Merge a workflow change to switch pools.** Rejected because the outage that motivates the switch is exactly the state in which no PR can merge: the required checks are the ones failing. A repository variable is writer-manageable state that takes effect on re-run without a merge.

**Keep the self-hosted pool always in the required path.** Rejected because it trades hosted-pool availability for the in-house VM's, moving a single point of failure rather than adding a fallback. The variables keep the hosted pools primary and the self-hosted pools proven, one-action standbys; splitting them by platform means an outage on one platform does not retarget the other.

## Consequences

A standard runner is usable without upstream enterprise configuration. Recovery from a hosted-pool outage still requires a provisioned self-hosted pool and a variable change followed by a re-run. Master standby jobs verify those pools; Linux cache restoration remains conditional on failover. Explicit hosted-label and concurrency variables add configuration, while keeping platform selection independent and preserving every required check.
