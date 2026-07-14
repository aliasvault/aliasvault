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
      version: "0.30.1",
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
          "src/sql-wasm.wasm",
          "src/argon2.wasm",
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
    plugins: [
      asciiOnlyJsPlugin(),
      viteStaticCopy({
        targets: [
          {
            src: 'node_modules/argon2-browser/dist/argon2.wasm',
            dest: 'src'
          },
          {
            src: 'node_modules/sql.js/dist/sql-wasm.wasm',
            dest: 'src'
          },
          {
            src: 'src/utils/dist/core/rust/aliasvault_core_bg.wasm',
            dest: 'src'
          }
        ]
      })
    ],
  }),
  zip: {
    includeSources: ['README.md'],
  },
});
