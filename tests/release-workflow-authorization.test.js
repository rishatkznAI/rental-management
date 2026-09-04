import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const remediation = readFileSync(
  new URL('../.github/workflows/production-scope-remediation.yml', import.meta.url),
  'utf8',
);
const productionOperations = readFileSync(
  new URL('../docs/production-operations.md', import.meta.url),
  'utf8',
);
const deploy = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}

function between(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.ok(startAt >= 0, `missing start marker: ${start}`);
  assert.ok(endAt > startAt, `missing end marker: ${end}`);
  return source.slice(startAt, endAt);
}

test('deploy and remediation share one non-cancelling production release lock', () => {
  for (const [name, source] of [['deploy', deploy], ['remediation', remediation]]) {
    assert.equal(count(source, /^concurrency:$/gm), 1, name);
    assert.equal(count(source, /^  group: production-release$/gm), 1, name);
    assert.equal(count(source, /^  cancel-in-progress: false$/gm), 1, name);
  }
  assert.doesNotMatch(remediation, /group: production-scope-remediation/);
});

test('identity remediation requires an external deployment freeze beyond point-in-time checks', () => {
  assert.match(productionOperations, /externally enforced deployment freeze/);
  assert.match(productionOperations, /no operator, API client, workflow, or platform action/);
  assert.match(productionOperations, /Railway exposes no atomic control-plane lease/);
  assert.match(productionOperations, /Do not authorize `apply` without explicit freeze evidence/);
});

