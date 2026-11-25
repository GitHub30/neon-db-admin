import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deriveDefaultConnectionName,
  inferDialectCandidates,
  isDefinitiveDialectError,
  refineDetectedDialect,
  sortDatabasesUserFirst,
} from '../src/core/dialect-detect.js';
import { ProxyDatabaseAdapter } from '../src/adapters/proxy-adapter.js';
import { createEmptyConnectionTemplate } from '../src/core/storage.js';
import type { ConnectionConfig } from '../src/types/db.js';

describe('dialect-detect & default connection naming', () => {
  it('defaults connection name to $username@$host from fields or URL', () => {
    expect(deriveDefaultConnectionName({ user: 'admin', host: 'db.example.com' })).toBe('admin@db.example.com');
    expect(
      deriveDefaultConnectionName({
        url: 'postgresql://appuser:secret@ep-cool-123.neon.tech:5432/neondb',
      })
    ).toBe('appuser@ep-cool-123.neon.tech');
    expect(deriveDefaultConnectionName({ name: 'Custom Alias', user: 'root', host: 'db.local' })).toBe('Custom Alias');
    expect(deriveDefaultConnectionName({ host: 'only-host.example.com' })).toBe('only-host.example.com');
  });

  it('infers dialect candidates from URL schemes, ports, and host hints', () => {
    expect(inferDialectCandidates({ url: 'postgresql://u:p@h/db' })[0].dialect).toBe('postgresql');
    expect(inferDialectCandidates({ url: 'mysql://u:p@h/db' })[0].dialect).toBe('mysql');
    expect(inferDialectCandidates({ url: 'mariadb://u:p@h/db' })[0].dialect).toBe('mariadb');
    expect(inferDialectCandidates({ url: 'https://demo-org.turso.io' })[0].dialect).toBe('libsql');

    // Port 5432 -> PostgreSQL first, MySQL fallback
    expect(inferDialectCandidates({ host: 'db.example.com', port: 5432 }).map((c) => c.dialect)).toEqual([
      'postgresql',
      'mysql',
    ]);
    // Port omitted + Neon host -> PostgreSQL 5432 first, MySQL 3306 fallback
    expect(inferDialectCandidates({ host: 'ep-1.us-east-2.aws.neon.tech' })).toEqual([
      { dialect: 'postgresql', port: 5432 },
      { dialect: 'mysql', port: 3306 },
    ]);
    // Port omitted + generic host -> MySQL 3306 first, PostgreSQL 5432 fallback
    expect(inferDialectCandidates({ host: 'db.example.com', user: 'root' })).toEqual([
      { dialect: 'mysql', port: 3306 },
      { dialect: 'postgresql', port: 5432 },
    ]);
  });

  it('stops fallback on definitive protocol auth errors and refines MariaDB', () => {
    expect(isDefinitiveDialectError('mysql', "Access denied for user 'root'@'1.2.3.4'")).toBe(true);
    expect(isDefinitiveDialectError('postgresql', 'password authentication failed for user "postgres"')).toBe(true);
    expect(isDefinitiveDialectError('mysql', 'Connection refused')).toBe(false);
    expect(refineDetectedDialect('mysql', '10.11.6-MariaDB-1:10.11.6+maria~ubu2204')).toBe('mariadb');
    expect(refineDetectedDialect('mysql', '8.0.36')).toBe('mysql');
  });

  it('sorts user databases ahead of system databases', () => {
    expect(
      sortDatabasesUserFirst(['sys', 'information_schema', 'shop_prod', 'mysql', 'analytics', 'performance_schema'], 'mysql')
    ).toEqual(['analytics', 'shop_prod', 'information_schema', 'mysql', 'performance_schema', 'sys']);
  });
});

describe('ProxyDatabaseAdapter auto-detection and SHOW DATABASES introspection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('probes MySQL -> PostgreSQL automatically when autoDetectDialect is enabled', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      if (body.dialect === 'mysql') {
        return new Response(JSON.stringify({ ok: false, error: 'Connection refused on port 3306' }), { status: 400 });
      }
      return new Response(
        JSON.stringify({ ok: true, rows: [['PostgreSQL 16.4 on x86_64']], durationMs: 12 }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const cfg: ConnectionConfig = {
      id: 'auto-1',
      name: 'admin@db.example.com',
      dialect: 'mysql',
      autoDetectDialect: true,
      transport: 'cloudflare-worker',
      proxyUrl: 'https://proxy.example.com',
      host: 'db.example.com',
      user: 'admin',
      createdAt: 1,
    };

    const adapter = new ProxyDatabaseAdapter(cfg);
    const res = await adapter.testConnection();
    expect(res.ok).toBe(true);
    expect(res.dialect).toBe('postgresql');
    expect(adapter.dialect).toBe('postgresql');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('runs SHOW DATABASES when MySQL database is unspecified and selects first user DB', async () => {
    const calls: Array<{ action: string; database?: string; sqls?: string[] }> = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      calls.push({
        action: body.action,
        database: body.connection?.database,
        sqls: body.statements?.map((s: { sql: string }) => s.sql),
      });

      if (body.action === 'batch' && body.statements?.length === 2) {
        return new Response(
          JSON.stringify({
            ok: true,
            results: [
              { ok: true, rows: [['10.11.6-MariaDB', null]] },
              {
                ok: true,
                rows: [['information_schema'], ['mysql'], ['shop_prod'], ['analytics']],
              },
            ],
          }),
          { status: 200 }
        );
      }

      // 6-statement information_schema batch for selected DB
      return new Response(
        JSON.stringify({
          ok: true,
          results: [
            { ok: true, rows: [['orders', 42, '']] },
            { ok: true, rows: [['orders', 'id', 'int', 'NO', null, 'PRI', 'auto_increment', '']] },
            { ok: true, rows: [] },
            { ok: true, rows: [] },
            { ok: true, rows: [] },
            { ok: true, rows: [] },
          ],
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const cfg: ConnectionConfig = {
      id: 'mysql-nodb',
      name: 'root@mysql.example.com',
      dialect: 'mysql',
      transport: 'cloudflare-worker',
      proxyUrl: 'https://proxy.example.com',
      host: 'mysql.example.com',
      user: 'root',
      database: '',
      createdAt: 1,
    };

    const adapter = new ProxyDatabaseAdapter(cfg);
    const schema = await adapter.introspectSchema();

    expect(schema.dialect).toBe('mariadb');
    expect(schema.databaseName).toBe('analytics');
    expect(schema.availableDatabases).toEqual(['analytics', 'shop_prod', 'information_schema', 'mysql']);
    expect(schema.tables.map((t) => t.name)).toEqual(['orders']);
    expect(adapter.getActiveDatabase()).toBe('analytics');

    // Switch database to shop_prod and verify payload database updates
    adapter.setActiveDatabase('shop_prod');
    await adapter.introspectSchema();
    expect(calls[calls.length - 1].database).toBe('shop_prod');
  });

  it('defaults SSL/TLS to disabled in empty template and transmits explicit ssl: false', async () => {
    const tpl = createEmptyConnectionTemplate();
    expect(tpl.ssl).toBe(false);
    expect(tpl.autoDetectDialect).toBe(true);

    let capturedSsl: unknown = 'unset';
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      capturedSsl = body.connection?.ssl;
      return new Response(JSON.stringify({ ok: true, rows: [['8.0.36']], durationMs: 5 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new ProxyDatabaseAdapter({ ...tpl, host: 'db.local', user: 'root' });
    const res = await adapter.testConnection();
    expect(res.ok).toBe(true);
    expect(capturedSsl).toBe(false);
  });
});
