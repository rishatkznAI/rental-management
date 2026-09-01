'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const {
  ALL_APP_DATA_COLLECTIONS,
  COLLECTION_SCOPE_CATEGORY,
  COLLECTION_SCOPE_REGISTRY,
} = require('./app-data-scope-registry');

const AUDIT_SCHEMA_VERSION = 1;
const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const SOURCE_ROOTS = Object.freeze(['server', 'scripts']);
const EXCLUDED_SOURCE_PATHS = new Set([
  'server/lib/future-write-audit.js',
  'server/scripts/audit-future-writes.js',
]);

// These are storage sinks or explicitly reviewed semantic persistence adapters.
// Aliases introduced through object destructuring are discovered separately.
const APP_DATA_WRITER_NAMES = new Set([
  'setData',
  'setDataBatch',
  'setDataCompareAndSwap',
  'setDataBatchCompareAndSwap',
  'writeData',
  'writeDataBatch',
  'writeRawData',
  'writeRawDataBatch',
  'persistDataBatch',
  'persistDataBatchUnsafe',
  'persistAuditDataBatchUnsafe',
  'persistTenantEntries',
  'writeServiceDataBatch',
  'persistBotSessions',
  'persistUserAuthorityTransition',
  'migrateJsonFilesToDb',
  'cloneCollectionIfMissing',
  'seedServiceWorks',
  'seedKnowledgeBaseModules',
  'ensureKnowledgeBaseProgress',
  'seedServiceRouteNorms',
  'seedSpareParts',
  'cleanupArchivedCrm',
  'seedDefaultUsers',
  'ensureLegacyDefaultUsers',
  'applyAdminResetFromEnv',
  'seedDemoData',
  'resetAppData',
]);

const SQL_WRITE_METHODS = new Set(['exec']);
const SQL_RUN_METHOD = 'run';
const SQL_CALLABLE_METHODS = new Set(['exec', 'prepare', 'pragma', 'backup']);
const SQL_ESCAPE_METHODS = new Set(['exec', 'prepare', 'pragma']);
const SQLITE_BACKUP_WRITER_NAMES = new Set(['createDatabaseBackup']);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SINGLE_COLLECTION_WRITERS = new Set([
  'setData',
  'setDataCompareAndSwap',
  'writeData',
  'writeRawData',
]);
const BATCH_COLLECTION_WRITERS = new Set([
  'setDataBatch',
  'setDataBatchCompareAndSwap',
  'writeDataBatch',
  'writeRawDataBatch',
  'persistDataBatch',
  'persistDataBatchUnsafe',
  'persistAuditDataBatchUnsafe',
  'persistTenantEntries',
  'writeServiceDataBatch',
]);

class FutureWriteAuditError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FutureWriteAuditError';
    this.code = code;
    this.details = details;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function relativeSourcePath(rootDir, filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function walkSourceCorpusFiles(rootDir) {
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'data') continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(target);
    }
  };
  for (const sourceRoot of SOURCE_ROOTS) {
    const directory = path.join(rootDir, sourceRoot);
    if (fs.existsSync(directory)) visit(directory);
  }
  return files.sort();
}

function walkSourceFiles(rootDir) {
  return walkSourceCorpusFiles(rootDir)
    .filter(filePath => !EXCLUDED_SOURCE_PATHS.has(relativeSourcePath(rootDir, filePath)));
}

function sourceCorpusManifest(rootDir) {
  return walkSourceCorpusFiles(rootDir).map(filePath => ({
    file: relativeSourcePath(rootDir, filePath),
    sha256: sha256(fs.readFileSync(filePath)),
  }));
}

function sourceCorpusSha256(rootDir) {
  return sha256(stableJson(sourceCorpusManifest(rootDir)));
}

function parseSource(source, filePath) {
  try {
    return parser.parse(source, {
      sourceType: 'unambiguous',
      plugins: [
        'classProperties',
        'dynamicImport',
        'jsx',
        'optionalChaining',
        'topLevelAwait',
      ],
    });
  } catch (cause) {
    throw new FutureWriteAuditError(
      'FUTURE_WRITE_SOURCE_PARSE_FAILED',
      `Future-write audit could not parse ${filePath}.`,
      { filePath, cause: cause.message },
    );
  }
}

function propertyName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'NumericLiteral') return String(node.value);
  return '';
}

function calleeName(node) {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    return propertyName(node.property);
  }
  return '';
}

function boundIdentifiers(node) {
  if (!node) return [];
  if (node.type === 'Identifier') return [node.name];
  if (node.type === 'AssignmentPattern') return boundIdentifiers(node.left);
  if (node.type === 'RestElement') return boundIdentifiers(node.argument);
  if (node.type === 'ObjectPattern') {
    return node.properties.flatMap(property => (
      property.type === 'RestElement'
        ? boundIdentifiers(property.argument)
        : boundIdentifiers(property.value)
    ));
  }
  if (node.type === 'ArrayPattern') {
    return node.elements.flatMap(element => boundIdentifiers(element));
  }
  return [];
}

function destructuredSourceName(pattern, localName) {
  if (pattern?.type !== 'ObjectPattern') return '';
  for (const property of pattern.properties || []) {
    if (property.type !== 'ObjectProperty') continue;
    if (!boundIdentifiers(property.value).includes(localName)) continue;
    const nested = destructuredSourceName(property.value, localName);
    return nested || propertyName(property.key);
  }
  return '';
}

function destructuredBaseNames(pattern, baseNames) {
  const names = new Set();
  for (const localName of boundIdentifiers(pattern)) {
    const sourceName = destructuredSourceName(pattern, localName);
    if (baseNames.has(sourceName)) names.add(sourceName);
  }
  return [...names];
}

function addAll(target, values) {
  for (const value of values || []) {
    if (value) target.add(value);
  }
  return target;
}

function callableOriginKey(pathRef, name) {
  if (!pathRef?.node || !name) return '';
  return `${pathRef.node.type}:${pathRef.node.start}:${pathRef.node.end}:${name}`;
}

function recordCallableOrigin(evidence, pathRef, name) {
  const key = callableOriginKey(pathRef, name);
  if (key && evidence) evidence.add(key);
}

function recordResolvedCallableUse(evidence, pathRef, names) {
  for (const name of names || []) recordCallableOrigin(evidence, pathRef, name);
}

function expressionDefinitionPaths(pathRef, seenBindings = new Set()) {
  if (!pathRef?.node) return [];
  if (seenBindings.has(pathRef.node)) return [];
  seenBindings = new Set(seenBindings).add(pathRef.node);
  if (pathRef.isIdentifier?.()) {
    const binding = pathRef.scope.getBinding(pathRef.node.name);
    if (!binding || seenBindings.has(binding)) return [];
    const nextSeen = new Set(seenBindings).add(binding);
    const definitions = [];
    if (binding.path.isVariableDeclarator?.() && binding.path.get('init')?.node) {
      definitions.push(...expressionDefinitionPaths(binding.path.get('init'), nextSeen));
    }
    for (const violation of binding.constantViolations || []) {
      if (violation.isAssignmentExpression?.()) {
        definitions.push(...expressionDefinitionPaths(violation.get('right'), nextSeen));
      }
    }
    return definitions;
  }
  if (pathRef.isConditionalExpression?.()) {
    return [
      ...expressionDefinitionPaths(pathRef.get('consequent'), new Set(seenBindings)),
      ...expressionDefinitionPaths(pathRef.get('alternate'), new Set(seenBindings)),
    ];
  }
  if (pathRef.isLogicalExpression?.()) {
    return [
      ...expressionDefinitionPaths(pathRef.get('left'), new Set(seenBindings)),
      ...expressionDefinitionPaths(pathRef.get('right'), new Set(seenBindings)),
    ];
  }
  return [pathRef];
}

function objectPropertyValuePaths(receiverPath, propertyNames, dynamicProperty, seenBindings = new Set()) {
  const values = [];
  for (const definition of expressionDefinitionPaths(receiverPath, seenBindings)) {
    if (definition.isObjectExpression?.()) {
      for (const propertyPath of definition.get('properties')) {
        if (propertyPath.isSpreadElement?.()) {
          const spreadDefinitions = expressionDefinitionPaths(propertyPath.get('argument'), seenBindings);
          for (const spread of spreadDefinitions) {
            if (!spread.isObjectExpression?.()) continue;
            for (const nested of spread.get('properties')) {
              if (
                nested.isObjectProperty?.()
                && (dynamicProperty || propertyNames.includes(propertyName(nested.node.key)))
              ) values.push(nested.get('value'));
            }
          }
        } else if (
          propertyPath.isObjectProperty?.()
          && (dynamicProperty || propertyNames.includes(propertyName(propertyPath.node.key)))
        ) {
          values.push(propertyPath.get('value'));
        }
      }
    } else if (definition.isArrayExpression?.()) {
      const elements = definition.get('elements').filter(element => element?.node);
      if (dynamicProperty) values.push(...elements);
      else {
        for (const property of propertyNames) {
          if (/^\d+$/.test(property) && elements[Number(property)]) values.push(elements[Number(property)]);
        }
      }
    }
  }
  return values;
}

function memberPropertyResolution(memberPath) {
  if (!memberPath?.node) return { names: [], dynamic: true };
  if (!memberPath.node.computed) {
    const name = propertyName(memberPath.node.property);
    return { names: name ? [name] : [], dynamic: !name };
  }
  const propertyPath = memberPath.get('property');
  if (propertyPath.isStringLiteral?.() || propertyPath.isNumericLiteral?.()) {
    return { names: [propertyName(propertyPath.node)], dynamic: false };
  }
  const resolution = staticStringResolution(propertyPath);
  return {
    names: resolution.values.map(value => String(value)).filter(Boolean),
    dynamic: !resolution.complete || resolution.values.length === 0,
  };
}

function memberValuePaths(memberPath, seenBindings = new Set()) {
  if (!memberPath?.node) return [];
  const property = memberPropertyResolution(memberPath);
  return objectPropertyValuePaths(
    memberPath.get('object'),
    property.names,
    property.dynamic,
    seenBindings,
  );
}

