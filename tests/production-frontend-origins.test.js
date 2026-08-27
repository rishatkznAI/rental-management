import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
  BUILT_IN_PRODUCTION_FRONTEND_ORIGINS,
  configuredProductionFrontendOrigins,
  productionFrontendOrigins,
} = require('../server/lib/production-frontend-origins');

test('production frontend origins include the canonical app and legacy Pages origin', () => {
  assert.deepEqual(BUILT_IN_PRODUCTION_FRONTEND_ORIGINS, [
    'https://app.skytech-rent.ru',
    'https://rishatkznai.github.io',
  ]);
  assert.deepEqual([...productionFrontendOrigins('')], BUILT_IN_PRODUCTION_FRONTEND_ORIGINS);
});

test('configured production frontend origins stay exact and reject wildcard entries', () => {
  const configured = ' https://skytech-rent.ru , *, ,https://preview.example ';
  assert.deepEqual(configuredProductionFrontendOrigins(configured), [
    'https://skytech-rent.ru',
    'https://preview.example',
  ]);
  assert.deepEqual([...productionFrontendOrigins(configured)], [
    'https://app.skytech-rent.ru',
    'https://rishatkznai.github.io',
    'https://skytech-rent.ru',
    'https://preview.example',
  ]);
});

test('the default production frontend build targets the canonical API origin', () => {
  const productionEnvironment = readFileSync(new URL('../.env.production', import.meta.url), 'utf8');
  assert.equal(productionEnvironment.trim(), 'VITE_API_URL=https://api.skytech-rent.ru');
});
