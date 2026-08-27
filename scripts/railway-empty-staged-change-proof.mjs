import crypto from 'node:crypto';

export const RAILWAY_EMPTY_STAGED_PATCH_SHA256 =
  '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

export function validateRailwayEmptyStagedChangeProof({
  environment,
  stagedChanges,
  expectedEnvironmentId,
} = {}) {
  if (typeof expectedEnvironmentId !== 'string'
    || !expectedEnvironmentId
    || expectedEnvironmentId !== expectedEnvironmentId.trim()) {
    throw new Error('expected Railway environment ID is not an exact nonblank string');
  }
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new Error('target Railway environment was not returned');
  }
  if (environment.id !== expectedEnvironmentId) {
    throw new Error('Railway environment ID mismatch');
  }

  const unmergedChangesCountObserved = environment.unmergedChangesCount;
  if (unmergedChangesCountObserved !== null && unmergedChangesCountObserved !== 0) {
    throw new Error('Railway unmerged-change count contradicts the empty staged patch');
  }

  if (!stagedChanges || typeof stagedChanges !== 'object' || Array.isArray(stagedChanges)) {
    throw new Error('Railway staged-changes proof was not returned');
  }
  if (typeof stagedChanges.id !== 'string'
    || !stagedChanges.id
    || stagedChanges.id !== stagedChanges.id.trim()) {
    throw new Error('Railway staged-changes ID is not an exact nonblank string');
  }
  if (stagedChanges.environmentId !== expectedEnvironmentId) {
    throw new Error('Railway staged-changes environment ID mismatch');
  }
  if (stagedChanges.status !== 'STAGED') {
    throw new Error('Railway staged-changes status is not exactly STAGED');
  }

  const stagedPatch = stagedChanges.patch;
  if (!stagedPatch || typeof stagedPatch !== 'object' || Array.isArray(stagedPatch)) {
    throw new Error('Railway staged patch is not a JSON object');
  }
  const stagedPatchStructuralChangeCount = Object.keys(stagedPatch).length;
  if (stagedPatchStructuralChangeCount !== 0) {
    throw new Error('Railway staged patch contains structural changes');
  }
  const stagedPatchCanonical = JSON.stringify(stagedPatch);
  if (stagedPatchCanonical !== '{}') {
    throw new Error('Railway staged patch is not canonical-empty');
  }
  const stagedPatchFingerprint = crypto
    .createHash('sha256')
    .update(stagedPatchCanonical)
    .digest('hex');
  if (stagedPatchFingerprint !== RAILWAY_EMPTY_STAGED_PATCH_SHA256) {
    throw new Error('Railway empty staged patch fingerprint mismatch');
  }

  return {
    unmergedChangesCountObserved,
    unmergedChangesCountUsedAsEmptyProof: false,
    stagedChangesEmpty: true,
    stagedPatchId: stagedChanges.id,
    stagedPatchEnvironmentId: stagedChanges.environmentId,
    stagedPatchStatus: stagedChanges.status,
    stagedPatchCanonicalEmpty: true,
    stagedPatchAuthority: 'environmentStagedChanges.patch(decryptVariables:false)',
    stagedPatchStructuralChangeCount,
    stagedPatchFingerprint,
  };
}
