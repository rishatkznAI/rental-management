const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const serverStartedAt = new Date().toISOString();
const DEFAULT_BACKEND_RELEASE_MARKER_FILE = path.join(__dirname, '..', 'release-marker.json');
const KNOWN_RELEASE_TYPES = new Set([
  'frontend-only',
  'backend',
  'full-stack',
  'deploy-tooling',
  'frontend-deploy-tooling',
]);

function firstNonEmpty(...values) {
  return values.map(value => String(value || '').trim()).find(Boolean) || '';
}

function readGitCommit() {
  try {
    const repoRoot = path.join(__dirname, '..', '..');
    return execFileSync('git', ['-C', repoRoot, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function readBackendReleaseMarker() {
  const markerFile = firstNonEmpty(process.env.BACKEND_RELEASE_MARKER_FILE, DEFAULT_BACKEND_RELEASE_MARKER_FILE);
  try {
    const marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    return marker && typeof marker === 'object' && !Array.isArray(marker) ? marker : {};
  } catch {
    return {};
  }
}

function normalizeReleaseType(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return KNOWN_RELEASE_TYPES.has(normalized) ? normalized : '';
}

function getBuildInfo() {
  const marker = readBackendReleaseMarker();
  const commit = firstNonEmpty(
    process.env.RAILWAY_GIT_COMMIT_SHA,
    marker.commitFull,
    marker.commit,
    process.env.GIT_COMMIT_SHA,
    process.env.COMMIT_SHA,
    process.env.SOURCE_VERSION,
    readGitCommit(),
  );
  const releaseType = normalizeReleaseType(firstNonEmpty(
    process.env.RELEASE_TYPE,
    process.env.RELEASE_PREFLIGHT_RELEASE_TYPE,
    process.env.RAILWAY_RELEASE_TYPE,
    marker.releaseType,
    marker.release_type,
    marker.release?.type,
  ));

  return {
    service: 'backend',
    commit: commit ? commit.slice(0, 12) : '',
    commitFull: commit || '',
    buildTime: firstNonEmpty(marker.buildTime, marker.deployTime, process.env.BUILD_TIME, process.env.RAILWAY_DEPLOYMENT_CREATED_AT),
    releaseType: releaseType || 'unknown',
    release: {
      type: releaseType || 'unknown',
    },
    startedAt: serverStartedAt,
    deployment: {
      railwayDeploymentId: firstNonEmpty(process.env.RAILWAY_DEPLOYMENT_ID),
      railwayEnvironment: firstNonEmpty(process.env.RAILWAY_ENVIRONMENT_NAME),
      railwayService: firstNonEmpty(process.env.RAILWAY_SERVICE_NAME),
      nodeEnv: firstNonEmpty(process.env.NODE_ENV),
    },
  };
}

module.exports = {
  getBuildInfo,
};
