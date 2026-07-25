# PR5–PR8 registry credential supersession plan

## 1. Scope and current containment state

This document is a fail-closed design and operator runbook. It records no
credential value, performs no Railway mutation, and grants no deployment or retry
authority. Its repository baseline is PR #229 squash merge
`32ce9cb5d9027bfb75034b3f436c4fcf85d703be` on `origin/main`.

The exposed private-GHCR credential was a GitHub personal access token (classic).
It was revoked at `2026-07-25T14:45:58.838Z`; two subsequent non-destructive
authentication polls returned HTTP `401`. Only its safe fingerprint is retained:

`sha256:a9de26be90bff93d0b0a59564305ede2af8234947d99d6e94c2abb9c6a958d71`

Railway's encrypted registry field still contains that revoked value. It has no
active consumer because the current service source is `repo = null` and
`image = null`. Replacing or clearing the field can enqueue a deployment, so this
documentation task deliberately leaves it unchanged.

The recorded rollback runtime remains:

| Field | Contained value |
|---|---|
| Active deployment | `65140ce4-7947-4a9b-9a9f-9410096d11e6` |
| Source commit | `6a38582f5f90b85734884b6b12ad8e306b24619e` |
| Image digest | `sha256:c27f43d5520f63415203e0cafdb23c07d4d93ec3d93e0236af4917dfbcae9650` |
| Railway source | `repo = null`; `image = null` |
| Integration state | bot disabled; GSM disabled; canonical and forecast read flags absent |

The latest authoritative backup remains the private two-object folder
`rentcore-drive:Rentcore/20260725T145852Z/`, folder ID
`1IDqWXVuhPw9mypTK9xNxcsCBBzuDsPiL`. Its encrypted object ID is
`1BNeePc1Eu1gw-S69f_8bPMexM8KH1PiT`, and its manifest object ID is
`1PecI1kvisD2xmt9UZ7NNxN2D5jjGcQEh`. Encrypted, manifest and plaintext identity
SHA-256 values are respectively
`cbde8abe643ccb71da419d5e90575e544f566b4b2733e5941d37feb61543d82f`,
`8d74d03c707c9deb169947eb6e9f38053c3338ae7aef52a3b3a2957da6c3155d`
and `061496b32b0343eff5244ee0a5594ba6e2dee398a152bb30dab7a19f4305ee84`.
Durable custody and the exact migration baseline, including shadow
`applied_at = 2026-07-25 14:19:55`, are proven in
`docs/pr5-pr8-foundation-security-backup-remediation.md`.

No replacement credential has been provisioned through an approved secure
channel, and no replacement verification has been performed.

`registryCredentialRevoked = TRUE`

`replacementRegistryCredentialProvisioned = FALSE`

`replacementRegistryCredentialVerified = FALSE`

`postRollbackBackupDurableCustody = TRUE`

`postRollbackMigrationBaselineVerified = TRUE`

## 2. Least-privilege replacement credential design

GitHub's documentation checked on `2026-07-25` says that GitHub Packages,
including the Container registry, supports package authentication with a personal
access token (classic), while accessing Packages remains a limitation of
fine-grained personal access tokens. An external Railway pull cannot use the
repository-scoped `GITHUB_TOKEN` that GitHub issues only inside Actions.

The supported least-privilege design is therefore:

| Control | Required design |
|---|---|
| Credential type | GitHub personal access token (classic), used only because fine-grained PAT package authentication is not supported |
| Principal | dedicated machine user with no human-use credential reuse |
| Approved consumer | Railway production service `rental-management`, private GHCR pull only, during one separately authorized change window |
| Exact package | `ghcr.io/rishatkznai/rental-management` only |
| Token scopes | `read:packages` only |
| Package permission | `Read` only on the exact container package |
| Repository permission | none when package-granular access is available; otherwise read-only on `rishatkznAI/rental-management` as the documented maximum fallback |
| Expiry | a concrete UTC expiry recorded before creation, no more than seven calendar days after creation; revoke immediately after the single window |
| Forbidden scopes | `repo`, `workflow`, `write:packages`, `delete:packages`, administration, organization-management and every unrelated scope |
| Storage | owner-controlled secret manager; never source, Git history, PR text, logs, screenshots, shell history or a Codex prompt |

Because a classic PAT inherits the resource access of its owner, the dedicated
principal is a mandatory compensating control. Prefer package-granular access:
grant that principal only the package's `Read` role and do not add it to the
repository or organization. If the package currently inherits repository access,
the owner must either approve a separate package-permission change or grant only
read access to the one repository. No contents write, Actions write,
administration or broader organization role is permitted.

The owner creates the token interactively in GitHub. The note must identify the
consumer and window, for example
`rentcore-railway-ghcr-read-single-window-YYYYMMDD`. Before generation, the owner
must visually confirm that `read:packages` is the only selected scope and set the
exact expiry. The generated value goes directly to the owner-controlled secret
manager. It must never be copied into this repository or conversation.

Authoritative support references:

