# Release Infrastructure Recovery — 2026-08-26

This record is diagnostic and implementation evidence only. No production deploy, redeploy, restart, variable change, database operation, or rollback was performed while preparing it.

## Read-only backend diagnosis

- Railway project: `1558b38d-bf16-4b50-9ee6-0871b7152116`.
- Production environment: `62833109-61cb-4600-9200-d624d6537a05`.
- Backend service: `b2016e92-3c50-4b00-800d-625a139b219c` (`rental-management`).
- Active deployment: `59b886d3-70aa-4f25-85f2-37aacc52e08d`, source commit `d62401984ce634150c86c8cdd1188159725340fe`, Railway status `SUCCESS`.
- Active instance: `6e3fd424-997c-4eae-b3fc-638cca37ee8b`, state `RUNNING`, region `europe-west4-drams3a`.
- Public domain: `rental-management-production-35bc.up.railway.app`, target port `8080`.
- Persistent volume: `48b8768c-a8a9-4a87-8a4b-b980fff5d00c`, mounted at `/data`, state `READY`.
- Railway's deployment healthcheck for `/health` passed. Startup logs showed the server listening on port `8080` with `/data/app.sqlite`; there was no crash/restart loop.
- Railway HTTP logs showed edge-to-instance responses, including `GET /api/version` HTTP `200` and other HTTP `200`/`404` application responses with no upstream-connect errors.
- From the operator network, DNS consistently resolved the Railway host to `69.46.46.87`, while IPv4 and IPv6 HTTPS probes timed out before TCP connect/TLS and never appeared in Railway HTTP logs.

Classification: the backend runtime and Railway ingress were operational. The observed timeout was specific to the operator-network route to Railway's edge, not an application bind, startup, database, health-route, or edge-to-instance failure. Confidence is high because the Railway control plane, deployment healthcheck, runtime logs, and HTTP logs independently agreed.

## Commit-range review

The backend range from frontend baseline `1c30e6f` through deployed `d624019` contained the tenant-isolation and guarded-remediation work. Focused review found no bind-address or port regression: `server/server.js` still uses Railway's `PORT`, `app.listen(port)` keeps wildcard binding, and Railway's internal `/health` check succeeded against the deployed runtime.

The unreleased range `d624019..5f071fc` changed only the Playwright user-membership fixture and its test coverage:

- `e2e/helpers/api.ts`;
- `server/scripts/seed-e2e-actor-scope.js` (test-only guard);
- `tests/trusted-actor-scope-server-e2e.test.js`.

No production application runtime correction was justified.

## Historical and recovered release mechanism

The historical backend mechanism was Railway's connected GitHub repository/autodeploy path. Repository history contained no reviewed GitHub Actions backend deploy command; `.github/workflows/deploy.yml` advertised `backend` and `full-stack` inputs but deployed only GitHub Pages. Consequently a merge could advance `main` without producing a reviewed backend release.

Railway's live public GraphQL schema and the Railway CLI schema expose `serviceInstanceDeployV2(environmentId, serviceId, commitSha)`, which returns the created deployment ID. The recovered workflow uses that exact-SHA source deployment primitive with a production-scoped project token. It fails closed before the mutation on wrong GitHub ref/SHA/repository or wrong Railway token/project/environment/service/source/runtime configuration, then fails closed after the mutation on wrong deployment identity, non-`SUCCESS` status, metadata SHA mismatch, health/readiness failure, or public version SHA mismatch.

## Railway file-managed configuration authority

The production service stores the source identity and root directory on the Railway `ServiceInstance`, while deployment settings are supplied by `server/railway.toml`. Railway combines config-as-code with service settings for each deployment; file values take precedence without being copied back into the raw service fields. Consequently the live production `ServiceInstance` correctly reports `rootDirectory=/server` while its raw `healthcheckPath` and `startCommand` are `null`.

The release preflight does not treat those `null` values as either a mismatch or a wildcard. Before `serviceInstanceDeployV2`, it now requires all of the following conflict-free evidence:

- strict project, environment, service, repository source, and `/server` root identity;
- the exact checked-out `server/railway.toml`, with `deploy.healthcheckPath=/health` and `deploy.startCommand="node scripts/start-with-release-type.cjs"`;
- Railway `resolvedFileConfig.configFile=/server/railway.toml`, tied to the one successful active deployment by exact deployment ID and commit SHA;
- `resolvedFileConfig.fileManifest` and `propertyFileMapping` proving both values came from the deploy table in that file;
- active deployment `meta.fileServiceManifest` and final `meta.serviceManifest` confirming the same effective values.

Any non-null raw value must also match. A conflicting raw field, wrong root/config path, missing committed value, missing resolved evidence, or effective metadata conflict fails closed before the mutation. After Railway reports `SUCCESS`, the returned exact-SHA deployment metadata is checked again for the same config file, property mappings, and effective values before public runtime probes begin.

Full-stack ordering is now backend first, frontend second, unified production gate last. A final read-only job reports exact public state and explicitly records `PARTIAL_RELEASE` when only one side matches the target. No fallback deploy or automatic rollback exists.