function functionArgumentPathsForParameter(binding) {
  if (!binding || binding.kind !== 'param') return [];
  const localName = binding.identifier?.name;
  const functionPath = binding.path.findParent?.(candidate => candidate.isFunction?.());
  if (!localName || !functionPath) return [];
  const parameterIndex = (functionPath.node.params || [])
    .findIndex(parameter => boundIdentifiers(parameter).includes(localName));
  if (parameterIndex < 0) return [];

  let functionBinding = null;
  if (functionPath.isFunctionDeclaration?.() && functionPath.node.id?.name) {
    functionBinding = functionPath.parentPath?.scope?.getBinding(functionPath.node.id.name) || null;
  } else if (
    (functionPath.isFunctionExpression?.() || functionPath.isArrowFunctionExpression?.())
    && functionPath.parentPath?.isVariableDeclarator?.()
    && functionPath.parentPath.node.id?.type === 'Identifier'
  ) {
    functionBinding = functionPath.parentPath.scope.getBinding(functionPath.parentPath.node.id.name) || null;
  }
  if (!functionBinding) return [];
  return (functionBinding.referencePaths || []).flatMap(reference => {
    const callPath = reference.parentPath;
    if (!callPath?.isCallExpression?.() && !callPath?.isOptionalCallExpression?.()) return [];
    if (callPath.get('callee').node !== reference.node) return [];
    const argument = callPath.get(`arguments.${parameterIndex}`);
    return argument?.node ? [argument] : [];
  });
}

function callableProvenance(pathRef, {
  baseNames,
  allowImport = false,
  allowNamedIdentifier = true,
  allowMember = () => true,
  evidence = null,
}, seenBindings = new Set()) {
  const resolved = new Set();
  if (!pathRef?.node) return resolved;
  const node = pathRef.node;
  if (seenBindings.has(node)) return resolved;
  seenBindings = new Set(seenBindings).add(node);

  if (pathRef.isIdentifier?.()) {
    const name = node.name;
    const binding = pathRef.scope.getBinding(name);
    // Conventional dependency parameters intentionally retain their semantic
    // name. A local alias is resolved through its binding below.
    if (allowNamedIdentifier && baseNames.has(name)) {
      resolved.add(name);
      recordCallableOrigin(evidence, pathRef, name);
    }
    if (!binding || seenBindings.has(binding)) {
      recordResolvedCallableUse(evidence, pathRef, resolved);
      return resolved;
    }
    const nextSeen = new Set(seenBindings).add(binding);
    const bindingPath = binding.path;

    if (bindingPath.isImportSpecifier?.() && allowImport) {
      const importedName = propertyName(bindingPath.node.imported);
      if (baseNames.has(importedName)) {
        resolved.add(importedName);
        recordCallableOrigin(evidence, bindingPath, importedName);
      }
    }

    if (bindingPath.isVariableDeclarator?.()) {
      if (bindingPath.node.id?.type === 'Identifier') {
        addAll(resolved, callableProvenance(bindingPath.get('init'), {
          baseNames,
          allowImport,
          allowNamedIdentifier,
          allowMember,
          evidence,
        }, nextSeen));
      } else {
        const sourceName = destructuredSourceName(bindingPath.node.id, name);
        const receiverPath = bindingPath.get('init');
        if (baseNames.has(sourceName) && allowMember(sourceName, receiverPath)) {
          resolved.add(sourceName);
          recordCallableOrigin(evidence, bindingPath, sourceName);
        }
        for (const valuePath of objectPropertyValuePaths(receiverPath, [sourceName], false, nextSeen)) {
          addAll(resolved, callableProvenance(valuePath, {
            baseNames,
            allowImport,
            allowNamedIdentifier,
            allowMember,
            evidence,
          }, nextSeen));
        }
      }
    } else if (bindingPath.isObjectPattern?.()) {
      const sourceName = destructuredSourceName(bindingPath.node, name);
      if (baseNames.has(sourceName) && allowMember(sourceName, null)) {
        resolved.add(sourceName);
        recordCallableOrigin(evidence, bindingPath, sourceName);
      }
    }

    for (const violation of binding.constantViolations || []) {
      if (!violation.isAssignmentExpression?.()) continue;
      if (!boundIdentifiers(violation.node.left).includes(name)) continue;
      addAll(resolved, callableProvenance(violation.get('right'), {
        baseNames,
        allowImport,
        allowNamedIdentifier,
        allowMember,
        evidence,
      }, nextSeen));
    }
    for (const argumentPath of functionArgumentPathsForParameter(binding)) {
      addAll(resolved, callableProvenance(argumentPath, {
        baseNames,
        allowImport,
        allowNamedIdentifier,
        allowMember,
        evidence,
      }, nextSeen));
    }
    recordResolvedCallableUse(evidence, pathRef, resolved);
    return resolved;
  }

  if (pathRef.isMemberExpression?.() || pathRef.isOptionalMemberExpression?.()) {
    const property = memberPropertyResolution(pathRef);
    for (const name of property.names) {
      if (baseNames.has(name) && allowMember(name, pathRef.get('object'))) {
        resolved.add(name);
        recordCallableOrigin(evidence, pathRef, name);
      }
    }
    for (const valuePath of memberValuePaths(pathRef, seenBindings)) {
      addAll(resolved, callableProvenance(valuePath, {
        baseNames,
        allowImport,
        allowNamedIdentifier,
        allowMember,
        evidence,
      }, new Set(seenBindings)));
    }
    recordResolvedCallableUse(evidence, pathRef, resolved);
    return resolved;
  }

  if (pathRef.isCallExpression?.() || pathRef.isOptionalCallExpression?.()) {
    const calleePath = pathRef.get('callee');
    if (
      (calleePath.isMemberExpression?.() || calleePath.isOptionalMemberExpression?.())
      && propertyName(calleePath.node.property) === 'bind'
    ) {
      return callableProvenance(calleePath.get('object'), {
        baseNames,
        allowImport,
        allowNamedIdentifier,
        allowMember,
        evidence,
      }, seenBindings);
    }
    return resolved;
  }

  if (pathRef.isConditionalExpression?.()) {
    addAll(resolved, callableProvenance(pathRef.get('consequent'), {
      baseNames,
      allowImport,
      allowNamedIdentifier,
      allowMember,
      evidence,
    }, new Set(seenBindings)));
    addAll(resolved, callableProvenance(pathRef.get('alternate'), {
      baseNames,
      allowImport,
      allowNamedIdentifier,
      allowMember,
      evidence,
    }, new Set(seenBindings)));
  } else if (pathRef.isLogicalExpression?.()) {
    addAll(resolved, callableProvenance(pathRef.get('left'), {
      baseNames,
      allowImport,
      allowNamedIdentifier,
      allowMember,
      evidence,
    }, new Set(seenBindings)));
    addAll(resolved, callableProvenance(pathRef.get('right'), {
      baseNames,
      allowImport,
      allowNamedIdentifier,
      allowMember,
      evidence,
    }, new Set(seenBindings)));
  } else if (pathRef.isSequenceExpression?.()) {
    const expressions = pathRef.get('expressions');
    if (expressions.length > 0) {
      addAll(resolved, callableProvenance(expressions.at(-1), {
        baseNames,
        allowImport,
        allowNamedIdentifier,
        allowMember,
        evidence,
      }, seenBindings));
    }
  }
  return resolved;
}

function enclosingFunctionName(pathRef) {
  let cursor = pathRef;
  while (cursor) {
    if (cursor.isFunctionDeclaration?.() && cursor.node.id?.name) return cursor.node.id.name;
    if (
      (cursor.isFunctionExpression?.() || cursor.isArrowFunctionExpression?.())
      && cursor.parentPath?.isVariableDeclarator?.()
    ) {
      return propertyName(cursor.parentPath.node.id) || '<anonymous>';
    }
    if (cursor.isObjectMethod?.() || cursor.isClassMethod?.()) {
      return propertyName(cursor.node.key) || '<anonymous>';
    }
    cursor = cursor.parentPath;
  }
  return '<module>';
}

function staticStringResolution(pathRef, seenBindings = new Set()) {
  if (!pathRef?.node) return { values: [], complete: false };
  const node = pathRef.node;
  if (node.type === 'StringLiteral') return { values: [node.value], complete: true };
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return { values: [node.quasis.map(quasi => quasi.value.cooked).join('')], complete: true };
  }
  if (node.type === 'Identifier') {
    const binding = pathRef.scope.getBinding(node.name);
    if (binding?.constant && !seenBindings.has(binding.path)) {
      seenBindings.add(binding.path);
      if (binding.path.isVariableDeclarator?.()) {
        return staticStringResolution(binding.path.get('init'), seenBindings);
      }
    }
  }
  if (node.type === 'ConditionalExpression') {
    const consequent = staticStringResolution(pathRef.get('consequent'), new Set(seenBindings));
    const alternate = staticStringResolution(pathRef.get('alternate'), new Set(seenBindings));
    return {
      values: [...consequent.values, ...alternate.values],
      complete: consequent.complete && alternate.complete,
    };
  }
  if (node.type === 'LogicalExpression') {
    const left = staticStringResolution(pathRef.get('left'), new Set(seenBindings));
    const right = staticStringResolution(pathRef.get('right'), new Set(seenBindings));
    return {
      values: [...left.values, ...right.values],
      complete: left.complete && right.complete,
    };
  }
  const evaluation = pathRef.evaluate?.();
  if (evaluation?.confident && typeof evaluation.value === 'string') {
    return { values: [evaluation.value], complete: true };
  }
  return { values: [], complete: false };
}

function staticStringValues(pathRef, seenBindings = new Set()) {
  return staticStringResolution(pathRef, seenBindings).values;
}

function arrayExpressionElements(pathRef, seenBindings = new Set()) {
  if (!pathRef?.node) return null;
  if (pathRef.isArrayExpression?.()) {
    const elements = pathRef.get('elements');
    return elements.every(element => element?.node) ? elements : null;
  }
  if (pathRef.isIdentifier?.()) {
    const binding = pathRef.scope.getBinding(pathRef.node.name);
    if (binding?.constant && !seenBindings.has(binding)) {
      const nextSeen = new Set(seenBindings).add(binding);
      if (binding.path.isVariableDeclarator?.()) {
        return arrayExpressionElements(binding.path.get('init'), nextSeen);
      }
    }
  }
  return null;
}

function invocationDetails(pathRef, resolver) {
  const directArguments = pathRef.get('arguments');
  const calleePath = pathRef.get('callee');
  if (
    (calleePath.isMemberExpression?.() || calleePath.isOptionalMemberExpression?.())
    && propertyName(calleePath.node.property) === 'call'
  ) {
    return {
      provenance: resolver(calleePath.get('object')),
      argumentPaths: directArguments.slice(1),
      argumentsComplete: true,
    };
  }
  if (
    (calleePath.isMemberExpression?.() || calleePath.isOptionalMemberExpression?.())
    && propertyName(calleePath.node.property) === 'apply'
  ) {
    const receiver = calleePath.get('object');
    if (receiver.isIdentifier?.({ name: 'Reflect' })) {
      const applied = arrayExpressionElements(directArguments[2]);
      return {
        provenance: resolver(directArguments[0]),
        argumentPaths: applied || [],
        argumentsComplete: Boolean(applied),
      };
    }
    const applied = arrayExpressionElements(directArguments[1]);
    return {
      provenance: resolver(receiver),
      argumentPaths: applied || [],
      argumentsComplete: Boolean(applied),
    };
  }
  return {
    provenance: resolver(calleePath),
    argumentPaths: directArguments,
    argumentsComplete: true,
  };
}

