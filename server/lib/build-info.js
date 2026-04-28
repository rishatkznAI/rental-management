const path = require('path');
const { execFileSync } = require('child_process');

const serverStartedAt = new Date().toISOString();

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

function getBuildInfo() {
  const commit = firstNonEmpty(
    process.env.RAILWAY_GIT_COMMIT_SHA,
    process.env.GIT_COMMIT_SHA,
    process.env.COMMIT_SHA,
    process.env.SOURCE_VERSION,
    readGitCommit(),
  );

  return {
    service: 'backend',
    commit: commit ? commit.slice(0, 12) : '',
    commitFull: commit || '',
    buildTime: firstNonEmpty(process.env.BUILD_TIME, process.env.RAILWAY_DEPLOYMENT_CREATED_AT),
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
