'use strict';

const BUILT_IN_PRODUCTION_FRONTEND_ORIGINS = Object.freeze([
  'https://app.skytech-rent.ru',
  'https://rishatkznai.github.io',
]);

function configuredProductionFrontendOrigins(value = process.env.CORS_ORIGIN) {
  return String(value || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin && origin !== '*');
}

function productionFrontendOrigins(value = process.env.CORS_ORIGIN) {
  return new Set([
    ...BUILT_IN_PRODUCTION_FRONTEND_ORIGINS,
    ...configuredProductionFrontendOrigins(value),
  ]);
}

module.exports = {
  BUILT_IN_PRODUCTION_FRONTEND_ORIGINS,
  configuredProductionFrontendOrigins,
  productionFrontendOrigins,
};
