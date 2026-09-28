/**
 * Runs the Playwright e2e tests, selecting tests by their number.
 *
 *   npm run test:e2e                      all tests
 *   npm run test:e2e 4                    every test in file 04 (4.x)
 *   npm run test:e2e 4.3                  test 4.3
 *   npm run test:e2e 14.1,14.2 3          tests 14.1 and 14.2, plus every test in file 03
 *   npm run test:e2e 14.1-14.3            tests 14.1 up to and including 14.3
 *   npm run test:e2e:pause 4.3            headed, stopping at each app.pause() in the Playwright Inspector
 *
 * Numbers become one title filter (--grep), so selections combine as "or". Any other argument goes to Playwright as-is.
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const env = { ...process.env };
const playwrightArgs = [];
const patterns = [];

for (const arg of args) {
  if (arg === '--pause') {
    env.E2E_PAUSE = '1';
    playwrightArgs.push('--headed', '--workers=1');
    continue;
  }
  const selectors = arg.split(',').filter(Boolean);
  if (selectors.length > 0 && selectors.every(isSelector)) {
    patterns.push(...selectors.flatMap(toPatterns));
  } else {
    playwrightArgs.push(arg);
  }
}

if (patterns.length > 0) {
  // A test title starts with its number ("4.3 should ..."); the leading boundary keeps 4.3 from matching 14.3.
  playwrightArgs.push('--grep', `(^|\\s)(${patterns.join('|')})\\s`);
}

const result = spawnSync('npx', ['playwright', 'test', ...playwrightArgs], { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);

/**
 * Whether an argument selects tests: "4", "4.3" or "4.1-4.3".
 */
function isSelector(value) {
  return /^\d+(\.\d+)?$/.test(value) || /^\d+\.\d+-\d+\.\d+$/.test(value);
}

/**
 * The title patterns a selector stands for.
 */
function toPatterns(selector) {
  const range = selector.match(/^(\d+)\.(\d+)-(\d+)\.(\d+)$/);
  if (range) {
    const [, file, from, toFile, to] = range.map(Number);
    if (file !== toFile || from > to) {
      console.error(`Invalid range "${selector}": use one file, low to high, e.g. 14.1-14.3.`);
      process.exit(1);
    }
    return Array.from({ length: to - from + 1 }, (_, i) => `${file}\\.${from + i}`);
  }
  return selector.includes('.') ? [selector.replace('.', '\\.')] : [`${Number(selector)}\\.\\d+`];
}
