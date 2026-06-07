#!/usr/bin/env node

import { chromium } from '@playwright/test';

function parseArgs(argv) {
  const args = {
    frontendUrl: process.env.PRODUCTION_FRONTEND_URL || '',
    expectedCommit: process.env.EXPECTED_RELEASE_COMMIT || process.env.GITHUB_SHA || '',
    apiUrl: process.env.PRODUCTION_API_URL || '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--frontend-url') args.frontendUrl = argv[++index] || '';
    else if (arg === '--expected-commit') args.expectedCommit = argv[++index] || '';
    else if (arg === '--api-url') args.apiUrl = argv[++index] || '';
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  node scripts/frontend-build-marker.mjs --frontend-url <url> --expected-commit <sha> --api-url <url>`);
}

function required(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function shortCommit(value = '') {
  return String(value || '').trim().slice(0, 12);
}

function commitsMatch(actual = '', expected = '') {
  const left = String(actual || '').trim();
  const right = String(expected || '').trim();
  if (!left || !right) return false;
  return left.startsWith(right) || right.startsWith(left);
}

function normalizeUrl(value = '') {
  return String(value || '').trim().replace(/\/$/, '');
}

function debugUrl(frontendUrl, expectedCommit) {
  const url = new URL(frontendUrl);
  url.searchParams.set('debugVersion', '1');
  url.searchParams.set('v', shortCommit(expectedCommit) || String(Date.now()));
  return url.toString();
}

async function appendSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const { appendFile } = await import('node:fs/promises');
  await appendFile(summaryPath, `${lines.join('\n')}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const frontendUrl = required(args.frontendUrl, 'frontend URL');
  const expectedCommit = required(args.expectedCommit, 'expected commit');
  const apiUrl = required(args.apiUrl, 'API URL');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(debugUrl(frontendUrl, expectedCommit), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => Boolean(window.__SKYTECH_BUILD_INFO__?.commit), null, { timeout: 30_000 });
    const marker = await page.evaluate(() => window.__SKYTECH_BUILD_INFO__ || null);

    const actualCommit = marker?.commit || '';
    const actualApiUrl = marker?.apiBaseUrl || '';
    const buildTime = marker?.buildTime || 'missing';
    const releaseType = marker?.releaseType || 'unknown';
    const expectedShort = shortCommit(expectedCommit);

    console.log(`[frontend-build-marker] frontend=${frontendUrl}`);
    console.log(`[frontend-build-marker] expectedCommit=${expectedShort}`);
    console.log(`[frontend-build-marker] actualCommit=${actualCommit || 'missing'}`);
    console.log(`[frontend-build-marker] buildTime=${buildTime}`);
    console.log(`[frontend-build-marker] releaseType=${releaseType}`);
    console.log(`[frontend-build-marker] apiUrl=${actualApiUrl || 'missing'}`);

    await appendSummary([
      '### Public frontend marker',
      '',
      `- frontend: ${frontendUrl}`,
      `- expected commit: \`${expectedShort}\``,
      `- actual FE marker: \`${actualCommit || 'missing'}\``,
      `- build time: \`${buildTime}\``,
      `- release type: \`${releaseType}\``,
      `- API URL: \`${actualApiUrl || 'missing'}\``,
    ]);

    if (!commitsMatch(actualCommit, expectedCommit) && !commitsMatch(actualCommit, expectedShort)) {
      throw new Error(`frontend marker mismatch. expected=${expectedShort} actual=${actualCommit || 'missing'}`);
    }
    if (normalizeUrl(actualApiUrl) !== normalizeUrl(apiUrl)) {
      throw new Error(`frontend API URL mismatch. expected=${apiUrl} actual=${actualApiUrl || 'missing'}`);
    }

    console.log('[frontend-build-marker] PASS');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(`[frontend-build-marker] FAIL: ${error.message}`);
  process.exit(1);
});