test('remediation is bound to the exact deployed main SHA and uncommitted authorized bytes', () => {
  assert.match(remediation, /actions\/checkout@11bd71901bbe5b1630ceea73d27597364c9af683/);
  assert.match(remediation, /persist-credentials: false/);
  assert.match(remediation, /test "\$GITHUB_REPOSITORY" = "rishatkznAI\/rental-management"/);
  assert.match(remediation, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(remediation, /test "\$GITHUB_SHA" = "\$EXPECTED_DEPLOYED_SHA"/);
  assert.match(remediation, /test "\$\(git rev-parse HEAD\)" = "\$EXPECTED_DEPLOYED_SHA"/);
  assert.match(remediation, /authorized_bundle_base64:/);
  assert.match(remediation, /expected_authorized_bundle_sha256:/);
  assert.match(remediation, /test "\$\{#AUTHORIZED_BUNDLE_BASE64\}" -le 45000/);
  assert.match(remediation, /authorized_bundle_path="\$\(mktemp "\$RUNNER_TEMP\/production-scope-remediation-authorized-bundle\.XXXXXX"\)"/);
  assert.match(remediation, /printf '%s' "\$AUTHORIZED_BUNDLE_BASE64" \| base64 --decode > "\$authorized_bundle_path"/);
  assert.match(remediation, /test "\$\(base64 -w 0 "\$authorized_bundle_path"\)" = "\$AUTHORIZED_BUNDLE_BASE64"/);
  assert.match(remediation, /test "\$\(sha256sum "\$authorized_bundle_path" \| awk '\{print \$1\}'\)" = "\$EXPECTED_AUTHORIZED_BUNDLE_SHA256"/);
  assert.match(remediation, /--require-authorized/);
  assert.match(remediation, /capture_sha="\$\(jq -er '\.source\.captureDeployedSha'/);
  assert.match(remediation, /test "\$capture_sha" = "\$EXPECTED_DEPLOYED_SHA"/);
  assert.match(remediation, /test "\$authorization_capture_sha" = "\$EXPECTED_DEPLOYED_SHA"/);
  assert.match(
    remediation,
    /authorized_execution_sha="\$\(jq -er '\.authorization\.authorizedExecutionSha'/,
  );
  assert.match(remediation, /test "\$authorized_execution_sha" = "\$EXPECTED_DEPLOYED_SHA"/);
  assert.match(remediation, /\.executionPlan\.executionScope == "IDENTITY_ONLY"/);
  assert.match(remediation, /\.executionPlan\.recordMappings == \[\]/);
  assert.match(remediation, /\.executionPlan\.relationMappings == \[\]/);
  assert.match(remediation, /\.summary\.collectionWriteCounts == \{\}/);
  assert.match(remediation, /\.source\.railwayIdentity == \{/);
  assert.match(remediation, /execution_bundle_base64="\$\(base64 -w 0 "\$AUTHORIZED_BUNDLE_PATH"\)"/);
  assert.match(remediation, /executionBundleBase64: \$executionBundleBase64/);
  assert.match(remediation, /executionBundleFileSha256: \$executionBundleFileSha256/);
  assert.doesNotMatch(remediation, /first_parent_sha|changed_files|expected_files/);
  assert.match(remediation, /authorized_bundle_file="\$AUTHORIZED_BUNDLE_PATH"/);
  assert.match(remediation, /jq -er '\.source\.captureDeploymentId' "\$authorized_bundle_file"/);
  assert.match(remediation, /authorized_bundle_path="\$\{AUTHORIZED_BUNDLE_PATH:-\}"/);
  assert.match(remediation, /rm -f -- "\$authorized_bundle_path"/);
  assert.match(remediation, /test ! -e "\$authorized_bundle_path"/);
});

test('bundle bytes and exact deployed SHA are bound before dependencies, repo code, or secrets', () => {
  const checkoutAt = remediation.indexOf('Checkout the exact authorized release commit');
  const materializeAt = remediation.indexOf(
    'Bind exact deployed workflow and materialize external bundle bytes',
  );
  const setupAt = remediation.indexOf('Set up the pinned bundle-verifier runtime');
  const installAt = remediation.indexOf('Install locked bundle-verifier dependencies');
  const verifyAt = remediation.indexOf('node server/scripts/verify-production-scope-execution-bundle.js');
  const railwayCliAt = remediation.indexOf(
    'Install checksum-pinned Railway CLI for exact target verification',
  );
  const secretAt = remediation.indexOf('Mask and validate secrets');
  assert.ok(checkoutAt >= 0 && checkoutAt < materializeAt);
  assert.ok(materializeAt < setupAt);
  assert.ok(setupAt < installAt && installAt < verifyAt);
  assert.ok(verifyAt < secretAt);
  assert.ok(verifyAt < railwayCliAt && railwayCliAt < secretAt);
  assert.match(
    remediation,
    /actions\/setup-node@2028fbc5c25fe9cf00d9f06a71cc4710d4507903/,
  );
  assert.match(remediation, /node-version: 20\.20\.2/);
  assert.match(remediation, /npm ci --prefix server/);
  const materialization = between(
    remediation,
    '- name: Bind exact deployed workflow and materialize external bundle bytes',
    '- name: Set up the pinned bundle-verifier runtime',
  );
  assert.doesNotMatch(materialization, /\bnode\b|\bnpm\b|server\/scripts|secrets\./);
  assert.match(materialization, /test "\$GITHUB_SHA" = "\$EXPECTED_DEPLOYED_SHA"/);
  assert.match(materialization, /sha256sum "\$authorized_bundle_path"/);
});

test('workflow HMAC uses the server contract real-LF separators', () => {
  assert.equal(remediation.includes('.join("\\n");'), true);
  assert.equal(remediation.includes('.join("\\\\n");'), false);
});

test('authorized execution bundle is transported outside watched Git source', () => {
  assert.doesNotMatch(
    remediation,
    /server\/config\/production-scope-remediation-execution-plan\.generated\.json/,
  );
  assert.doesNotMatch(remediation, /committed authorized-bundle|bundle-only successor/);
  assert.doesNotMatch(deploy, /authorized_bundle_base64|expected_authorized_bundle_sha256/);
  assert.match(remediation, /never commit this runtime artifact/);
});

test('remediation checks the same Railway deployment, running instance, and API runtime before and after', () => {
  assert.doesNotMatch(remediation, /\brailway link\b/);
  assert.equal(
    count(
      remediation,
      /railway status\s+\\\s+--project "\$RAILWAY_PROJECT_ID"\s+\\\s+--environment "\$RAILWAY_ENVIRONMENT_ID"\s+\\\s+--json >/g,
    ),
    2,
  );
  assert.match(remediation, /Capture exact Railway control-plane state before operation/);
  assert.match(
    remediation,
    /test "\$bundle_capture_deployment_id" = "\$\(jq -er '\.deploymentId' "\$GITHUB_WORKSPACE\/railway-control-plane-before\.json"\)"/,
  );
  assert.match(remediation, /Revalidate exact Railway control-plane state after operation/);
  assert.equal(count(remediation, /latestDeployment\.status == "SUCCESS"/g), 2);
  assert.equal(count(remediation, /latestDeployment\.meta\.commitHash == \$sha/g), 2);
  assert.equal(count(remediation, /\(\$instances \| length\) == 1/g), 2);
  assert.equal(count(remediation, /\$instances\[0\]\.status == "RUNNING"/g), 2);
  assert.equal(count(remediation, /serviceInstanceId: \$services\[0\]\.id/g), 2);
  assert.equal(count(remediation, /deploymentInstanceId: \$instances\[0\]\.id/g), 2);
  assert.match(remediation, /\.source\.deploymentIdentity\.serviceInstanceId/);
  assert.match(remediation, /\.source\.deploymentIdentity\.deploymentInstanceId/);
  assert.match(remediation, /deploymentIdentity: \{\s+serviceInstanceId: \$serviceInstanceId,\s+deploymentInstanceId: \$deploymentInstanceId/s);
  assert.match(remediation, /cmp --silent "\$GITHUB_WORKSPACE\/railway-control-plane-before\.json"/);
  assert.equal(count(remediation, /"\$PRODUCTION_API_ORIGIN\/api\/version"/g), 2);
  assert.equal(count(remediation, /\.build\.commitFull == \$sha/g), 2);
  assert.equal(count(remediation, /\.build\.deployment\.railwayDeploymentId == \$deploymentId/g), 2);
  assert.match(remediation, /cmp --silent api-runtime-identity-before\.json api-runtime-identity-after\.json/);
  assert.ok(count(remediation, /--proto '=https' --tlsv1\.2/g) >= 3);
  assert.ok(count(remediation, /--connect-timeout 15 --max-time/g) >= 3);
});

test('Railway source and deployment interlock is exhaustive before, immediately before, and after', () => {
  assert.equal(
    count(remediation, /scripts\/railway-remediation-interlock\.mjs/g),
    3,
  );
  assert.match(remediation, /\.deployment\.nonterminalDeploymentCount.*= "0"/);
  assert.match(remediation, /\.autoDeploy\.enabled.*= "false"/);
  assert.match(
    remediation,
    /cmp --silent railway-interlock-before\.json railway-interlock-immediate\.json/,
  );
  assert.match(
    remediation,
    /cmp --silent "\$GITHUB_WORKSPACE\/railway-interlock-before\.json"\s+\\\s+"\$GITHUB_WORKSPACE\/railway-interlock-after\.json"/,
  );
  const operation = between(
    remediation,
    '- name: Invoke exactly one guarded operation',
    '- name: Revalidate exact Railway control-plane state after operation',
  );
  assert.ok(
    operation.indexOf('railway-remediation-interlock.mjs')
      < operation.indexOf('REQUEST_ID="$(cat /proc/sys/kernel/random/uuid)"'),
  );
  assert.ok(
    operation.indexOf('railway-remediation-interlock.mjs')
      < operation.indexOf('curl --fail-with-body'),
  );
});

test('every remediation mode has an exact HTTP and response contract', () => {
  assert.match(remediation, /case "\$MODE" in/);
  assert.match(remediation, /preflight\)\n\s+test "\$http_status" = "200"/);
  assert.match(remediation, /\.result\.readyForBackup == true/);
  assert.match(remediation, /\["RECOVERABLE_BACKUP_NOT_VERIFIED"\]/);
  assert.match(remediation, /backup\)\n\s+test "\$http_status" = "201"/);
  assert.match(remediation, /\.result\.readyToApplyAfterIndependentCopy == true/);
  assert.match(remediation, /\.result\.receipt\.skippedFilesCount == 0/);
  assert.match(remediation, /apply\)\n\s+test "\$http_status" = "200"/);
  assert.match(remediation, /\.result\.status == "succeeded"/);
  assert.match(remediation, /\.result\.writes == 13/);
  assert.match(remediation, /\.result\.collectionWrites == 0/);
  assert.match(remediation, /\.result\.bootstrapStatus == "succeeded"/);
  assert.match(remediation, /\.result\.postDatabaseFingerprint == \$postDatabase/);
  assert.match(remediation, /verify\)\n\s+test "\$http_status" = "200"/);
  assert.match(remediation, /\.result\.summary\.idempotentPlannedWriteCount == 0/);
  assert.match(remediation, /\.result\.verifyRuntimeSafety\.databaseAndWalUnchanged == true/);
  assert.doesNotMatch(remediation, /jq -e '\.ok == true' remediation-response\.json/);
});

