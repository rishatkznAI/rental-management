import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const themeSource = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8');
const animationsSource = readFileSync(new URL('../src/app/lib/animations.ts', import.meta.url), 'utf8');
const layoutSource = readFileSync(new URL('../src/app/components/layout/Layout.tsx', import.meta.url), 'utf8');

test('shared motion system exposes restrained tokens and reduced-motion support', () => {
  assert.match(themeSource, /--motion-duration-fast:\s*160ms/);
  assert.match(themeSource, /--motion-duration-normal:\s*220ms/);
  assert.match(themeSource, /--motion-duration-slow:\s*320ms/);
  assert.match(themeSource, /--motion-scale-subtle-from:\s*0\.98/);
  assert.doesNotMatch(themeSource, /--motion-modal-scale-from:\s*0\.9[0-7]/);
  assert.match(themeSource, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(themeSource, /\.app-page-transition/);
  assert.match(themeSource, /\.app-demo-highlight/);
  assert.match(themeSource, /app-demo-highlight-pulse/);
});

test('route layout applies page motion and opt-in demo presentation motion only visually', () => {
  assert.match(animationsSource, /isDemoPresentationMotionEnabled/);
  assert.match(animationsSource, /skytech:demo-presentation-motion/);
  assert.match(layoutSource, /animatedPageClassName/);
  assert.match(layoutSource, /<Outlet \/>/);
  assert.match(layoutSource, /document\.documentElement\.dataset\.demoPresentationMotion/);
  assert.doesNotMatch(layoutSource, /api\.post|api\.patch|api\.del|fetch\(/);
});
