const REQUIRED_SECTIONS = ['summary', 'activityTarget', 'recentActivity', 'tasks', 'rentals', 'money', 'documents', 'clients'];
const VALID_PLAN_STATUSES = new Set(['done', 'needs_activity', 'unknown']);
const VALID_ACTIVITY_PROGRESS_STATUSES = new Set(['optional', 'complete', 'in_progress', 'not_started']);
const UNSAFE_KEY_PATTERN = /password|pass(hash)?|token|cookie|secret|private[-_ ]?key|authorization|auth[-_ ]?header|raw[-_ ]?env|database[-_ ]?url|db[-_ ]?url/i;
const UNSAFE_STRING_PATTERN = /\bundefined\b|\bnull\b|\[object Object\]|Bearer\s+|sk-[A-Za-z0-9_-]+|postgres(?:ql)?:\/\/|sqlite:\/\/|mongodb(?:\+srv)?:\/\//i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function describePath(path) {
  return path.length ? path.join('.') : '<root>';
}

export function findUnsafeManagerPlanPayloadViolations(value, path = []) {
  const violations = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      violations.push(...findUnsafeManagerPlanPayloadViolations(item, [...path, String(index)]));
    });
    return violations;
  }

  if (isPlainObject(value)) {
    Object.entries(value).forEach(([key, entryValue]) => {
      const nextPath = [...path, key];
      if (UNSAFE_KEY_PATTERN.test(key)) {
        violations.push(`unsafe key at ${describePath(nextPath)}`);
      }
      violations.push(...findUnsafeManagerPlanPayloadViolations(entryValue, nextPath));
    });
    return violations;
  }

  if (typeof value === 'string' && UNSAFE_STRING_PATTERN.test(value)) {
    violations.push(`unsafe string at ${describePath(path)}`);
  }

  return violations;
}

export function assertManagerPlanResponseShape(payload) {
  if (!isPlainObject(payload)) {
    throw new Error('manager plan response must be an object');
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!Object.prototype.hasOwnProperty.call(payload, section)) {
      throw new Error(`manager plan response missing ${section}`);
    }
  }

  if (!isPlainObject(payload.summary)) throw new Error('summary must be an object');
  if (!VALID_PLAN_STATUSES.has(payload.summary.planStatus)) {
    throw new Error('summary.planStatus must be done, needs_activity, or unknown');
  }

  const utilization = payload.summary.fleetUtilizationPercent;
  const utilizationKnown = Number.isFinite(utilization);
  if (!utilizationKnown && !(utilization === null && payload.summary.planStatus === 'unknown')) {
    throw new Error('summary.fleetUtilizationPercent must be numeric or null only when planStatus is unknown');
  }

  if (!isPlainObject(payload.activityTarget)) throw new Error('activityTarget must be an object');
  for (const [sectionName, section] of [['summary', payload.summary], ['activityTarget', payload.activityTarget]]) {
    for (const field of ['todayCallsDone', 'todayCallsTarget', 'weekSiteVisitsDone', 'weekSiteVisitsTarget', 'completionPercent']) {
      const value = section[field];
      if (!Number.isFinite(value)) throw new Error(`${sectionName}.${field} must be numeric`);
    }
    if (!VALID_ACTIVITY_PROGRESS_STATUSES.has(section.activityProgressStatus)) {
      throw new Error(`${sectionName}.activityProgressStatus must be valid`);
    }
  }
  if (payload.summary.planStatus === 'needs_activity') {
    if (payload.activityTarget.required !== true) throw new Error('low utilization must require activity');
    if (payload.activityTarget.dailyCallsTarget !== 40) throw new Error('low utilization must require 40 daily calls');
    if (payload.activityTarget.weeklySiteVisitsTarget !== 2) throw new Error('low utilization must require 2 weekly site visits');
  }

  if (!Array.isArray(payload.recentActivity)) throw new Error('recentActivity must be an array');
  if (!Array.isArray(payload.tasks)) throw new Error('tasks must be an array');
  if (!isPlainObject(payload.rentals)) throw new Error('rentals must be an object');
  if (!isPlainObject(payload.money)) throw new Error('money must be an object');
  if (!isPlainObject(payload.documents)) throw new Error('documents must be an object');
  if (!isPlainObject(payload.clients)) throw new Error('clients must be an object');

  return payload;
}

export function assertNoUnsafeManagerPlanPayload(payload) {
  const violations = findUnsafeManagerPlanPayloadViolations(payload);
  if (violations.length > 0) {
    throw new Error(`manager plan response contains unsafe payload fields: ${violations.join(', ')}`);
  }
}

export function hasUnsafeVisibleManagerPlanText(text) {
  return UNSAFE_STRING_PATTERN.test(String(text || ''));
}

export function managerPlanSmokeSummary(payload) {
  const summary = isPlainObject(payload?.summary) ? payload.summary : {};
  return {
    planStatus: summary.planStatus || 'unknown',
    utilizationKnown: Number.isFinite(summary.fleetUtilizationPercent),
    tasks: Array.isArray(payload?.tasks) ? payload.tasks.length : 0,
  };
}
