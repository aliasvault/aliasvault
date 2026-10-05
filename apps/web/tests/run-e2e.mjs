/**
 * Runs the Playwright e2e tests, selecting tests by their number.
 *
 *   npm run test:e2e                      all tests
 *   npm run test:e2e 9x                   every test in files 90 to 99 (one area)
 *   npm run test:e2e 20                   every test in file 20 (20.x)
 *   npm run test:e2e 20.3                 test 20.3
 *   npm run test:e2e 80.1,80.2 1x         tests 80.1 and 80.2, plus every test in files 10 to 19
 *   npm run test:e2e 80.1-80.3            tests 80.1 up to and including 80.3
 *   npm run test:e2e:p 20.3               headed, stopping at each app.pause() in the Playwright Inspector
 *
 * Test files are numbered by area, in the same ranges as the browser extension suite, so a range selects one area:
 *   0x app shell (extension only)    1x account and authentication    2x items
 *   3x sync and merge (extension)    4x email                         5x settings
 *   6x browser integration (ext.)    7x sharing                       8x vault errors
 *   9x vault upgrades
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
  // A test title starts with its number ("20.3 should ..."); the leading boundary keeps 1.3 from matching 11.3.
  playwrightArgs.push('--grep', `(^|\\s)(${patterns.join('|')})\\s`);
}

const result = spawnSync('npx', ['playwright', 'test', ...playwrightArgs], { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(result.status ?? 1);

/**
 * Whether an argument selects tests: "2x", "20", "20.3" or "20.1-20.3".
 */
function isSelector(value) {
  return /^\d+(\.\d+)?$/.test(value) || /^\d+\.\d+-\d+\.\d+$/.test(value) || /^\dx$/i.test(value);
}

/**
 * The title patterns a selector stands for.
 */
function toPatterns(selector) {
  // "2x" is every file from 20 to 29; "0x" is the files 0 to 9, whose test numbers have no leading zero.
  const area = selector.match(/^(\d)x$/i);
  if (area) {
    return [`${area[1] === '0' ? '' : area[1]}\\d\\.\\d+`];
  }
  const range = selector.match(/^(\d+)\.(\d+)-(\d+)\.(\d+)$/);
  if (range) {
    const [, file, from, toFile, to] = range.map(Number);
    if (file !== toFile || from > to) {
      console.error(`Invalid range "${selector}": use one file, low to high, e.g. 80.1-80.3.`);
      process.exit(1);
    }
    return Array.from({ length: to - from + 1 }, (_, i) => `${file}\\.${from + i}`);
  }
  return selector.includes('.') ? [selector.replace('.', '\\.')] : [`${Number(selector)}\\.\\d+`];
}
