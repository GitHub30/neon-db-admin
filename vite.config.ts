import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function copySqlJsWasm() {
  return {
    name: 'copy-sqljs-wasm',
    buildStart() {
      const src = resolve(__dirname, 'node_modules/sql.js/dist/sql-wasm.wasm');
      const destDir = resolve(__dirname, 'public/wasm');
      const dest = resolve(destDir, 'sql-wasm.wasm');
      if (existsSync(src)) {
        mkdirSync(destDir, { recursive: true });
        copyFileSync(src, dest);
      }
    },
  };
}

/**
 * Injects hashed Vite assets and sql-wasm.wasm into dist/sw.js so full offline PWA mode
 * works immediately after installation (fixing C8).
 */
function injectSwPrecacheManifest() {
  return {
    name: 'inject-sw-precache',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');
      const swPath = resolve(distDir, 'sw.js');
      const assetsDir = resolve(distDir, 'assets');
      const htmlPath = resolve(distDir, 'index.html');

      // Inline tiny compiled stylesheet directly into dist/index.html for zero render-blocking requests
      if (existsSync(htmlPath)) {
        let html = readFileSync(htmlPath, 'utf8');
        html = html.replace(
          /<link rel="stylesheet"[^>]*href="\.\/assets\/([^"]+\.css)"[^>]*>/g,
          (match, cssFile: string) => {
            const cssPath = resolve(assetsDir, cssFile);
            if (!existsSync(cssPath)) return match;
            const cssContent = readFileSync(cssPath, 'utf8');
            return `<style>${cssContent}</style>`;
          }
        );
        writeFileSync(htmlPath, html, 'utf8');
      }

      if (!existsSync(swPath)) return;

      const precache: string[] = [
        './',
        './index.html',
        './manifest.webmanifest',
        './favicon.ico',
        './icons/icon.svg',
        './icons/icon-192.png',
        './icons/icon-512.png',
      ];

      if (existsSync(assetsDir)) {
        for (const f of readdirSync(assetsDir)) {
          if (f.endsWith('.js') || f.endsWith('.css')) {
            precache.push(`./assets/${f}`);
          }
        }
      }
      if (existsSync(resolve(distDir, 'wasm/sql-wasm.wasm'))) {
        precache.push('./wasm/sql-wasm.wasm');
      }

      const buildVersion = `neon-db-admin-${Date.now().toString(36)}`;
      let sw = readFileSync(swPath, 'utf8');
      sw = sw.replace("const CACHE_NAME = 'neon-db-admin-v1';", `const CACHE_NAME = '${buildVersion}';`);
      sw = sw.replace(
        /const APP_SHELL = \[[\s\S]*?\];/,
        `const APP_SHELL = ${JSON.stringify(precache, null, 2)};`
      );
      writeFileSync(swPath, sw, 'utf8');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [copySqlJsWasm(), injectSwPrecacheManifest()],
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    minify: 'esbuild',
    cssMinify: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('er-diagram')) return 'er-diagram';
          if (id.includes('data-grid')) return 'data-grid';
          if (id.includes('sql-editor')) return 'sql-editor';
          if (id.includes('table-designer')) return 'table-designer';
          if (id.includes('db-tools') || id.includes('schema-diff') || id.includes('mock-data')) return 'db-tools';
          if (id.includes('import-export') || id.includes('proxy-guide')) return 'io-modals';
          if (id.includes('charts')) return 'charts';
        },
      },
    },
  },
});
