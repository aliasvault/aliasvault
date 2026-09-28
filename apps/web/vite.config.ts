import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import react from '@vitejs/plugin-react';
import { minify } from 'html-minifier-terser';
import { defineConfig, type Plugin } from 'vite';

const CORE_DIR = path.resolve(import.meta.dirname, '../../core');
const LOCALES_DIR = path.join(CORE_DIR, 'i18n/locales');
const APP_VERSION = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }).version;

/**
 * Inline the loadingScreen strings of every core/i18n/locales/<lang>.json into index.html, so the loading screen
 * script shows the right language on the first load without needing a separate request.
 */
function loadingScreenLocales(): Plugin {
  return {
    name: 'loading-screen-locales',
    transformIndexHtml() {
      const translations: Record<string, unknown> = {};
      for (const file of readdirSync(LOCALES_DIR).filter((name) => name.endsWith('.json'))) {
        const locale = JSON.parse(readFileSync(path.join(LOCALES_DIR, file), 'utf8')) as { loadingScreen?: unknown };
        if (locale.loadingScreen) {
          translations[path.basename(file, '.json')] = locale.loadingScreen;
        }
      }

      // Escape "<" so no string can close the script element.
      const json = JSON.stringify(translations).replace(/</g, '\\u003c');
      return [{ tag: 'script', attrs: { type: 'application/json', id: 'loading-screen-translations' }, children: json, injectTo: 'body-prepend' }];
    },
  };
}

/**
 * Add loading progress tracking to index.html, showing a percentage of the download as indicator on the loading screen.
 */
function loadingProgress(): Plugin {
  return {
    name: 'loading-progress',
    transformIndexHtml(_html, context) {
      if (!context.bundle) {
        const wasmFile = path.join(CORE_DIR, 'client/wasm/aliasvault_core_bg.wasm');
        const devAssets = [{ url: `/@fs${wasmFile}`, size: statSync(wasmFile).size, wasm: true }];
        return [{ tag: 'script', children: `window.__loadingAssets=${JSON.stringify(devAssets)};${EARLY_LOAD_SCRIPT}`, injectTo: 'head-prepend' }];
      }
      const bundle = Object.values(context.bundle);
      const wasm = bundle.find((item) => item.type === 'asset' && /aliasvault_core_bg-.*\.wasm$/.test(item.fileName));
      const entry = bundle.find((item) => item.type === 'chunk' && item.isEntry);
      if (!wasm || wasm.type !== 'asset' || !entry || entry.type !== 'chunk') {
        throw new Error('The entry chunk or the Rust core wasm asset is missing from the bundle.');
      }
      const sizeOf = (fileName: string): number => {
        const item = context.bundle?.[fileName];
        if (!item) {
          return 0;
        }
        return item.type === 'chunk' ? Buffer.byteLength(item.code) : typeof item.source === 'string' ? Buffer.byteLength(item.source) : item.source.byteLength;
      };
      const files = [entry.fileName, ...entry.imports, ...(entry.viteMetadata?.importedCss ?? [])];
      const assets: { url: string; size: number; wasm?: boolean }[] = [...new Set(files)].map((fileName) => ({ url: `/${fileName}`, size: sizeOf(fileName) }));
      assets.push({ url: `/${wasm.fileName}`, size: sizeOf(wasm.fileName), wasm: true });
      return [{ tag: 'script', children: `window.__loadingAssets=${JSON.stringify(assets)};${EARLY_LOAD_SCRIPT}`, injectTo: 'head-prepend' }];
    },
  };
}

/*
 * Runs in the head of index.html: downloads the wasm while counting bytes, and counts the other files once the browser
 * reports them as loaded.
 */
const EARLY_LOAD_SCRIPT = `(function(){
var assets=window.__loadingAssets,loaded={},total=0;
assets.forEach(function(a){total+=a.size;});
function report(){var done=0;assets.forEach(function(a){done+=Math.min(loaded[a.url]||0,a.size);});window.__loadingProgress={loaded:done,total:total};if(window.__onLoadingProgress){window.__onLoadingProgress(done,total);}}
var wasm=assets.filter(function(a){return a.wasm;})[0];
if(wasm&&window.fetch&&window.ReadableStream){
window.__aliasvaultCoreWasm=fetch(wasm.url).then(function(response){
if(!response.ok||!response.body){return response;}
var reader=response.body.getReader(),chunks=[];
function pump(){return reader.read().then(function(r){
if(r.done){loaded[wasm.url]=wasm.size;report();return new Response(new Blob(chunks),{status:response.status,headers:{'Content-Type':'application/wasm'}});}
chunks.push(r.value);loaded[wasm.url]=(loaded[wasm.url]||0)+r.value.byteLength;report();return pump();});}
return pump();});
}
if(window.PerformanceObserver){try{new PerformanceObserver(function(list){list.getEntries().forEach(function(e){var p;try{p=new URL(e.name).pathname;}catch(x){return;}assets.forEach(function(a){if(!a.wasm&&a.url===p){loaded[a.url]=a.size;}});});report();}).observe({type:'resource',buffered:true});}catch(x){}}
report();
})();`;

/**
 * Minify index.html (markup, inline scripts and styles) as the last transform, keeping only the header comment.
 */
function minifyIndexHtml(): Plugin {
  return {
    name: 'minify-index-html',
    transformIndexHtml: {
      order: 'post',
      handler: async (html) => {
        const minified = await minify(html, {
          collapseWhitespace: true,
          removeComments: true,
          ignoreCustomComments: [/AliasVault/],
          minifyCSS: true,
          minifyJS: true,
        });
        return minified.replace(/^(<!--[\s\S]*?-->)\s*/, '$1\n');
      },
    },
  };
}

// See https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    // Allow to serve files from the shared core directory (linked via file: dependencies).
    fs: {
      allow: [path.resolve('.'), CORE_DIR],
    },
  },
  optimizeDeps: {
    exclude: ['@aliasvault/client', '@aliasvault/models', '@aliasvault/vault'],
  },
  build: {
    target: 'es2022',
  },
  plugins: [
    react(),
    loadingScreenLocales(),
    loadingProgress(),
    minifyIndexHtml(),
  ],
});
