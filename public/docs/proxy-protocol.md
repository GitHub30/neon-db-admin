# Neon DB Admin Proxy Protocol v1

All proxy implementations (`workers/proxy-worker`, `proxies/proxy.php`, `proxies/proxy-node.mjs`) expose the same JSON HTTP API with `Access-Control-Allow-Origin: *`.

## Health Check
`GET /health` (or `GET /`) returns runtime capabilities and CORS status.

## Execute Query
`POST /api/query` (or `POST /`)

```json
{
  "action": "query",
  "dialect": "postgresql",
  "connection": {
    "host": "db.example.com",
    "port": 5432,
    "user": "postgres",
    "password": "***",
    "database": "app",
    "ssl": true
  },
  "sql": "SELECT id, email FROM users WHERE active = $1 LIMIT 50",
  "params": [true],
  "maxRows": 1000
}
```

## Security Requirements
- Always set `PROXY_AUTH_TOKEN` (Workers) or `NEON_DB_PROXY_TOKEN` (PHP/Node) when self-hosting.
- Always deploy behind HTTPS in production.
- Never allow private IP / cloud metadata targets on public-facing Workers proxies.