test('apply authority checksum is independently supplied and bound end to end', () => {
  assert.match(remediation, /expected_authority_config_checksum:/);
  assert.match(
    remediation,
    /authority_config_checksum="\$\(jq -er '\.executionPlan\.authority\.identityBootstrap\.approval\.configChecksum'/,
  );
  assert.match(remediation, /\[\[ "\$authority_config_checksum" =~ \^\[a-f0-9\]\{64\}\$ \]\]/);
  assert.match(remediation, /AUTHORIZED_AUTHORITY_CONFIG_CHECKSUM=\$authority_config_checksum/);
  assert.match(remediation, /\[\[ "\$EXPECTED_AUTHORITY_CONFIG_CHECKSUM" =~ \^\[a-f0-9\]\{64\}\$ \]\]/);
  assert.match(
    remediation,
    /test "\$EXPECTED_AUTHORITY_CONFIG_CHECKSUM" = "\$AUTHORIZED_AUTHORITY_CONFIG_CHECKSUM"/,
  );
  assert.match(remediation, /test -z "\$EXPECTED_AUTHORITY_CONFIG_CHECKSUM"/);
  assert.match(
    remediation,
    /expectedAuthorityConfigChecksum: \$expectedAuthorityConfigChecksum/,
  );
  assert.match(
    remediation,
    /\.result\.receipt\.authorityConfigChecksum == \$authorityConfigChecksum/,
  );
  assert.match(remediation, /\.authorityConfigChecksum == \$authorityConfigChecksum/);
  assert.match(
    remediation,
    /authorityConfigChecksum: \$receipt\.authorityConfigChecksum/,
  );
  assert.match(
    remediation,
    /\.result\.authorityConfigChecksum == \$authorityConfigChecksum/,
  );
});

