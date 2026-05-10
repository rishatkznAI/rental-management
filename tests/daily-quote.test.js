import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

async function importDailyQuoteModule() {
  const outdir = mkdtempSync(join(tmpdir(), 'skytech-daily-quote-test-'));
  const outfile = join(outdir, 'dailyQuote.mjs');
  await build({
    entryPoints: ['src/app/lib/dailyQuote.ts'],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
  });
  const module = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
  return {
    module,
    cleanup: () => rmSync(outdir, { recursive: true, force: true }),
  };
}

test('getDailyQuote returns the same quote for the same local date', async () => {
  const { module, cleanup } = await importDailyQuoteModule();
  try {
    const quotes = [
      { text: 'Первая' },
      { text: 'Вторая' },
      { text: 'Третья' },
    ];
    const morningQuote = module.getDailyQuote(new Date(2026, 4, 10, 9, 15), quotes);
    const eveningQuote = module.getDailyQuote(new Date(2026, 4, 10, 23, 45), quotes);

    assert.deepEqual(morningQuote, eveningQuote);
  } finally {
    cleanup();
  }
});

test('getDailyQuote returns different quotes for different dates when quote list is large enough', async () => {
  const { module, cleanup } = await importDailyQuoteModule();
  try {
    const quotes = Array.from({ length: 10 }, (_, index) => ({ text: `Цитата ${index}` }));

    const firstDayQuote = module.getDailyQuote(new Date(2026, 4, 10), quotes);
    const nextDayQuote = module.getDailyQuote(new Date(2026, 4, 11), quotes);

    assert.notDeepEqual(firstDayQuote, nextDayQuote);
  } finally {
    cleanup();
  }
});

test('getDailyQuote always returns a quote from the provided list', async () => {
  const { module, cleanup } = await importDailyQuoteModule();
  try {
    const quotes = [
      { text: 'Один' },
      { text: 'Два' },
      { text: 'Три' },
      { text: 'Четыре' },
    ];

    for (let offset = 0; offset < 90; offset += 1) {
      const date = new Date(2026, 0, 1 + offset);
      const quote = module.getDailyQuote(date, quotes);
      assert.ok(quotes.includes(quote), `quote for offset ${offset} should come from provided list`);
    }
  } finally {
    cleanup();
  }
});

test('daily quote helper does not use Math.random', () => {
  const source = readFileSync(new URL('../src/app/lib/dailyQuote.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /Math\.random/);
});

test('Login imports daily quote helper instead of random quote helper', () => {
  const source = readFileSync(new URL('../src/app/pages/Login.tsx', import.meta.url), 'utf8');

  assert.match(source, /import\s+\{\s*getDailyQuote\s*\}\s+from ['"]\.\.\/lib\/dailyQuote['"]/);
  assert.doesNotMatch(source, /getRandomMotivationalQuote|LOGIN_QUOTE/);
});