function collectionNamesInCall({ writerNames, argumentPaths, argumentsComplete }) {
  const collections = new Set();
  const firstArgument = argumentPaths[0];
  let dynamic = !argumentsComplete;
  const names = [...writerNames];
  const allSingle = names.length > 0 && names.every(name => SINGLE_COLLECTION_WRITERS.has(name));
  const allBatch = names.length > 0 && names.every(name => BATCH_COLLECTION_WRITERS.has(name));
  if (allSingle) {
    const resolution = staticStringResolution(firstArgument);
    for (const value of resolution.values) collections.add(value);
    if (!resolution.complete) dynamic = true;
  } else if (allBatch) {
    if (!firstArgument?.node) dynamic = true;
    const binding = firstArgument?.isIdentifier?.()
      ? firstArgument.scope.getBinding(firstArgument.node.name)
      : null;
    // A named batch can be appended to or produced through control flow beyond
    // its initializer. Keep any statically visible names for evidence, but
    // require an exact policy bound for the complete set.
    if (firstArgument?.isIdentifier?.()) dynamic = true;
    const root = binding?.path?.isVariableDeclarator?.()
      ? binding.path.get('init')
      : firstArgument;
    if (!root?.node) dynamic = true;
    if (
      !firstArgument?.isIdentifier?.()
      && root?.isArrayExpression?.()
      && root.node.elements.length === 0
    ) dynamic = false;
    let sawNameProperty = false;
    root?.traverse?.({
      ObjectProperty(propertyPath) {
        if (propertyName(propertyPath.node.key) !== 'name') return;
        sawNameProperty = true;
        const resolution = staticStringResolution(propertyPath.get('value'));
        if (!resolution.complete) dynamic = true;
        for (const value of resolution.values) collections.add(value);
      },
      SpreadElement() {
        dynamic = true;
      },
    });
    if (!sawNameProperty && !root?.isArrayExpression?.()) dynamic = true;
  } else {
    // Semantic adapters accept domain commands rather than storage-shaped
    // arguments. A call that can resolve to multiple storage signatures is
    // likewise policy-bound rather than guessed from one possible branch.
    dynamic = true;
  }
  return {
    collections: [...collections].filter(Boolean).sort(),
    dynamic,
  };
}

function normalizedNodeSource(source, node) {
  return normalizedText(source.slice(node.start, node.end));
}

function siteFingerprint(site) {
  return sha256(stableJson({
    file: site.file,
    function: site.function,
    kind: site.kind,
    callee: site.callee,
    source: site.source,
    scopeSourceSha256: site.scopeSourceSha256,
  }));
}

function createSite({
  file,
  pathRef,
  source,
  kind,
  callee,
  collections = [],
  dynamicCollections = false,
  tables = [],
  dynamicSqlObjects = false,
  sql = null,
}) {
  const scopePath = pathRef.findParent?.(candidate => candidate.isFunction?.());
  const scopeNode = scopePath?.node || pathRef.hub?.file?.ast?.program || null;
  const site = {
    file,
    line: Number(pathRef.node.loc?.start?.line || 0),
    function: enclosingFunctionName(pathRef),
    kind,
    callee,
    source: normalizedNodeSource(source, pathRef.node),
    scopeSourceSha256: scopeNode
      ? sha256(normalizedNodeSource(source, scopeNode))
      : sha256(normalizedText(source)),
    collections: [...new Set(collections)].sort(),
    dynamicCollections,
    tables: [...new Set(tables)].sort(),
    dynamicSqlObjects,
    ...(sql === null ? {} : { sql: normalizedText(sql) }),
  };
  return site;
}

function assignStableSiteFingerprints(sites) {
  const counts = new Map();
  return sites.map(site => {
    const signature = siteFingerprint(site);
    const occurrence = (counts.get(signature) || 0) + 1;
    counts.set(signature, occurrence);
    return {
      ...site,
      occurrence,
      fingerprint: sha256(stableJson({ signature, occurrence })),
    };
  });
}

function sqlSource(pathRef, source, seenBindings = new Set()) {
  if (!pathRef?.node) return '';
  const node = pathRef.node;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral') {
    let result = '';
    for (let index = 0; index < node.quasis.length; index += 1) {
      result += node.quasis[index].value.cooked;
      if (node.expressions[index]) {
        result += ` {{${normalizedNodeSource(source, node.expressions[index])}}} `;
      }
    }
    return result;
  }
  if (node.type === 'Identifier') {
    const binding = pathRef.scope.getBinding(node.name);
    if (binding?.constant && !seenBindings.has(binding.path)) {
      seenBindings.add(binding.path);
      if (binding.path.isVariableDeclarator?.()) return sqlSource(binding.path.get('init'), source, seenBindings);
    }
  }
  const evaluation = pathRef.evaluate?.();
  if (evaluation?.confident && typeof evaluation.value === 'string') return evaluation.value;
  return normalizedNodeSource(source, node);
}

function hasCompleteStaticSql(pathRef, seenBindings = new Set()) {
  if (!pathRef?.node) return false;
  const node = pathRef.node;
  if (node.type === 'StringLiteral') return true;
  if (node.type === 'TemplateLiteral') return node.expressions.length === 0;
  if (node.type === 'Identifier') {
    const binding = pathRef.scope.getBinding(node.name);
    if (binding?.constant && !seenBindings.has(binding.path)) {
      seenBindings.add(binding.path);
      if (binding.path.isVariableDeclarator?.()) {
        return hasCompleteStaticSql(binding.path.get('init'), seenBindings);
      }
    }
    return false;
  }
  const evaluation = pathRef.evaluate?.();
  return Boolean(evaluation?.confident && typeof evaluation.value === 'string');
}