test('independent-copy timestamp uses the same canonical millisecond UTC contract as the server', () => {
  assert.match(
    remediation,
    /\.verifiedAt \| test\("\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}T/,
  );
  assert.match(
    remediation,
    /\.verifiedAt \| sub\("\\\\\.\[0-9\]\{3\}Z\$"; "Z"\) \| fromdateiso8601 > 0/,
  );
  assert.doesNotMatch(remediation, /\.verifiedAt \| fromdateiso8601 > 0/);
});

test('remediation uploads only allowlisted metadata and always removes plaintext', () => {
  const upload = between(
    remediation,
    '- name: Store protected non-secret review evidence',
    '- name: Remove and verify absence of transient plaintext and credentials',
  );
  assert.match(upload, /if: always\(\)/);
  assert.match(upload, /remediation-operation-metadata\.json/);
  assert.match(upload, /remediation-response-summary\.json/);
  assert.doesNotMatch(upload, /^\s+remediation-response\.json$/m);
  assert.doesNotMatch(upload, /^\s+remediation-request\.json$/m);
  assert.doesNotMatch(upload, /^\s+remediation-backup-receipt\.json$/m);
  const invoke = between(
    remediation,
    '- name: Invoke exactly one guarded operation',
    '- name: Revalidate exact Railway control-plane state after operation',
  );
  assert.match(invoke, /trap 'rm -f remediation-request\.json remediation-response\.json' EXIT/);
  assert.match(remediation, /trap 'rm -f api-runtime-before\.raw\.json' EXIT/);
  assert.match(remediation, /trap 'rm -f api-runtime-after\.raw\.json' EXIT/);
  assert.match(remediation, /for protected_path in "\$\{protected_paths\[@\]\}"/);
  assert.match(remediation, /test ! -L "\$protected_path"/);
  assert.match(remediation, /ARTIFACT_URL.*github\\\.com\/rishatkznAI\/rental-management\/actions\/runs/);
  assert.match(remediation, /ARTIFACT_DIGEST.*sha256:\)\?\[a-f0-9\]\{64\}/);
  assert.match(remediation, /if: always\(\)\n\s+run: \|\n\s+set -euo pipefail\n\s+umask 077/);
  for (const file of [
    'remediation-request.json',
    'remediation-response.json',
    'api-runtime-before.raw.json',
    'api-runtime-after.raw.json',
    'remediation-backup-receipt.json',
    'remediation-backup.zip',
    'remediation-backup-verify.zip',
    'remediation-backup.zip.gpg',
  ]) {
    assert.match(remediation, new RegExp(`test ! -e ${file.replaceAll('.', '\\.')}`));
  }
  assert.ok(remediation.includes(
    'trap \'rm -f "$GITHUB_WORKSPACE/remediation-backup.zip" "$GITHUB_WORKSPACE/remediation-backup-verify.zip"\' EXIT',
  ));
});

