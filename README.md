# Neon DB Admin

**Universal Browser-Based Database Management Workbench & Visual ER Diagram Designer (PWA)**

- **Live Web App (GitHub Pages):** https://github30.github.io/neon-db-admin/
- **Live Cloudflare Workers Proxy:** https://neon-db-admin-proxy.6u.workers.dev/health (`Access-Control-Allow-Origin: *`)
- **LLMs / AI Discovery:** [`llms.txt`](https://github30.github.io/neon-db-admin/llms.txt) · [`llms-full.txt`](https://github30.github.io/neon-db-admin/llms-full.txt) · [`.well-known/ard.json`](https://github30.github.io/neon-db-admin/.well-known/ard.json)

## Features

Inspired by **phpMyAdmin**, **MySQL Workbench**, **DB Browser for SQLite**, **Adminer**, **pgAdmin**, **DBeaver**, and **DbGate**:

- **Supported Databases:** SQLite 3 (offline in-browser WebAssembly via Web Worker), MySQL, MariaDB, PostgreSQL (Neon / Supabase / RDS / Self-hosted), Cloudflare D1 (REST API & Worker Binding), LibSQL / Turso.
- **Connection Methods:**
  - Drag-and-drop / file upload for `.sqlite` / `.db` / `.sqlite3` (zero server upload)
  - **Cloudflare Workers Proxy** (`workers/proxy-worker/`) supporting all remote databases with `Access-Control-Allow-Origin: *` and SSRF defense
  - **Single-file PHP PDO Proxy** (`public/proxies/proxy.php`) with `Access-Control-Allow-Origin: *`, token auth, and SQLite sandbox defense
  - **Standalone Node.js Proxy** (`public/proxies/proxy-node.mjs`) for local/VPC databases
- **Data Grid & Inline Editing:** Pagination, SQL sorting, multi-condition WHERE filter builder, Quick Search, double-click inline cell edit with SQL preview & batch commit, foreign key hyperlink jump, JSON cell inspector, CSV (with formula injection protection) / JSON / SQL INSERT / Markdown export.
- **Multi-Tab SQL IDE:** Syntax highlighting, schema-aware autocomplete (`Ctrl+Space`), `Ctrl+Enter` execution, `EXPLAIN` plan, SQL formatter, query history, saved snippets, and interactive SVG charts (Bar / Line / Pie).
- **MySQL Workbench-Style Visual ER Diagram Designer:** Reverse engineering from active DB, Crow's Foot notation (`1:1`, `1:N`, `N:M`), drag/snap/pan/pointer-zoom canvas, topological auto-layout, forward engineering DDL generation, and SVG / 2x PNG / Mermaid / DBML / `.er.json` export.
- **Table Designer & Power Tools:** Create/Alter table, index & FK management, cross-dialect DDL converter, schema health audit, schema diff migration generator, smart mock data generator, SQL dump & auto-typed CSV/TSV/JSON import.
- **Modern UX & Web Standards:** Light/Dark/System theme, JA/EN/ZH/KO/VI localization with flag dropdown, `Ctrl+K` Command Palette, full offline PWA, SEO/AEO/GEO/AIO/LLMO compliance, and Lighthouse 100 across Mobile & Desktop.

## Local Development & Testing

```bash
npm install
npm run dev      # Start Vite dev server
npm test         # Run Vitest unit & security regression tests
npm run build    # Typecheck & build production dist/ + Service Worker precache
```

## Self-Hosting Proxies

### Cloudflare Workers Proxy
```bash
cd workers/proxy-worker
npm install
npx wrangler secret put PROXY_AUTH_TOKEN
npx wrangler deploy
```

### PHP Proxy (`proxy.php`)
```bash
# Quick start (NEON_DB_PROXY_TOKEN is optional)
php -S 127.0.0.1:8080 public/proxies/proxy.php

# Optional token authentication (recommended for public servers)
export NEON_DB_PROXY_TOKEN="$(openssl rand -hex 32)"
export NEON_DB_SQLITE_DIR="/var/data/sqlite"
php -S 0.0.0.0:8080 public/proxies/proxy.php
```

### Node.js Proxy (`proxy-node.mjs`)
```bash
npm i mysql2 pg
# Quick start (NEON_DB_PROXY_TOKEN is optional)
PORT=8787 node public/proxies/proxy-node.mjs

# Optional token authentication (recommended for shared/public networks)
NEON_DB_PROXY_TOKEN="$(openssl rand -hex 32)" PORT=8787 node public/proxies/proxy-node.mjs
```

## Security & Adversarial Review

See [`docs/adversarial-review.md`](./docs/adversarial-review.md) for the complete adversarial audit findings and remediations.