function sqlTables(sql) {
  const tables = new Set();
  const normalized = String(sql || '')
    .replace(/\{\{[^}]+\}\}/g, ' DYNAMIC_SQL_OBJECT ')
    .replace(/[`"\[\]]/g, ' ')
    .replace(/\s*\.\s*/g, '.');
  const patterns = [
    /\bINSERT(?:\s+OR\s+[A-Z_]+)?\s+INTO\s+([A-Z_][A-Z0-9_.$-]*)/gi,
    /\bREPLACE\s+INTO\s+([A-Z_][A-Z0-9_.$-]*)/gi,
    /\bUPDATE\s+([A-Z_][A-Z0-9_.$-]*)\s+SET\b/gi,
    /\bDELETE\s+FROM\s+([A-Z_][A-Z0-9_.$-]*)/gi,
    /\bCREATE\s+(?:VIRTUAL\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Z_][A-Z0-9_.$-]*)/gi,
    /\bDROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+([A-Z_][A-Z0-9_.$-]*)/gi,
    /\bALTER\s+TABLE\s+([A-Z_][A-Z0-9_.$-]*)/gi,
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+[A-Z_][A-Z0-9_.$-]*\s+ON\s+([A-Z_][A-Z0-9_.$-]*)/gi,
    /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER(?:\s+IF\s+NOT\s+EXISTS)?\s+[A-Z_][A-Z0-9_.$-]*[\s\S]*?\bON\s+(?:MAIN\.)?([A-Z_][A-Z0-9_.$-]*)/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(normalized))) {
      if (!['ON', 'SET', 'IF', 'NOT', 'EXISTS', 'DYNAMIC_SQL_OBJECT'].includes(match[1].toUpperCase())) {
        const object = match[1].replace(/\.+$/, '');
        if (object) tables.add(object);
      }
    }
  }
  return [...tables].sort();
}

function sqlHasWriteIntent(sql) {
  return /\b(?:INSERT|REPLACE|UPDATE|DELETE|CREATE|ALTER|DROP|VACUUM|ATTACH|DETACH)\b/i
    .test(normalizedText(sql));
}

function sqlHasProvenReadIntent(sql) {
  const value = normalizedText(sql).replace(/^;+/, '').trim();
  if (!value || sqlHasWriteIntent(value)) return false;
  if (/^PRAGMA\b/i.test(value)) {
    return !isWritePragma(value.replace(/^PRAGMA\s+/i, ''));
  }
  return /^(?:SELECT|WITH|EXPLAIN)\b/i.test(value);
}

function isSqlTransactionControl(sql) {
  return /^(?:BEGIN(?:\s+IMMEDIATE|\s+EXCLUSIVE|\s+DEFERRED)?|COMMIT|END|ROLLBACK(?:\s+TO(?:\s+SAVEPOINT)?\s+\S+)?|SAVEPOINT\s+\S+|RELEASE(?:\s+SAVEPOINT)?\s+\S+)$/i
    .test(normalizedText(sql).replace(/;$/, ''));
}

function isProvenRegExpIterableExpression(pathRef, seenBindings = new Set()) {
  if (!pathRef?.node) return false;
  if (pathRef.isArrayExpression?.()) {
    const elements = pathRef.get('elements');
    return elements.length > 0 && elements.every(element => (
      element?.node && isProvenRegExpExpression(element, seenBindings)
    ));
  }
  if (pathRef.isIdentifier?.()) {
    const binding = pathRef.scope.getBinding(pathRef.node.name);
    if (!binding || !binding.constant || seenBindings.has(binding)) return false;
    const nextSeen = new Set(seenBindings).add(binding);
    return binding.path.isVariableDeclarator?.()
      && isProvenRegExpIterableExpression(binding.path.get('init'), nextSeen);
  }
  return false;
}

function isProvenRegExpExpression(pathRef, seenBindings = new Set()) {
  if (!pathRef?.node) return false;
  if (pathRef.isRegExpLiteral?.()) return true;
  if (pathRef.isIdentifier?.()) {
    const binding = pathRef.scope.getBinding(pathRef.node.name);
    if (!binding || !binding.constant || seenBindings.has(binding)) return false;
    const nextSeen = new Set(seenBindings).add(binding);
    if (!binding.path.isVariableDeclarator?.()) return false;
    const init = binding.path.get('init');
    if (init?.node) return isProvenRegExpExpression(init, nextSeen);
    const declaration = binding.path.parentPath;
    const forOf = declaration?.parentPath;
    return Boolean(
      declaration?.isVariableDeclaration?.()
      && forOf?.isForOfStatement?.()
      && forOf.get('left').node === declaration.node
      && isProvenRegExpIterableExpression(forOf.get('right'), nextSeen)
    );
  }
  if (pathRef.isNewExpression?.() || pathRef.isCallExpression?.()) {
    const calleePath = pathRef.get('callee');
    return calleePath?.isIdentifier?.({ name: 'RegExp' })
      && !calleePath.scope.getBinding('RegExp');
  }
  if (pathRef.isParenthesizedExpression?.()) {
    return isProvenRegExpExpression(pathRef.get('expression'), seenBindings);
  }
  return false;
}

function sqlReceiverAllowed(method, object) {
  return method !== 'exec' || !isProvenRegExpExpression(object);
}

function appWriterProvenance(pathRef, evidence = null) {
  return callableProvenance(pathRef, {
    baseNames: APP_DATA_WRITER_NAMES,
    allowImport: true,
    evidence,
  });
}

function backupWriterProvenance(pathRef, evidence = null) {
  return callableProvenance(pathRef, {
    baseNames: SQLITE_BACKUP_WRITER_NAMES,
    allowImport: true,
    evidence,
  });
}

function sqlMethodProvenance(pathRef, evidence = null) {
  return callableProvenance(pathRef, {
    baseNames: SQL_CALLABLE_METHODS,
    allowNamedIdentifier: false,
    allowMember: sqlReceiverAllowed,
    evidence,
  });
}

function preparedStatementRunCalls(preparePath) {
  const parent = preparePath.parentPath;
  if (
    parent?.isMemberExpression?.()
    && calleeName(parent.node) === SQL_RUN_METHOD
    && parent.parentPath?.isCallExpression?.()
  ) return [parent.parentPath];
  if (!parent?.isVariableDeclarator?.() || parent.node.id?.type !== 'Identifier') return [];
  const binding = parent.scope.getBinding(parent.node.id.name);
  return (binding?.referencePaths || [])
    .filter(reference => (
      reference.parentPath?.isMemberExpression?.()
      && calleeName(reference.parentPath.node) === SQL_RUN_METHOD
      && reference.parentPath.parentPath?.isCallExpression?.()
    ))
    .map(reference => reference.parentPath.parentPath);
}

function preparedStatementRuns(preparePath) {
  return preparedStatementRunCalls(preparePath).length > 0;
}

const STATEMENT_READ_METHODS = new Set(['all', 'get', 'iterate']);
const STATEMENT_CHAIN_METHODS = new Set(['columns', 'expand', 'pluck', 'raw', 'safeIntegers']);

function mergeStatementUsage(target, source) {
  target.mayWrite ||= source.mayWrite;
  target.readOnly ||= source.readOnly;
  target.escaped ||= source.escaped;
  return target;
}

function preparedStatementUsage(expressionPath, seenBindings = new Set()) {
  const usage = { mayWrite: false, readOnly: false, escaped: false };
  if (!expressionPath?.node) return usage;
  const parent = expressionPath.parentPath;
  if (!parent) return usage;

  if (
    (parent.isMemberExpression?.() || parent.isOptionalMemberExpression?.())
    && parent.get('object').node === expressionPath.node
  ) {
    const property = memberPropertyResolution(parent);
    if (property.dynamic) usage.escaped = true;
    for (const method of property.names) {
      if (method === 'run') usage.mayWrite = true;
      else if (STATEMENT_READ_METHODS.has(method)) usage.readOnly = true;
      else if (STATEMENT_CHAIN_METHODS.has(method)) {
        const chainCall = parent.parentPath;
        if (
          (chainCall?.isCallExpression?.() || chainCall?.isOptionalCallExpression?.())
          && chainCall.get('callee').node === parent.node
        ) mergeStatementUsage(usage, preparedStatementUsage(chainCall, seenBindings));
        else usage.escaped = true;
      } else usage.escaped = true;
    }
    return usage;
  }

  if (parent.isVariableDeclarator?.() && parent.get('init').node === expressionPath.node) {
    if (parent.node.id?.type === 'Identifier') {
      const binding = parent.scope.getBinding(parent.node.id.name);
      if (!binding || seenBindings.has(binding)) {
        usage.escaped = true;
        return usage;
      }
      const nextSeen = new Set(seenBindings).add(binding);
      for (const reference of binding.referencePaths || []) {
        mergeStatementUsage(usage, preparedStatementUsage(reference, nextSeen));
      }
      for (const violation of binding.constantViolations || []) {
        if (violation.isAssignmentExpression?.()) usage.escaped = true;
      }
      return usage;
    }
    if (parent.node.id?.type === 'ObjectPattern') {
      const properties = parent.node.id.properties || [];
      for (const propertyNode of properties) {
        if (propertyNode.type !== 'ObjectProperty') {
          usage.escaped = true;
          continue;
        }
        const method = propertyName(propertyNode.key);
        if (method === 'run') usage.mayWrite = true;
        else if (STATEMENT_READ_METHODS.has(method)) usage.readOnly = true;
        else usage.escaped = true;
      }
      return usage;
    }
    usage.escaped = true;
    return usage;
  }

  if (parent.isAssignmentExpression?.() && parent.get('right').node === expressionPath.node) {
    usage.escaped = true;
    return usage;
  }
  if (parent.isExpressionStatement?.()) return usage;
  if (parent.isAwaitExpression?.() || parent.isParenthesizedExpression?.()) {
    return preparedStatementUsage(parent, seenBindings);
  }

  // Passing, returning, or storing a Statement in an unanalysed container can
  // expose .run() elsewhere. Treat that escape as write-capable for inventory
  // purposes instead of silently assuming a read-only lifecycle.
  usage.escaped = true;
  return usage;
}

function rawAppDataSelectorLiterals(sql) {
  const collections = new Set();
  const source = String(sql || '');
  const literalPattern = /['"]([a-z][a-z0-9_]*)['"]/gi;
  const equalityPatterns = [
    /\bname\s*=\s*(['"][a-z][a-z0-9_]*['"])/gi,
    /(['"][a-z][a-z0-9_]*['"])\s*=\s*\bname\b/gi,
  ];
  for (const pattern of equalityPatterns) {
    for (const match of source.matchAll(pattern)) {
      const literal = /^['"]([a-z][a-z0-9_]*)['"]$/i.exec(match[1])?.[1];
      if (literal) collections.add(literal);
    }
  }
  for (const match of source.matchAll(/\bname\s+IN\s*\(([^)]*)\)/gi)) {
    for (const literal of match[1].matchAll(literalPattern)) collections.add(literal[1]);
  }
  return [...collections].sort();
}

function maskSqlStringsAndComments(sql) {
  const source = String(sql || '');
  const result = [...source];
  let index = 0;
  while (index < source.length) {
    if (source[index] === '-' && source[index + 1] === '-') {
      result[index] = ' ';
      result[index + 1] = ' ';
      index += 2;
      while (index < source.length && source[index] !== '\n') result[index++] = ' ';
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      result[index] = ' ';
      result[index + 1] = ' ';
      index += 2;
      while (index < source.length) {
        if (source[index] === '*' && source[index + 1] === '/') {
          result[index] = ' ';
          result[index + 1] = ' ';
          index += 2;
          break;
        }
        result[index++] = ' ';
      }
      continue;
    }
    if (source[index] === "'" || source[index] === '"') {
      const quote = source[index];
      result[index++] = ' ';
      while (index < source.length) {
        result[index] = ' ';
        if (source[index] === quote) {
          if (source[index + 1] === quote) {
            result[index + 1] = ' ';
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    index += 1;
  }
  return result.join('');
}

function sqlParameterTokens(maskedSql) {
  const tokens = [];
  const namedIndexes = new Map();
  let nextIndex = 0;
  for (const match of String(maskedSql || '').matchAll(/\?(?:[1-9][0-9]*)?|[:@$][A-Za-z_][A-Za-z0-9_]*/g)) {
    const raw = match[0];
    let positionalIndex = null;
    let namedKey = null;
    if (raw === '?') {
      positionalIndex = nextIndex;
      nextIndex += 1;
    } else if (raw.startsWith('?')) {
      positionalIndex = Number(raw.slice(1)) - 1;
      nextIndex = Math.max(nextIndex, positionalIndex + 1);
    } else {
      namedKey = raw.slice(1);
      if (!namedIndexes.has(raw)) namedIndexes.set(raw, nextIndex++);
    }
    tokens.push({
      raw,
      start: match.index,
      end: match.index + raw.length,
      positionalIndex,
      namedKey,
    });
  }
  return tokens;
}

function matchingSqlParen(maskedSql, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < maskedSql.length; index += 1) {
    if (maskedSql[index] === '(') depth += 1;
    else if (maskedSql[index] === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitSqlListRanges(maskedSql, start, end) {
  const ranges = [];
  let depth = 0;
  let itemStart = start;
  for (let index = start; index < end; index += 1) {
    if (maskedSql[index] === '(') depth += 1;
    else if (maskedSql[index] === ')') depth -= 1;
    else if (maskedSql[index] === ',' && depth === 0) {
      ranges.push([itemStart, index]);
      itemStart = index + 1;
    }
  }
  ranges.push([itemStart, end]);
  return ranges;
}

function appDataNameBindResolution(sql) {
  const source = String(sql || '');
  const masked = maskSqlStringsAndComments(source);
  const tokens = sqlParameterTokens(masked);
  const targetTokens = new Map();
  const literalCollections = new Set(rawAppDataSelectorLiterals(source));
  let hasNameSelector = literalCollections.size > 0;
  let complete = true;

  const addTokensInRange = (start, end) => {
    const matches = tokens.filter(token => token.start >= start && token.end <= end);
    for (const token of matches) targetTokens.set(`${token.start}:${token.end}`, token);
    return matches.length;
  };
  const selectorPatterns = [
    /\bname\s*=\s*(\?(?:[1-9][0-9]*)?|[:@$][A-Za-z_][A-Za-z0-9_]*)/gi,
    /(\?(?:[1-9][0-9]*)?|[:@$][A-Za-z_][A-Za-z0-9_]*)\s*=\s*\bname\b/gi,
  ];
  for (const pattern of selectorPatterns) {
    for (const match of masked.matchAll(pattern)) {
      hasNameSelector = true;
      const parameterStart = match.index + match[0].indexOf(match[1]);
      if (addTokensInRange(parameterStart, parameterStart + match[1].length) !== 1) complete = false;
    }
  }
  for (const match of masked.matchAll(/\bname\s+IN\s*\(([^)]*)\)/gi)) {
    hasNameSelector = true;
    const listStart = match.index + match[0].indexOf(match[1]);
    const listEnd = listStart + match[1].length;
    const parameterCount = addTokensInRange(listStart, listEnd);
    if (parameterCount === 0 && !/['"][a-z][a-z0-9_]*['"]/i.test(source.slice(listStart, listEnd))) {
      complete = false;
    }
  }

  const insertHeader = /\b(?:INSERT(?:\s+OR\s+[A-Z_]+)?\s+INTO|REPLACE\s+INTO)\s+(?:main\s*\.\s*)?app_data\s*\(/gi;
  for (const match of masked.matchAll(insertHeader)) {
    const columnsOpen = match.index + match[0].lastIndexOf('(');
    const columnsClose = matchingSqlParen(masked, columnsOpen);
    if (columnsClose < 0) {
      complete = false;
      continue;
    }
    const valuesMatch = /\s*VALUES\s*\(/iy;
    valuesMatch.lastIndex = columnsClose + 1;
    const valuesHeader = valuesMatch.exec(masked);
    if (!valuesHeader) {
      complete = false;
      continue;
    }
    const valuesOpen = valuesMatch.lastIndex - 1;
    const valuesClose = matchingSqlParen(masked, valuesOpen);
    if (valuesClose < 0) {
      complete = false;
      continue;
    }
    const columnRanges = splitSqlListRanges(masked, columnsOpen + 1, columnsClose);
    const valueRanges = splitSqlListRanges(masked, valuesOpen + 1, valuesClose);
    const nameIndex = columnRanges.findIndex(([start, end]) => masked.slice(start, end).trim().toLowerCase() === 'name');
    if (nameIndex < 0 || nameIndex >= valueRanges.length) {
      complete = false;
      continue;
    }
    hasNameSelector = true;
    const [valueStart, valueEnd] = valueRanges[nameIndex];
    const parameterCount = addTokensInRange(valueStart, valueEnd);
    const literalMatch = source.slice(valueStart, valueEnd).trim().match(/^['"]([a-z][a-z0-9_]*)['"]$/i);
    if (literalMatch) literalCollections.add(literalMatch[1]);
    if (parameterCount === 0 && !literalMatch) complete = false;
    if (/^\s*,\s*\(/.test(masked.slice(valuesClose + 1))) complete = false;
  }

  return {
    complete,
    hasNameSelector,
    literalCollections: [...literalCollections].sort(),
    targetTokens: [...targetTokens.values()].sort((left, right) => left.start - right.start),
  };
}

function resolveNamedRunArgument(runCall, namedKey) {
  const argumentsPaths = runCall.get('arguments');
  if (argumentsPaths.length !== 1 || !argumentsPaths[0].isObjectExpression?.()) {
    return { values: [], complete: false };
  }
  const properties = argumentsPaths[0].get('properties');
  const matches = properties.filter(propertyPath => (
    propertyPath.isObjectProperty?.()
    && propertyName(propertyPath.node.key) === namedKey
  ));
  if (matches.length !== 1) return { values: [], complete: false };
  return staticStringResolution(matches[0].get('value'));
}

function rawAppDataCollectionResolution(pathRef, sql, tables, { prepared = false } = {}) {
  if (!tables.includes('app_data') || !/\b(?:INSERT|REPLACE|UPDATE|DELETE)\b/i.test(sql)) {
    return { collections: [], dynamic: false };
  }
  const collections = new Set();
  const bindResolution = appDataNameBindResolution(sql);
  for (const collection of bindResolution.literalCollections) collections.add(collection);
  const runCalls = prepared
    ? preparedStatementRunCalls(pathRef)
    : [];
  let dynamic = !bindResolution.complete;
  for (const runCall of runCalls) {
    const resolvedAtCall = new Set();
    let callComplete = bindResolution.targetTokens.length > 0;
    for (const target of bindResolution.targetTokens) {
      const resolution = target.namedKey
        ? resolveNamedRunArgument(runCall, target.namedKey)
        : staticStringResolution(runCall.get(`arguments.${target.positionalIndex}`));
      for (const value of resolution.values) resolvedAtCall.add(value);
      if (!resolution.complete || resolution.values.length === 0) callComplete = false;
    }
    for (const value of resolvedAtCall) collections.add(value);
    if (!callComplete) dynamic = true;
  }
  if (runCalls.length === 0 && bindResolution.targetTokens.length > 0) dynamic = true;
  if (!bindResolution.hasNameSelector && collections.size === 0) {
    if (/\b(?:UPDATE\s+app_data\b|DELETE\s+FROM\s+app_data\b)/i.test(sql)) {
      for (const collection of ALL_APP_DATA_COLLECTIONS) collections.add(collection);
    } else {
      dynamic = true;
    }
  }
  return { collections: [...collections].sort(), dynamic };
}

function rawAppDataMutationPotential(site, tables) {
  if (!site.kind.startsWith('SQL_') || !tables.includes('app_data')) return false;
  if ([
    'SQL_CONNECTION_GUARD',
    'SQL_PRAGMA_WRITE',
    'SQL_READONLY_PREPARE_GUARD',
    'SQL_TRANSACTION_CONTROL',
  ].includes(site.kind)) return false;
  const sql = normalizedText(site.sql || '');
  if (/\b(?:INSERT|REPLACE|UPDATE|DELETE)\b/i.test(sql)) return true;
  if (!site.dynamicSqlObjects) return false;
  return !/^(?:CREATE|ALTER|DROP|PRAGMA|BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(sql);
}

const PROVEN_READ_PRAGMA_NAMES = new Set([
  'analysis_limit',
  'application_id',
  'auto_vacuum',
  'automatic_index',
  'busy_timeout',
  'cache_size',
  'cache_spill',
  'case_sensitive_like',
  'cell_size_check',
  'checkpoint_fullfsync',
  'collation_list',
  'compile_options',
  'database_list',
  'defer_foreign_keys',
  'encoding',
  'foreign_key_check',
  'foreign_keys',
  'freelist_count',
  'full_column_names',
  'fullfsync',
  'function_list',
  'hard_heap_limit',
  'ignore_check_constraints',
  'index_info',
  'index_list',
  'index_xinfo',
  'integrity_check',
  'journal_mode',
  'journal_size_limit',
  'legacy_alter_table',
  'locking_mode',
  'max_page_count',
  'mmap_size',
  'module_list',
  'page_count',
  'page_size',
  'pragma_list',
  'query_only',
  'quick_check',
  'read_uncommitted',
  'recursive_triggers',
  'reverse_unordered_selects',
  'schema_version',
  'secure_delete',
  'short_column_names',
  'soft_heap_limit',
  'synchronous',
  'table_info',
  'table_list',
  'table_xinfo',
  'temp_store',
  'threads',
  'trusted_schema',
  'user_version',
  'writable_schema',
]);
const PROVEN_READ_PRAGMA_ARGUMENT_NAMES = new Set([
  'foreign_key_check',
  'foreign_key_list',
  'index_info',
  'index_list',
  'index_xinfo',
  'integrity_check',
  'quick_check',
  'table_info',
  'table_list',
  'table_xinfo',
]);
const WRITE_ACTION_PRAGMA_NAMES = new Set([
  'incremental_vacuum',
  'optimize',
  'shrink_memory',
  'wal_checkpoint',
]);

function isWritePragma(sql) {
  const value = normalizedText(sql).toLowerCase().replace(/;$/, '').trim();
  if (!value || value.includes('=')) return true;
  const match = value.match(/^(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)(?:\s*\(([\s\S]*)\))?$/);
  if (!match) return true;
  const [, name, argument] = match;
  if (WRITE_ACTION_PRAGMA_NAMES.has(name)) return true;
  if (argument !== undefined) return !PROVEN_READ_PRAGMA_ARGUMENT_NAMES.has(name);
  return !PROVEN_READ_PRAGMA_NAMES.has(name);
}

function isConnectionGuardPragma(sql) {
  return /^(?:foreign_keys|query_only|busy_timeout)\s*=/i.test(normalizedText(sql));
}

function scanFile(rootDir, filePath) {
  const file = relativeSourcePath(rootDir, filePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const ast = parseSource(source, file);
  const sites = [];
  const accountedAppOrigins = new Set();
  const accountedBackupOrigins = new Set();
  const accountedSqlOrigins = new Set();
  const inspectCall = pathRef => {
    const callee = calleeName(pathRef.node.callee);
    const appInvocation = invocationDetails(
      pathRef,
      candidate => appWriterProvenance(candidate, accountedAppOrigins),
    );
    if (appInvocation.provenance.size > 0) {
      const resolution = collectionNamesInCall({
        writerNames: appInvocation.provenance,
        argumentPaths: appInvocation.argumentPaths,
        argumentsComplete: appInvocation.argumentsComplete,
      });
      sites.push(createSite({
        file,
        pathRef,
        source,
        kind: [...appInvocation.provenance].some(name => name.toLowerCase().includes('compareandswap'))
          ? 'APP_DATA_CAS'
          : 'APP_DATA_WRITE',
        callee,
        collections: resolution.collections,
        dynamicCollections: resolution.dynamic,
      }));
    }

    const backupInvocation = invocationDetails(
      pathRef,
      candidate => backupWriterProvenance(candidate, accountedBackupOrigins),
    );
    if (backupInvocation.provenance.size > 0) {
      sites.push(createSite({
        file,
        pathRef,
        source,
        kind: 'SQLITE_BACKUP_ARTIFACT',
        callee,
      }));
    }

    const sqlInvocation = invocationDetails(
      pathRef,
      candidate => sqlMethodProvenance(candidate, accountedSqlOrigins),
    );
    for (const sqlMethod of sqlInvocation.provenance) {
      const sqlPath = sqlInvocation.argumentPaths[0];
      const sql = sqlSource(sqlPath, source);
      const completeSql = sqlInvocation.argumentsComplete && hasCompleteStaticSql(sqlPath);
      if (sqlMethod === 'prepare') {
        const statementUsage = preparedStatementUsage(pathRef);
        const dynamicExecutionPotential = !completeSql && (
          statementUsage.mayWrite
          || statementUsage.readOnly
          || statementUsage.escaped
        );
        const preparedWritePragma = /^\s*PRAGMA\b/i.test(sql) && isWritePragma(
          String(sql).replace(/^\s*PRAGMA\s+/i, ''),
        );
        if (
          !statementUsage.mayWrite
          && !dynamicExecutionPotential
          && !sqlHasWriteIntent(sql)
          && !preparedWritePragma
        ) continue;
        const tables = sqlTables(sql);
        const collectionResolution = rawAppDataCollectionResolution(
          pathRef,
          sql,
          tables,
          { prepared: true },
        );
        sites.push(createSite({
          file,
          pathRef,
          source,
          kind: (
            (
              file === 'server/lib/sqlite-readonly-statement.js'
              && enclosingFunctionName(pathRef) === 'prepareSqliteReadonlyStatement'
            )
            || (
              file === 'server/lib/pre-compatibility-backup.js'
              && enclosingFunctionName(pathRef) === 'databaseLogicalDigest'
              && statementUsage.readOnly
              && !statementUsage.mayWrite
              && !statementUsage.escaped
            )
          ) ? 'SQL_READONLY_PREPARE_GUARD' : 'SQL_PREPARED_RUN',
          callee,
          collections: collectionResolution.collections,
          dynamicCollections: collectionResolution.dynamic,
          tables,
          dynamicSqlObjects: !completeSql,
          sql,
        }));
      } else if (SQL_WRITE_METHODS.has(sqlMethod)) {
        const tables = sqlTables(sql);
        const collectionResolution = rawAppDataCollectionResolution(pathRef, sql, tables);
        sites.push(createSite({
          file,
          pathRef,
          source,
          kind: isSqlTransactionControl(sql) ? 'SQL_TRANSACTION_CONTROL' : 'SQL_EXEC',
          callee,
          collections: collectionResolution.collections,
          dynamicCollections: collectionResolution.dynamic,
          tables,
          dynamicSqlObjects: !completeSql,
          sql,
        }));
      } else if (sqlMethod === 'pragma' && (!completeSql || isWritePragma(sql))) {
        sites.push(createSite({
          file,
          pathRef,
          source,
          kind: isConnectionGuardPragma(sql) ? 'SQL_CONNECTION_GUARD' : 'SQL_PRAGMA_WRITE',
          callee,
          dynamicSqlObjects: !completeSql,
          sql,
        }));
      } else if (sqlMethod === 'backup') {
        sites.push(createSite({
          file,
          pathRef,
          source,
          kind: 'SQLITE_BACKUP_ARTIFACT',
          callee,
        }));
      }
    }
  };
  traverse(ast, {
    CallExpression: inspectCall,
    OptionalCallExpression: inspectCall,
  });

  const escapeCandidates = new Map();
  const isNonCallableIntrospection = pathRef => (
    pathRef.parentPath?.isUnaryExpression?.({ operator: 'typeof' })
  );
  const addEscapeCandidate = (pathRef, name, kind) => {
    const key = callableOriginKey(pathRef, name);
    if (!key || escapeCandidates.has(key)) return;
    const accounted = kind === 'APP_DATA_CALLABLE_ESCAPE'
      ? accountedAppOrigins
      : kind === 'SQL_CALLABLE_ESCAPE'
        ? accountedSqlOrigins
        : accountedBackupOrigins;
    if (accounted.has(key)) return;
    escapeCandidates.set(key, { pathRef, name, kind });
  };
  const inspectDestructuring = pathRef => {
    const patternPath = pathRef.isVariableDeclarator?.() ? pathRef.get('id') : pathRef;
    const receiverPath = pathRef.isVariableDeclarator?.() ? pathRef.get('init') : null;
    for (const name of destructuredBaseNames(patternPath.node, APP_DATA_WRITER_NAMES)) {
      addEscapeCandidate(pathRef, name, 'APP_DATA_CALLABLE_ESCAPE');
    }
    for (const name of destructuredBaseNames(patternPath.node, SQLITE_BACKUP_WRITER_NAMES)) {
      addEscapeCandidate(pathRef, name, 'SQLITE_BACKUP_CALLABLE_ESCAPE');
    }
    for (const name of destructuredBaseNames(patternPath.node, SQL_ESCAPE_METHODS)) {
      if (sqlReceiverAllowed(name, receiverPath)) {
        addEscapeCandidate(pathRef, name, 'SQL_CALLABLE_ESCAPE');
      }
    }
  };
  traverse(ast, {
    ImportSpecifier(pathRef) {
      const name = propertyName(pathRef.node.imported);
      if (APP_DATA_WRITER_NAMES.has(name)) {
        addEscapeCandidate(pathRef, name, 'APP_DATA_CALLABLE_ESCAPE');
      }
      if (SQLITE_BACKUP_WRITER_NAMES.has(name)) {
        addEscapeCandidate(pathRef, name, 'SQLITE_BACKUP_CALLABLE_ESCAPE');
      }
    },
    ReferencedIdentifier(pathRef) {
      if (isNonCallableIntrospection(pathRef)) return;
      for (const name of appWriterProvenance(pathRef)) {
        addEscapeCandidate(pathRef, name, 'APP_DATA_CALLABLE_ESCAPE');
      }
      for (const name of backupWriterProvenance(pathRef)) {
        addEscapeCandidate(pathRef, name, 'SQLITE_BACKUP_CALLABLE_ESCAPE');
      }
      for (const name of sqlMethodProvenance(pathRef)) {
        if (SQL_ESCAPE_METHODS.has(name)) {
          addEscapeCandidate(pathRef, name, 'SQL_CALLABLE_ESCAPE');
        }
      }
    },
    MemberExpression(pathRef) {
      if (isNonCallableIntrospection(pathRef)) return;
      for (const name of appWriterProvenance(pathRef)) {
        addEscapeCandidate(pathRef, name, 'APP_DATA_CALLABLE_ESCAPE');
      }
      for (const name of backupWriterProvenance(pathRef)) {
        addEscapeCandidate(pathRef, name, 'SQLITE_BACKUP_CALLABLE_ESCAPE');
      }
      for (const name of sqlMethodProvenance(pathRef)) {
        if (SQL_ESCAPE_METHODS.has(name)) {
          addEscapeCandidate(pathRef, name, 'SQL_CALLABLE_ESCAPE');
        }
      }
    },
    OptionalMemberExpression(pathRef) {
      if (isNonCallableIntrospection(pathRef)) return;
      for (const name of appWriterProvenance(pathRef)) {
        addEscapeCandidate(pathRef, name, 'APP_DATA_CALLABLE_ESCAPE');
      }
      for (const name of backupWriterProvenance(pathRef)) {
        addEscapeCandidate(pathRef, name, 'SQLITE_BACKUP_CALLABLE_ESCAPE');
      }
      for (const name of sqlMethodProvenance(pathRef)) {
        if (SQL_ESCAPE_METHODS.has(name)) {
          addEscapeCandidate(pathRef, name, 'SQL_CALLABLE_ESCAPE');
        }
      }
    },
    VariableDeclarator(pathRef) {
      if (pathRef.get('id').isObjectPattern?.()) inspectDestructuring(pathRef);
    },
  });
  for (const { pathRef, name, kind } of escapeCandidates.values()) {
    sites.push(createSite({
      file,
      pathRef,
      source,
      kind,
      callee: name,
      dynamicCollections: kind === 'APP_DATA_CALLABLE_ESCAPE',
      dynamicSqlObjects: kind === 'SQL_CALLABLE_ESCAPE',
    }));
  }
  return assignStableSiteFingerprints(sites);
}

function matchesSourceAuthority(site, authority) {
  if (!Array.isArray(authority.files) || !authority.files.includes(site.file)) return false;
  if (Array.isArray(authority.kinds) && !authority.kinds.includes(site.kind)) return false;
  if (Array.isArray(authority.functions) && !authority.functions.includes(site.function)) return false;
  if (Array.isArray(authority.siteFingerprints) && !authority.siteFingerprints.includes(site.fingerprint)) return false;
  if (Array.isArray(authority.excludeSiteFingerprints) && authority.excludeSiteFingerprints.includes(site.fingerprint)) return false;
  return true;
}

function dynamicCollectionBound(site, policy) {
  const matches = (policy.dynamicCollectionBounds || []).filter(bound => (
    bound.siteFingerprint === site.fingerprint
  ));
  return matches.length === 1 ? matches[0] : null;
}

function dynamicSqlObjectBound(site, policy) {
  const matches = (policy.dynamicSqlObjectBounds || []).filter(bound => (
    bound.siteFingerprint === site.fingerprint
  ));
  return matches.length === 1 ? matches[0] : null;
}

function authorityForSite(site, policy) {
  const matches = (policy.sourceAuthorities || []).filter(authority => matchesSourceAuthority(site, authority));
  return matches.length === 1 ? matches[0] : null;
}

function isCallableEscapeSite(site) {
  return String(site?.kind || '').endsWith('_CALLABLE_ESCAPE');
}

function callableEscapeReviewForSite(site, policy) {
  const matches = (policy.callableEscapeReviews || []).filter(review => (
    review.siteFingerprint === site.fingerprint
    && review.kind === site.kind
  ));
  return matches.length === 1 ? matches[0] : null;
}

function platformMaintenanceDecision(collection, category, policy) {
  const decision = policy.collectionPolicies?.[collection]?.platformMaintenance;
  return decision || null;
}

function buildCollectionMatrix(sites, policy) {
  const writeSites = sites.filter(site => (
    site.collections.length > 0
    && site.contributesCollectionPaths !== false
  ));
  return ALL_APP_DATA_COLLECTIONS.map(collection => {
    const registry = COLLECTION_SCOPE_REGISTRY[collection];
    const paths = writeSites.filter(site => site.collections.includes(collection)).map(site => ({
      siteFingerprint: site.fingerprint,
      file: site.file,
      function: site.function,
      line: site.line,
      authorityId: site.authorityId,
      pathRole: site.pathRole,
      platformRemediationOnly: site.platformRemediationOnly,
      disposableOnly: site.disposableOnly,
      guard: site.guard,
      status: site.status,
    }));
    const noCreateReason = policy.collectionPolicies?.[collection]?.noCreateReason || null;
    const platformMaintenance = platformMaintenanceDecision(collection, registry.category, policy);
    const status = (
      platformMaintenance
      && platformMaintenance !== 'UNKNOWN'
      && ((paths.length > 0 && !noCreateReason) || (paths.length === 0 && Boolean(noCreateReason)))
      && paths.every(entry => entry.status === 'PASS')
    ) ? 'PASS' : 'FAIL';
    return {
      collection,
      category: registry.category,
      shape: registry.shape,
      writeAuthority: registry.writeAuthority,
      createUpsertPaths: paths,
      noCreateReason,
      platformMaintenance,
      status,
    };
  });
}

function buildSqlObjectMatrix(sites) {
  const sqlSites = sites.filter(site => site.kind.startsWith('SQL_'));
  const objects = [...new Set(sqlSites.flatMap(site => site.tables))].sort();
  return objects.map(object => {
    const paths = sqlSites.filter(site => site.tables.includes(object)).map(site => ({
      siteFingerprint: site.fingerprint,
      file: site.file,
      function: site.function,
      line: site.line,
      authorityId: site.authorityId,
      platformRemediationOnly: site.platformRemediationOnly,
      disposableOnly: site.disposableOnly,
      status: site.status,
    }));
    return {
      object,
      persistencePaths: paths,
      status: paths.length > 0 && paths.every(pathEntry => pathEntry.status === 'PASS') ? 'PASS' : 'FAIL',
    };
  });
}

function validatePolicyShape(policy) {
  if (!policy || policy.schemaVersion !== AUDIT_SCHEMA_VERSION) {
    throw new FutureWriteAuditError('FUTURE_WRITE_POLICY_VERSION_INVALID', 'Future-write audit policy version is invalid.');
  }
  if (!SHA256_PATTERN.test(String(policy.expectedInventorySha256 || ''))) {
    throw new FutureWriteAuditError('FUTURE_WRITE_POLICY_FINGERPRINT_REQUIRED', 'Expected future-write inventory fingerprint is required.');
  }
  if (!SHA256_PATTERN.test(String(policy.expectedSourceCorpusSha256 || ''))) {
    throw new FutureWriteAuditError(
      'FUTURE_WRITE_POLICY_SOURCE_CORPUS_FINGERPRINT_REQUIRED',
      'Expected audited source-corpus fingerprint is required.',
    );
  }
  if (Number(policy.expectedRegistryCollectionCount) !== ALL_APP_DATA_COLLECTIONS.length) {
    throw new FutureWriteAuditError(
      'FUTURE_WRITE_REGISTRY_COUNT_INVALID',
      'Future-write policy registry count is stale.',
    );
  }
  const expectedCategories = Object.values(COLLECTION_SCOPE_CATEGORY).sort();
  const categoryNames = Object.keys(policy.categoryPolicies || {}).sort();
  if (
    categoryNames.length !== expectedCategories.length
    || categoryNames.some((category, index) => category !== expectedCategories[index])
    || categoryNames.some(category => (
      policy.categoryPolicies[category]?.status !== 'PASS'
      || !policy.categoryPolicies[category]?.platformMaintenance
      || policy.categoryPolicies[category]?.platformMaintenance === 'UNKNOWN'
    ))
  ) {
    throw new FutureWriteAuditError(
      'FUTURE_WRITE_CATEGORY_POLICY_INCOMPLETE',
      'Every registry category requires an explicit future-write maintenance policy, including empty categories.',
    );
  }
  const collectionNames = Object.keys(policy.collectionPolicies || {}).sort();
  if (
    collectionNames.length !== ALL_APP_DATA_COLLECTIONS.length
    || collectionNames.some(name => !COLLECTION_SCOPE_REGISTRY[name])
    || ALL_APP_DATA_COLLECTIONS.some(name => !policy.collectionPolicies?.[name])
  ) {
    throw new FutureWriteAuditError(
      'FUTURE_WRITE_COLLECTION_POLICY_INCOMPLETE',
      'Every registry collection requires one explicit future-write policy.',
    );
  }
  for (const collection of ALL_APP_DATA_COLLECTIONS) {
    const expected = COLLECTION_SCOPE_REGISTRY[collection];
    const entry = policy.collectionPolicies[collection];
    if (
      entry.category !== expected.category
      || entry.status !== 'PASS'
      || !entry.platformMaintenance
      || entry.platformMaintenance === 'UNKNOWN'
    ) {
      throw new FutureWriteAuditError(
        'FUTURE_WRITE_COLLECTION_POLICY_INVALID',
        `Future-write collection policy is incomplete: ${collection}.`,
      );
    }
  }
  const authorityIds = new Set();
  for (const authority of policy.sourceAuthorities || []) {
    const fingerprintSelectorsValid = ['siteFingerprints', 'excludeSiteFingerprints', 'nonContributingSiteFingerprints']
      .every(selector => (
        authority[selector] === undefined
        || (
          Array.isArray(authority[selector])
          && authority[selector].length > 0
          && new Set(authority[selector]).size === authority[selector].length
          && authority[selector].every(fingerprint => SHA256_PATTERN.test(String(fingerprint || '')))
        )
      ));
    if (
      !authority.id
      || authority.status !== 'PASS'
      || !authority.authority
      || authority.authority === 'UNKNOWN'
      || !authority.layer
      || authority.layer === 'UNKNOWN'
      || !authority.pathRole
      || authority.pathRole === 'UNKNOWN'
      || !Array.isArray(authority.files)
      || authority.files.length === 0
      || authorityIds.has(authority.id)
      || !fingerprintSelectorsValid
      || (authority.tables !== undefined && (
        !Array.isArray(authority.tables)
        || authority.tables.length === 0
        || new Set(authority.tables).size !== authority.tables.length
        || authority.tables.some(table => !String(table || '').trim())
      ))
      || (authority.platformRemediationOnly === true && !authority.guard)
      || (authority.disposableOnly === true && !authority.guard)
    ) {
      throw new FutureWriteAuditError('FUTURE_WRITE_SOURCE_AUTHORITY_INVALID', 'Source authority policy is incomplete.', { authority });
    }
    authorityIds.add(authority.id);
  }
  const boundFingerprints = new Set();
  for (const bound of policy.dynamicCollectionBounds || []) {
    if (
      !SHA256_PATTERN.test(String(bound.siteFingerprint || ''))
      || boundFingerprints.has(bound.siteFingerprint)
      || (!bound.allowNoop && (!Array.isArray(bound.collections) || bound.collections.length === 0))
      || (bound.collections || []).some(collection => !COLLECTION_SCOPE_REGISTRY[collection])
    ) {
      throw new FutureWriteAuditError(
        'FUTURE_WRITE_DYNAMIC_BOUND_INVALID',
        'Dynamic collection bound is incomplete or unclassified.',
        { bound },
      );
    }
    boundFingerprints.add(bound.siteFingerprint);
  }
  const sqlBoundFingerprints = new Set();
  for (const bound of policy.dynamicSqlObjectBounds || []) {
    if (
      !SHA256_PATTERN.test(String(bound.siteFingerprint || ''))
      || sqlBoundFingerprints.has(bound.siteFingerprint)
      || !Array.isArray(bound.tables)
      || bound.tables.length === 0
      || bound.tables.some(table => !String(table || '').trim())
    ) {
      throw new FutureWriteAuditError(
        'FUTURE_WRITE_DYNAMIC_SQL_BOUND_INVALID',
        'Dynamic SQL object bound is incomplete or unclassified.',
        { bound },
      );
    }
    sqlBoundFingerprints.add(bound.siteFingerprint);
  }
  const reviewedEscapeFingerprints = new Set();
  for (const review of policy.callableEscapeReviews || []) {
    if (
      !SHA256_PATTERN.test(String(review.siteFingerprint || ''))
      || reviewedEscapeFingerprints.has(review.siteFingerprint)
      || !String(review.kind || '').endsWith('_CALLABLE_ESCAPE')
      || !String(review.rationale || '').trim()
      || review.rationale === 'UNKNOWN'
    ) {
      throw new FutureWriteAuditError(
        'FUTURE_WRITE_CALLABLE_ESCAPE_REVIEW_INVALID',
        'Callable escape review is incomplete or duplicated.',
        { review },
      );
    }
    reviewedEscapeFingerprints.add(review.siteFingerprint);
  }
}

function buildFutureWriteAudit({ rootDir, policy }) {
  const resolvedRoot = path.resolve(rootDir);
  validatePolicyShape(policy);
  const corpusManifest = sourceCorpusManifest(resolvedRoot);
  const actualSourceCorpusSha256 = sha256(stableJson(corpusManifest));
  const rawSites = walkSourceFiles(resolvedRoot).flatMap(filePath => scanFile(resolvedRoot, filePath));
  const duplicateFingerprints = rawSites
    .map(site => site.fingerprint)
    .filter((fingerprint, index, values) => values.indexOf(fingerprint) !== index);
  const findings = [];
  if (actualSourceCorpusSha256 !== policy.expectedSourceCorpusSha256) {
    findings.push({
      code: 'FUTURE_WRITE_SOURCE_CORPUS_DRIFT',
      expected: policy.expectedSourceCorpusSha256,
      actual: actualSourceCorpusSha256,
    });
  }
  if (duplicateFingerprints.length > 0) {
    findings.push({ code: 'FUTURE_WRITE_SITE_FINGERPRINT_DUPLICATE', fingerprints: [...new Set(duplicateFingerprints)] });
  }
  const sites = rawSites.map(site => {
    const authority = authorityForSite(site, policy);
    const callableEscapeReview = isCallableEscapeSite(site)
      ? callableEscapeReviewForSite(site, policy)
      : null;
    let collections = site.collections;
    const dynamicBound = site.dynamicCollections
      ? dynamicCollectionBound(site, policy)
      : null;
    if (dynamicBound) {
      collections = [...new Set([...collections, ...(dynamicBound.collections || [])])].sort();
    }
    const unknownCollections = collections.filter(collection => !COLLECTION_SCOPE_REGISTRY[collection]);
    const dynamicSqlBound = site.kind.startsWith('SQL_') && site.dynamicSqlObjects
      ? dynamicSqlObjectBound(site, policy)
      : null;
    const tables = [...new Set([
      ...site.tables,
      ...(dynamicSqlBound?.tables || []),
    ])].sort();
    const unclassifiedTables = site.kind.startsWith('SQL_')
      ? tables.filter(table => !authority?.tables?.includes(table))
      : [];
    const appDataCollectionsResolved = !rawAppDataMutationPotential(site, tables)
      || collections.length > 0;
    const status = authority
      && (!isCallableEscapeSite(site) || Boolean(callableEscapeReview))
      && unknownCollections.length === 0
      && appDataCollectionsResolved
      && (!site.dynamicCollections || Boolean(dynamicBound))
      && (!site.dynamicCollections || collections.length > 0 || dynamicBound?.allowNoop === true)
      && (!site.kind.startsWith('SQL_') || !site.dynamicSqlObjects || Boolean(dynamicSqlBound))
      && unclassifiedTables.length === 0
      && (!site.kind.startsWith('SQL_') || ['SQL_CONNECTION_GUARD', 'SQL_PRAGMA_WRITE', 'SQL_TRANSACTION_CONTROL'].includes(site.kind) || tables.length > 0)
      ? 'PASS'
      : 'FAIL';
    if (!authority) findings.push({ code: 'FUTURE_WRITE_SITE_AUTHORITY_UNKNOWN', siteFingerprint: site.fingerprint, file: site.file, line: site.line });
    if (isCallableEscapeSite(site) && !callableEscapeReview) {
      findings.push({
        code: 'FUTURE_WRITE_CALLABLE_ESCAPE_UNREVIEWED',
        siteFingerprint: site.fingerprint,
        file: site.file,
        line: site.line,
        kind: site.kind,
      });
    }
    if (site.dynamicCollections && !dynamicBound) {
      findings.push({ code: 'FUTURE_WRITE_DYNAMIC_COLLECTION_UNKNOWN', siteFingerprint: site.fingerprint, file: site.file, line: site.line });
    }
    if (unknownCollections.length > 0) {
      findings.push({ code: 'FUTURE_WRITE_COLLECTION_UNCLASSIFIED', siteFingerprint: site.fingerprint, collections: unknownCollections });
    }
    if (!appDataCollectionsResolved) {
      findings.push({
        code: 'FUTURE_WRITE_APP_DATA_COLLECTION_UNKNOWN',
        siteFingerprint: site.fingerprint,
        file: site.file,
        line: site.line,
      });
    }
    if (
      site.kind.startsWith('SQL_')
      && !['SQL_CONNECTION_GUARD', 'SQL_PRAGMA_WRITE', 'SQL_TRANSACTION_CONTROL'].includes(site.kind)
      && tables.length === 0
    ) {
      findings.push({ code: 'FUTURE_WRITE_SQL_TABLE_UNKNOWN', siteFingerprint: site.fingerprint, file: site.file, line: site.line });
    }
    if (site.kind.startsWith('SQL_') && site.dynamicSqlObjects && !dynamicSqlBound) {
      findings.push({ code: 'FUTURE_WRITE_DYNAMIC_SQL_OBJECT_UNKNOWN', siteFingerprint: site.fingerprint, file: site.file, line: site.line });
    }
    if (unclassifiedTables.length > 0) {
      findings.push({
        code: 'FUTURE_WRITE_SQL_TABLE_UNCLASSIFIED',
        siteFingerprint: site.fingerprint,
        file: site.file,
        line: site.line,
        tables: unclassifiedTables,
      });
    }
    return {
      ...site,
      collections,
      tables,
      authorityId: authority?.id || 'UNKNOWN',
      authority: authority?.authority || 'UNKNOWN',
      layer: authority?.layer || 'UNKNOWN',
      platformRemediationOnly: authority?.platformRemediationOnly === true,
      disposableOnly: authority?.disposableOnly === true,
      guard: authority?.guard || null,
      callableEscapeReview,
      pathRole: authority?.pathRole || 'UNKNOWN',
      contributesCollectionPaths: site.kind !== 'APP_DATA_CALLABLE_ESCAPE'
        && authority?.contributesCollectionPaths !== false
        && !authority?.nonContributingSiteFingerprints?.includes(site.fingerprint),
      status,
    };
  }).sort((left, right) => (
    left.file.localeCompare(right.file)
    || left.line - right.line
    || left.fingerprint.localeCompare(right.fingerprint)
  ));
  for (const authority of policy.sourceAuthorities || []) {
    if (!sites.some(site => site.authorityId === authority.id)) {
      findings.push({ code: 'FUTURE_WRITE_SOURCE_AUTHORITY_UNUSED', authorityId: authority.id });
    }
    for (const selector of ['siteFingerprints', 'excludeSiteFingerprints', 'nonContributingSiteFingerprints']) {
      for (const fingerprint of authority[selector] || []) {
        const rawMatches = rawSites.filter(site => site.fingerprint === fingerprint);
        const reviewedSite = sites.find(site => site.fingerprint === fingerprint);
        const baseMatches = rawMatches.length === 1
          && authority.files.includes(rawMatches[0].file)
          && (!authority.kinds || authority.kinds.includes(rawMatches[0].kind))
          && (!authority.functions || authority.functions.includes(rawMatches[0].function));
        const relationshipMatches = selector === 'excludeSiteFingerprints'
          ? reviewedSite?.authorityId !== authority.id
          : reviewedSite?.authorityId === authority.id;
        if (rawMatches.length !== 1 || !baseMatches || !relationshipMatches) {
          findings.push({
            code: 'FUTURE_WRITE_SOURCE_SELECTOR_STALE',
            authorityId: authority.id,
            selector,
            siteFingerprint: fingerprint,
            matchCount: rawMatches.length,
          });
        }
      }
    }
  }
  for (const bound of policy.dynamicCollectionBounds || []) {
    const matches = rawSites.filter(site => (
      site.fingerprint === bound.siteFingerprint
      && site.dynamicCollections
    ));
    if (matches.length !== 1) {
      findings.push({
        code: 'FUTURE_WRITE_DYNAMIC_BOUND_STALE',
        siteFingerprint: bound.siteFingerprint,
        matchCount: matches.length,
      });
    }
  }
  for (const bound of policy.dynamicSqlObjectBounds || []) {
    const matches = rawSites.filter(site => (
      site.fingerprint === bound.siteFingerprint
      && site.kind.startsWith('SQL_')
      && site.dynamicSqlObjects
    ));
    if (matches.length !== 1) {
      findings.push({
        code: 'FUTURE_WRITE_DYNAMIC_SQL_BOUND_STALE',
        siteFingerprint: bound.siteFingerprint,
        matchCount: matches.length,
      });
    }
  }
  for (const review of policy.callableEscapeReviews || []) {
    const matches = rawSites.filter(site => (
      site.fingerprint === review.siteFingerprint
      && site.kind === review.kind
      && isCallableEscapeSite(site)
    ));
    if (matches.length !== 1) {
      findings.push({
        code: 'FUTURE_WRITE_CALLABLE_ESCAPE_REVIEW_STALE',
        siteFingerprint: review.siteFingerprint,
        kind: review.kind,
        matchCount: matches.length,
      });
    }
  }
  const inventoryProjection = sites.map(site => ({
    fingerprint: site.fingerprint,
    authorityId: site.authorityId,
    layer: site.layer,
    pathRole: site.pathRole,
    platformRemediationOnly: site.platformRemediationOnly,
    disposableOnly: site.disposableOnly,
    guard: site.guard,
    contributesCollectionPaths: site.contributesCollectionPaths,
    callableEscapeReview: site.callableEscapeReview,
    collections: site.collections,
    tables: site.tables,
  })).sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  const inventorySha256 = sha256(stableJson({
    sourceCorpusSha256: actualSourceCorpusSha256,
    writeSites: inventoryProjection,
  }));
  if (inventorySha256 !== policy.expectedInventorySha256) {
    findings.push({
      code: 'FUTURE_WRITE_INVENTORY_DRIFT',
      expected: policy.expectedInventorySha256,
      actual: inventorySha256,
    });
  }
  if (Number(policy.expectedSiteCount) !== sites.length) {
    findings.push({
      code: 'FUTURE_WRITE_SITE_COUNT_DRIFT',
      expected: Number(policy.expectedSiteCount),
      actual: sites.length,
    });
  }
  const collectionMatrix = buildCollectionMatrix(sites, policy);
  for (const entry of collectionMatrix.filter(entry => entry.status !== 'PASS')) {
    findings.push({ code: 'FUTURE_WRITE_COLLECTION_MATRIX_INCOMPLETE', collection: entry.collection });
  }
  const sqlObjectMatrix = buildSqlObjectMatrix(sites);
  for (const entry of sqlObjectMatrix.filter(entry => entry.status !== 'PASS')) {
    findings.push({ code: 'FUTURE_WRITE_SQL_OBJECT_MATRIX_INCOMPLETE', object: entry.object });
  }
  const categoryCounts = Object.fromEntries(Object.values(COLLECTION_SCOPE_CATEGORY).map(category => [
    category,
    collectionMatrix.filter(entry => entry.category === category).length,
  ]));
  const kindCounts = Object.fromEntries([...new Set(sites.map(site => site.kind))].sort().map(kind => [
    kind,
    sites.filter(site => site.kind === kind).length,
  ]));
  const report = {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    status: findings.length === 0 ? 'PASS' : 'FAIL',
    sourceCorpusSha256: actualSourceCorpusSha256,
    expectedSourceCorpusSha256: policy.expectedSourceCorpusSha256,
    inventorySha256,
    expectedInventorySha256: policy.expectedInventorySha256,
    summary: {
      registryCollectionCount: collectionMatrix.length,
      sourceFileCount: corpusManifest.length,
      writeSiteCount: sites.length,
      appDataWriteSiteCount: sites.filter(site => site.kind.startsWith('APP_DATA_')).length,
      sqlWriteSiteCount: sites.filter(site => site.kind.startsWith('SQL_')).length,
      backupArtifactSiteCount: sites.filter(site => site.kind === 'SQLITE_BACKUP_ARTIFACT').length,
      sqlObjectCount: sqlObjectMatrix.length,
      sourceAuthorityCount: (policy.sourceAuthorities || []).length,
      platformRemediationSiteCount: sites.filter(site => site.platformRemediationOnly).length,
      disposableSiteCount: sites.filter(site => site.disposableOnly).length,
      unknownSiteCount: sites.filter(site => site.status !== 'PASS').length,
      failedCollectionCount: collectionMatrix.filter(entry => entry.status !== 'PASS').length,
      categoryCounts,
      kindCounts,
    },
    collectionMatrix,
    categoryPolicyMatrix: Object.values(COLLECTION_SCOPE_CATEGORY).map(category => ({
      category,
      collectionCount: categoryCounts[category],
      platformMaintenance: policy.categoryPolicies[category].platformMaintenance,
      status: policy.categoryPolicies[category].status,
    })),
    sqlObjectMatrix,
    sourceAuthorityMatrix: (policy.sourceAuthorities || []).map(authority => ({
      id: authority.id,
      authority: authority.authority,
      layer: authority.layer,
      pathRole: authority.pathRole,
      platformRemediationOnly: authority.platformRemediationOnly === true,
      disposableOnly: authority.disposableOnly === true,
      guard: authority.guard || null,
      writeSiteCount: sites.filter(site => site.authorityId === authority.id).length,
      status: sites.some(site => site.authorityId === authority.id) ? 'PASS' : 'FAIL',
    })),
    platformRemediationPaths: sites.filter(site => site.platformRemediationOnly),
    disposablePaths: sites.filter(site => site.disposableOnly),
    backupArtifactPaths: sites.filter(site => site.kind === 'SQLITE_BACKUP_ARTIFACT'),
    callableEscapePaths: sites.filter(isCallableEscapeSite),
    writeSites: sites,
    findings,
  };
  return Object.freeze(report);
}

module.exports = {
  AUDIT_SCHEMA_VERSION,
  APP_DATA_WRITER_NAMES,
  EXCLUDED_SOURCE_PATHS,
  FutureWriteAuditError,
  SQLITE_BACKUP_WRITER_NAMES,
  buildFutureWriteAudit,
  scanFile,
  sha256,
  sourceCorpusManifest,
  sourceCorpusSha256,
  stableJson,
  walkSourceFiles,
};