test('current-main deploy classifier remains authoritative with no identity-bundle bypass', () => {
  assert.match(deploy, /node scripts\/release-classifier\.mjs "\$\{classifier_args\[@\]\}"/);
  assert.match(deploy, /classifier_args\+=\(--requested-release-type "\$\{\{ inputs\.release_type \|\| '' \}\}"\)/);
  assert.doesNotMatch(deploy, /authorized_bundle_full_stack_exception/i);
  assert.doesNotMatch(deploy, /authorized_bundle_sha256/i);
  assert.doesNotMatch(deploy, /--require-authorized/);
  assert.doesNotMatch(deploy, /release_type="\$\{requested_release_type:-full-stack\}"/);
});

test('remediation uses only independently checksum-pinned Railway CLI bytes', () => {
  const install = between(
    remediation,
    '- name: Install checksum-pinned Railway CLI for exact target verification',
    '- name: Mask and validate secrets',
  );
  assert.match(
    install,
    /railway-v5\.45\.0-x86_64-unknown-linux-musl\.tar\.gz/,
  );
  assert.match(
    install,
    /RAILWAY_CLI_ARCHIVE_SHA256: 68688cd8ddcffbfcd3e117f7261758ac281727981c2698b5573223694f1d8ad4/,
  );
  assert.match(
    install,
    /RAILWAY_CLI_BINARY_SHA256: 5014d217ba2e996022df7eed4fab7cdbc87b7039320244fa56f939b78986a0e8/,
  );
  assert.match(install, /test "\$\(tar -tzf "\$archive_path"\)" = "railway"/);
  assert.match(install, /tar -xOzf "\$archive_path" railway > "\$cli_dir\/railway"/);
  assert.match(install, /test "\$\(stat -c '%s' "\$cli_dir\/railway"\)" = "17487656"/);
  assert.match(install, /test "\$\("\$cli_dir\/railway" --version\)" = "railway 5\.45\.0"/);
  assert.doesNotMatch(remediation, /npm install (?:--global|-g) @railway\/cli/);
  assert.doesNotMatch(remediation, /npm-install\/postinstall|@railway\/cli@4\.60\.0/);
  assert.match(
    remediation,
    /railway volume\s+\\\s+--project "\$RAILWAY_PROJECT_ID"\s+\\\s+--environment "\$RAILWAY_ENVIRONMENT_ID"\s+\\\s+--service "\$RAILWAY_SERVICE_ID"\s+\\\s+files --volume "\$RAILWAY_VOLUME_ID" download/,
  );
});