- [Working with the Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
- [About permissions for GitHub Packages](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages)
- [Managing personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

## 3. Secure non-deployment verification

Verification must occur on a trusted operator host before any Railway change. It
must use only the exact approved artifact:

`ghcr.io/rishatkznai/rental-management@sha256:866de3a0554129168d12aeeaffd6c412fdad1ad9552885faa5c01c29bf1b7ba5`

Use `skopeo` with a mode-0700 temporary directory and a temporary authentication
file. This avoids Docker's persistent login store and pulls the OCI content into
an ephemeral local layout rather than a daemon. The operator must disable shell
tracing and history for the restricted session. The token is read silently from
the approved secret channel into a non-exported shell variable, sent only through
standard input to `skopeo login`, and immediately unset after the safe fingerprint
is calculated.

The future operator procedure is:

1. Set `umask 077`, disable command tracing, create a fresh directory with
   `mktemp -d`, and verify that it is non-empty, owned by the operator and mode
   `0700` before registering a guarded cleanup trap.
2. Read the replacement token silently from the approved secret manager or
   terminal into a non-exported variable. Do not place it in an argument,
   environment export, command substitution shown in logs or a file other than
   the temporary `skopeo` authentication file.
3. Calculate its SHA-256 safe fingerprint through standard input. Record only
   `sha256:<digest>`; do not record the token or its prefix/suffix.
4. Pipe the token through standard input to `skopeo login --authfile` for
   `ghcr.io` with the dedicated machine-user name. Suppress command output and
   record only the exit-status classification `AUTHENTICATION_SUCCESS` or
   `AUTHENTICATION_FAILURE`.
5. Run `skopeo inspect` against only the digest-qualified reference above. Require
   the reported digest to equal
   `sha256:866de3a0554129168d12aeeaffd6c412fdad1ad9552885faa5c01c29bf1b7ba5`.
6. Run `skopeo copy --all --preserve-digests` from that same reference into an
   OCI layout inside the temporary directory. Hash the local raw root manifest
   and require the same digest. A tag, `latest`, a second package or a rebuilt
   artifact is forbidden.
7. Log out using the temporary authentication file, delete the authentication
   file, OCI layout and the exact validated temporary directory, unset all local
   variables, and prove that the directory no longer exists. Do not retain layer
   data or authentication sidecars.
8. If any assertion fails, clean up, revoke the replacement token, record only
   the safe failure classification, and keep Railway untouched.

The verification record may contain only:

| Safe field | Allowed value |
|---|---|
| Credential type | `GitHub PAT (classic), read:packages only` |
| Approved consumer | `Railway production rental-management / exact private GHCR pull` |
| Expiry | exact UTC expiry |
| Safe fingerprint | SHA-256 only |
| Authentication result | success or redacted failure classification |
| Exact pulled digest | the approved digest above |
| Cleanup result | temporary auth file and OCI layout absent |

Until this procedure is executed with an actually provisioned replacement through
the approved secure channel:

`replacementRegistryCredentialVerified = FALSE`

## 4. Railway mutation risk and fail-closed future sequence

Replacing or clearing Railway's encrypted registry credential is a service
configuration mutation that may enqueue a deployment even while
`repo = null` and `image = null`. A credential-only preparatory mutation is
therefore not safe outside an explicitly authorized deployment change window.
Merging this document does not authorize that mutation.

A future window must execute the following order exactly. Failure of any item
stops the sequence before Railway mutation:

1. Fetch GitHub and prove that local `HEAD`, `origin/main` and the owner-approved
   trusted main SHA are identical, with a clean working tree.
2. Bind the immutable source commit and exact approved image reference. The
   currently documented candidate is source
   `1d59992315f1b7f4ff2d370fc17345a459ac52e3` and digest
   `sha256:866de3a0554129168d12aeeaffd6c412fdad1ad9552885faa5c01c29bf1b7ba5`;
   any future owner decision must repeat the exact values rather than rely on this
   plan.
3. Prove that the replacement credential was provisioned through the approved
   channel and passed section 3 outside Railway. Record only its safe metadata.
4. Reconfirm the active rollback deployment, source commit, previous-image digest,
   `SUCCESS/RUNNING`, and unchanged runtime start marker. Reconfirm
   `repo = null` and `image = null` immediately before mutation.
5. Reconfirm `/data` volume attachment and reserve, networking, public target port
   `8080`, variable inventory fingerprint, `BOT_DISABLED = true`,
   `GSM_ENABLED = false`, and canonical/forecast read flags absent or false,
   without printing variable values or credentials.
6. Run SQLite `integrity_check`, `quick_check` and `foreign_key_check`; require the
   exact seven-row migration registry with shadow
   `applied_at = 2026-07-25 14:19:55`, catalog `1/11`, PR5 `0/7`, PR6 `0/16`,
   PR7 `0/8`, PR8 `0/8` and canonical/settlement `0/8`.
7. Re-download and verify the current durable backup and manifest, including
   exact object count, IDs, sizes, three checksums, local decrypt, SQLite checks,
   access and retention. If live database identity or baseline has changed,
   create and independently verify a new coherent encrypted backup instead.
8. Prepare multi-vantage `/health` and `/api/version` probes and Railway request
   logs for timestamp/request-ID correlation before the mutation.
9. Bind the exact previously deployed rollback target by deployment ID, source
   SHA and image digest. It must be reusable through Railway's previous-image
   behavior without rebuilding or `railway up`.
10. Place the deployment executor, Rishat as owner/smoke reviewer, and an
    independent security/evidence observer on the live change record. Confirm the
    stop rules and evidence destinations.
11. Obtain a new explicit single-use owner authorization immediately before the
    first Railway mutation. It must name the credential safe fingerprint, exact
    source/image, consumer, expiry, rollback target, executor/reviewer and UTC
    window. Authorization expires after one attempt whether successful, blocked
    or rolled back.
12. If and only if that authorization explicitly includes one foundation retry,
    use one minimal atomic Railway change to bind the verified credential and the
    exact digest, keeping `repo = null`. Do not perform a credential-only warm-up
    mutation, rebuild, restart, redeploy or use `railway up`.
13. Treat any deployment enqueued by the mutation as the one authorized attempt.
    Correlate deployment identity, runtime logs and multi-vantage probes
    immediately. Do not initiate a second source or credential mutation.
14. Run the separately approved post-deployment smoke procedure only within that
    single-use authorization. Stop and execute the rollback below on any P0/P1
    deviation.

If the owner authorizes credential supersession but does not explicitly authorize
a foundation retry, the sequence stops before step 12 and Railway remains
unchanged. Readiness evidence, a verified credential or a merged plan cannot be
interpreted as deployment authority.

## 5. Rollback procedure

Rollback is bound before the future window and is fail-closed:

1. Before any Railway mutation, if credential authentication, digest, preflight,
   backup, observers or owner authorization is missing, revoke the unused
   replacement credential and make no Railway change.
2. If the authorized atomic mutation enqueues an unexpected artifact, changes
   source identity, restarts unexpectedly or produces any P0/P1 deviation, stop
   all further changes and reuse the bound previous deployed image through
   Railway's previous-image rollback behavior. Never rebuild the rollback source
   and never use `railway up`.
3. Reconfirm the known-good deployment/source/image, `SUCCESS/RUNNING`, public
   health/version evidence, log correlation, database integrity, exact registry
   and all zero-row boundaries.
4. Return `repo` and `image` to `null` only through the separately approved
   deploy-skipping cleanup path. Do not issue a restart or ordinary redeploy.
5. Revoke the replacement token after the single window. If clearing the encrypted
   field could enqueue another deployment, leave the now-revoked value stored with
   both source fields null and schedule a separate authorized cleanup; it is then
   non-authenticating and has no active consumer.
6. Preserve redacted evidence and, if database identity changed, create a new
   coherent encrypted backup with independent durable-custody verification.
7. Record the attempt as consumed and restore
   `foundationDeploymentRetryAuthorized = FALSE` regardless of outcome.

## 6. Required observers and redacted evidence

The minimum live observers are:

- the named operations executor, who performs the single authorized change;
- Rishat, who owns the decision and performs smoke review;
- an independent security/evidence observer, who verifies scope, safe logging,
  timestamps, stop rules and cleanup without handling the token value.

The retained record must include only safe evidence: trusted main SHA, approved
source and image digest, credential type, machine-user safe identifier, exact
consumer, expiry, safe fingerprint, external authentication and pull result,
temporary cleanup result, preflight assertions, backup folder/object IDs and
checksums, Railway deployment/source/image identifiers, probe IDs and aggregate
results, correlated request-log IDs/timestamps, smoke outcome, rollback outcome
and the owner authorization timestamp. Credential values, encrypted Railway
variable values, token-bearing headers, auth files, shell transcripts and
screenshots containing secrets are forbidden.

## 7. Authorization boundaries

The following are independent gates:

1. **Retry readiness** proves evidence and controls. It grants no mutation.
2. **Retry authorization** requires a new explicit single-use owner decision
   immediately before the Railway mutation.
3. **Production activation** remains separate after any foundation outcome.
4. **Canonical reads and writes** remain two separate production decisions.
5. **PR9** remains outside this plan and independently blocked.

Current authorization state:

| Field | Value |
|---|---|
| `registryCredentialRevoked` | `TRUE` |
| `replacementRegistryCredentialProvisioned` | `FALSE` |
| `replacementRegistryCredentialVerified` | `FALSE` |
| `postRollbackBackupDurableCustody` | `TRUE` |
| `postRollbackMigrationBaselineVerified` | `TRUE` |
| `foundationDeploymentRetryAuthorized` | `FALSE` |
| `productionActivationAuthorized` | `FALSE` |
| `canonicalProductionReadsAuthorized` | `FALSE` |
| `productionCanonicalWritesAuthorized` | `FALSE` |
| `pr9ImplementationAuthorized` | `FALSE` |

This plan does not authorize Railway credential replacement or clearing, source
reconnection, deployment, restart, migration, PR5 bootstrap, PR6 population, PR7
calculation, PR8 execution, production activation, canonical production reads or
writes, bot/GSM activation, or PR9 design/implementation.
