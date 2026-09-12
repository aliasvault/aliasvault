import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { defineConfig } from 'wxt';
import type { Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

/**
 * Forces emitted JS chunks to ASCII-only output.
 *
 * Safari before 18.4 could decode extension resources using the system text
 * encoding instead of UTF-8, corrupting bundled non-ASCII strings. Content
 * scripts are classic scripts, so we escape non-ASCII characters regardless of
 * bundler to keep extension JS portable.
 * 
 * @see https://github.com/aliasvault/aliasvault/issues/2162
 */
function asciiOnlyJsPlugin(): Plugin {
  return {
    name: 'aliasvault:ascii-only-js',
    generateBundle(_options, bundle): void {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk' || !file.fileName.endsWith('.js')) {
          continue;
        }

        file.code = file.code.replace(/[^\u0000-\u007f]/g, (ch) =>
          `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`
        );
      }
    },
  };
}

const CORE_DIR = path.resolve(import.meta.dirname, '../../core');

/*
 * README that is placed in the root of the Firefox sources archive. It is added after zipping because
 * wxt keeps the path of every included file, and the archive root maps to the repository root which
 * already has its own README.md.
 */
const SOURCES_README = path.resolve(import.meta.dirname, 'build-assets/firefox-sources/README.md');

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: ({ browser, manifestVersion, mode, command }) => {
    const permissions = [
      "storage",
      "unlimitedStorage",
      "activeTab",
      "contextMenus",
      "scripting",
      "clipboardWrite",
      "alarms"
    ];

    // Only add offscreen permission for Chrome and Edge
    if (browser === 'chrome' || browser === 'edge') {
      permissions.push("offscreen");
    }

    // Safari: allow messaging the native app (e.g. to open Safari's extension shortcut settings)
    if (browser === 'safari') {
      permissions.push("nativeMessaging");
    }

    return {
      name: "AliasVault",
      description: "AliasVault Browser AutoFill Extension. Keeping your personal information private.",
      version: "0.31.0",
      content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
      },
      action: {
        default_title: "AliasVault"
      },
      permissions,
      host_permissions: [
        "<all_urls>"
      ],
      commands: {
        "show-autofill-popup": {
          suggested_key: {
            default: "Ctrl+Shift+L",
            mac: "Command+Shift+L"
          },
          description: "Show the autofill popup (while focusing an input field)"
        }
      },
      web_accessible_resources: [{
        resources: [
          "webauthn.js",
          "src/sql-wasm-browser.wasm",
          "src/aliasvault_core_bg.wasm"
        ],
        matches: ["<all_urls>"]
      }],
      ...(browser === 'firefox' ? {
        browser_specific_settings: {
          gecko: {
            id: "{a06e3383-fc5f-431d-8405-1c54c2f85971}"
          }
        }
      } : {})
    };
  },
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  outDir: 'dist',
  vite: () => ({
    // Allow to serve files from the shared core directory
    server: {
      fs: {
        allow: [path.resolve('.'), CORE_DIR],
      },
    },
    optimizeDeps: {
      entries: ['src/**/*.html', 'public/**/*.html'],
      exclude: ['@aliasvault/client', '@aliasvault/models', '@aliasvault/vault'],
    },
    plugins: [
      asciiOnlyJsPlugin(),
      viteStaticCopy({
        targets: [
          {
            src: path.resolve(CORE_DIR, 'client/node_modules/sql.js/dist/sql-wasm-browser.wasm'),
            dest: 'src'
          },
          {
            src: path.resolve(CORE_DIR, 'client/wasm/aliasvault_core_bg.wasm'),
            dest: 'src'
          }
        ]
      })
    ],
  }),
  hooks: {
    'zip:sources:done': (_wxt, zipPath): void => {
      try {
        execFileSync('zip', ['-jq', zipPath, SOURCES_README]);
      } catch (error) {
        throw new Error(`Could not add README.md to ${path.basename(zipPath)}, is the 'zip' command available? ${error}`);
      }
    },
  },
  zip: {
    // Firefox source archive (zip) requires all the files the build needs locally inside the archive.
    sourcesRoot: path.resolve(CORE_DIR, '..'),
    includeSources: [
      'apps/browser-extension/**/*',
      'core/client/**/*',
      'core/models/**/*',
      'core/vault/**/*',
      'core/rust/**/*',
      'core/rust/.cargo/**/*',
      'LICENSE.md',
    ],
    excludeSources: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.wxt/**',
      'core/rust/target/**',
      'apps/browser-extension/build-assets/safari-xcode/build/**',
      '**/xcuserdata/**',
      'apps/browser-extension/playwright-report/**',
      'apps/browser-extension/test-results/**',
      'apps/browser-extension/tests/**',
      'apps/browser-extension/build-assets/firefox-sources/**',
      'apps/browser-extension/stats.html',
      'apps/browser-extension/stats-*.json',
      '**/*.log',
      'apps/browser-extension/build-and-submit.sh'
    ],
  },
});
