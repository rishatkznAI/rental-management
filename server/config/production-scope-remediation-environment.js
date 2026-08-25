const CANONICAL_COMPANY_ID = 'cmp_7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ';

// Reviewed, immutable production target. Railway exposes project/environment/service
// IDs plus the attached volume name/mount path to the running container. The volume
// ID is additionally proven by the protected workflow through Railway's control plane.
module.exports = Object.freeze({
  projectId: '1558b38d-bf16-4b50-9ee6-0871b7152116',
  environmentId: '62833109-61cb-4600-9200-d624d6537a05',
  serviceId: 'b2016e92-3c50-4b00-800d-625a139b219c',
  volumeId: '48b8768c-a8a9-4a87-8a4b-b980fff5d00c',
  volumeName: 'rental-management-volume',
  volumeMountPath: '/data',
  sourceDbPath: '/data/app.sqlite',
  canonicalCompanyId: CANONICAL_COMPANY_ID,
  githubRepository: 'rishatkznAI/rental-management',
});
