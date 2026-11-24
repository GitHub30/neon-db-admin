<?php
/**
 * Neon DB Admin — Single-File PHP Database Proxy (v1.2.0)
 *
 * Supported Databases: MySQL, MariaDB, PostgreSQL, SQLite (via PHP PDO)
 * CORS: Access-Control-Allow-Origin: * (configurable via NEON_DB_ALLOWED_ORIGIN)
 *
 * Usage:
 *   # Quick start (no token required):
 *   php -S 127.0.0.1:8080 proxy.php
 *
 *   # Recommended for public internet servers (optional token auth):
 *   export NEON_DB_PROXY_TOKEN="$(openssl rand -hex 32)"
 *   export NEON_DB_SQLITE_DIR="/var/data/sqlite"
 *   php -S 0.0.0.0:8080 proxy.php
 */

declare(strict_types=1);

// Prevent PHP warnings/notices from corrupting JSON or leaking filesystem paths
ini_set('display_errors', '0');
ini_set('html_errors', '0');
error_reporting(0);

// ============================================================================
// Configuration (NEON_DB_PROXY_TOKEN is optional; leave empty to disable auth)
// ============================================================================
$PROXY_TOKEN        = getenv('NEON_DB_PROXY_TOKEN') ?: '';
$ALLOWED_ORIGIN     = getenv('NEON_DB_ALLOWED_ORIGIN') ?: '*';
$SQLITE_ALLOWED_DIR = getenv('NEON_DB_SQLITE_DIR') ?: __DIR__;
$MAX_ROWS           = min(max((int)(getenv('NEON_DB_MAX_ROWS') ?: 5000), 1), 10000);
$MAX_BODY_BYTES     = 2 * 1024 * 1024; // 2 MB
$QUERY_TIMEOUT_SEC  = min(max((int)(getenv('NEON_DB_TIMEOUT_SEC') ?: 15), 1), 60);

// ============================================================================
// CORS & Security Headers (applied unconditionally including fatal errors)
// ============================================================================
function emitHeaders(string $origin): void
{
    if (headers_sent()) {
        return;
    }
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Proxy-Token, X-Requested-With, X-DB-Dialect');
    header('Access-Control-Expose-Headers: X-Query-Time-Ms, X-Proxy-Version');
    header('Access-Control-Max-Age: 86400');
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store');
    header('X-Proxy-Version: 1.2.0');
}

emitHeaders($ALLOWED_ORIGIN);

register_shutdown_function(static function () use ($ALLOWED_ORIGIN): void {
    $err = error_get_last();
    if ($err !== null && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        emitHeaders($ALLOWED_ORIGIN);
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'Internal proxy runtime error.']);
    }
});

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function sendJson(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function readAuthToken(): string
{
    $token = $_SERVER['HTTP_X_PROXY_TOKEN'] ?? '';
    if ($token !== '') {
        return $token;
    }
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if ($auth === '' && function_exists('getallheaders')) {
        $hdrs = getallheaders();
        if (is_array($hdrs)) {
            foreach ($hdrs as $k => $v) {
                $lk = strtolower((string)$k);
                if ($lk === 'x-proxy-token' && is_string($v) && $v !== '') {
                    return $v;
                }
                if ($lk === 'authorization' && is_string($v) && $v !== '') {
                    $auth = $v;
                }
            }
        }
    }
    if (str_starts_with($auth, 'Bearer ')) {
        return substr($auth, 7);
    }
    return '';
}

function detectSupportedDialects(): array
{
    $drivers = class_exists('PDO') ? PDO::getAvailableDrivers() : [];
    $supported = [];
    if (in_array('mysql', $drivers, true)) {
        $supported[] = 'mysql';
        $supported[] = 'mariadb';
    }
    if (in_array('pgsql', $drivers, true)) {
        $supported[] = 'postgresql';
    }
    if (in_array('sqlite', $drivers, true)) {
        $supported[] = 'sqlite';
    }
    return $supported;
}

// Health check
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    sendJson([
        'ok' => true,
        'service' => 'neon-db-admin-proxy',
        'runtime' => 'php-pdo',
        'phpVersion' => PHP_VERSION,
        'version' => '1.2.0',
        'cors' => $ALLOWED_ORIGIN,
        'supportedDialects' => detectSupportedDialects(),
        'authRequired' => ($PROXY_TOKEN !== ''),
        'configured' => true,
    ]);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    sendJson(['ok' => false, 'error' => 'Method not allowed. Use GET or POST.'], 405);
}

// ============================================================================
// Optional Authentication (enforced only when NEON_DB_PROXY_TOKEN is set)
// ============================================================================
if ($PROXY_TOKEN !== '') {
    $provided = readAuthToken();
    if ($provided === '' || !hash_equals($PROXY_TOKEN, $provided)) {
        sendJson(['ok' => false, 'error' => 'Unauthorized: invalid or missing proxy token.'], 401);
    }
}

// ============================================================================
// Request Parsing
// ============================================================================
$rawBody = file_get_contents('php://input', false, null, 0, $MAX_BODY_BYTES + 1);
if ($rawBody === false || strlen($rawBody) > $MAX_BODY_BYTES) {
    sendJson(['ok' => false, 'error' => 'Payload too large (max 2 MB).'], 413);
}

$req = json_decode($rawBody, true);
if (!is_array($req)) {
    sendJson(['ok' => false, 'error' => 'Invalid JSON request body.'], 400);
}

$action = (string)($req['action'] ?? 'query');
$dialect = (string)($req['dialect'] ?? '');
$conn = is_array($req['connection'] ?? null) ? $req['connection'] : [];
$reqMaxRows = min(max((int)($req['maxRows'] ?? $MAX_ROWS), 1), $MAX_ROWS);

if (!in_array($dialect, ['mysql', 'mariadb', 'postgresql', 'sqlite'], true)) {
    sendJson(['ok' => false, 'error' => 'Unsupported dialect for PHP PDO proxy.'], 400);
}

// ============================================================================
// Security Validators (DSN Injection & SQLite Sandbox Defense)
// ============================================================================
function validateDsnHost(string $host): string
{
    $clean = trim($host);
    if ($clean === '' || strlen($clean) > 253 || preg_match('/[\s;=\\\\\/\x00-\x1f]/', $clean)) {
        throw new InvalidArgumentException('Invalid database host format.');
    }
    return $clean;
}

function validateDsnDbName(string $db): string
{
    if ($db === '') {
        return '';
    }
    if (strlen($db) > 128 || preg_match('/[\s;=\'\\\\\x00-\x1f]/', $db)) {
        throw new InvalidArgumentException('Invalid database name format.');
    }
    return $db;
}

function resolveSafeSqlitePath(string $requestedPath, string $allowedDir): string
{
    if ($requestedPath === ':memory:') {
        return ':memory:';
    }
    if ($requestedPath === '' || str_contains($requestedPath, "\0")) {
        throw new InvalidArgumentException('Invalid SQLite file path.');
    }
    $ext = strtolower(pathinfo($requestedPath, PATHINFO_EXTENSION));
    if (!in_array($ext, ['sqlite', 'sqlite3', 'db', 'db3'], true)) {
        throw new RuntimeException('SQLite files must use .sqlite, .sqlite3, .db, or .db3 extension.');
    }

    $realAllowed = realpath($allowedDir);
    if ($realAllowed === false || !is_dir($realAllowed)) {
        throw new RuntimeException('SQLITE_ALLOWED_DIR does not exist on server.');
    }

    $candidate = str_starts_with($requestedPath, '/')
        ? $requestedPath
        : $realAllowed . DIRECTORY_SEPARATOR . ltrim($requestedPath, '/\\');

    if (is_link($candidate)) {
        throw new RuntimeException('Access denied: symbolic links are not permitted for SQLite paths.');
    }

    $realTarget = realpath($candidate);
    if ($realTarget === false) {
        $parentReal = realpath(dirname($candidate));
        if ($parentReal === false || !str_starts_with($parentReal . DIRECTORY_SEPARATOR, $realAllowed . DIRECTORY_SEPARATOR)) {
            throw new RuntimeException('Access denied: SQLite file must reside inside SQLITE_ALLOWED_DIR.');
        }
        return $parentReal . DIRECTORY_SEPARATOR . basename($candidate);
    }

    if ($realTarget === $realAllowed || is_dir($realTarget)) {
        throw new RuntimeException('Access denied: SQLite target must be a file, not a directory.');
    }
    if (!str_starts_with($realTarget, $realAllowed . DIRECTORY_SEPARATOR)) {
        throw new RuntimeException('Access denied: SQLite path traversal blocked.');
    }
    return $realTarget;
}

function stripSqlLiteralsAndComments(string $sql): string
{
    $len = strlen($sql);
    $out = '';
    $i = 0;
    while ($i < $len) {
        $ch = $sql[$i];
        $next = $i + 1 < $len ? $sql[$i + 1] : '';
        if ($ch === '-' && $next === '-') {
            $nl = strpos($sql, "\n", $i + 2);
            $i = $nl === false ? $len : $nl + 1;
            $out .= ' ';
            continue;
        }
        if ($ch === '/' && $next === '*') {
            $end = strpos($sql, '*/', $i + 2);
            $i = $end === false ? $len : $end + 2;
            $out .= ' ';
            continue;
        }
        if ($ch === "'" || $ch === '"' || $ch === '`') {
            $q = $ch;
            $i++;
            while ($i < $len) {
                if ($sql[$i] === $q && ($i + 1 < $len && $sql[$i + 1] === $q)) {
                    $i += 2;
                    continue;
                }
                if ($sql[$i] === $q) {
                    $i++;
                    break;
                }
                $i++;
            }
            $out .= ' ';
            continue;
        }
        $out .= $ch;
        $i++;
    }
    return $out;
}

function assertSafeSqliteSql(string $sql): void
{
    $stripped = stripSqlLiteralsAndComments($sql);
    if (preg_match('/\b(ATTACH|DETACH|LOAD_EXTENSION)\b/i', $stripped)) {
        throw new RuntimeException('Security policy: ATTACH, DETACH, and load_extension are disabled in proxy.php SQLite mode.');
    }
}

function rewritePgPlaceholdersForPdo(string $sql): string
{
    $len = strlen($sql);
    $out = '';
    $i = 0;
    while ($i < $len) {
        $ch = $sql[$i];
        $next = $i + 1 < $len ? $sql[$i + 1] : '';
        if ($ch === '-' && $next === '-') {
            $nl = strpos($sql, "\n", $i + 2);
            $end = $nl === false ? $len : $nl + 1;
            $out .= substr($sql, $i, $end - $i);
            $i = $end;
            continue;
        }
        if ($ch === '/' && $next === '*') {
            $pos = strpos($sql, '*/', $i + 2);
            $end = $pos === false ? $len : $pos + 2;
            $out .= substr($sql, $i, $end - $i);
            $i = $end;
            continue;
        }
        if ($ch === "'" || $ch === '"') {
            $q = $ch;
            $start = $i;
            $i++;
            while ($i < $len) {
                if ($sql[$i] === $q && ($i + 1 < $len && $sql[$i + 1] === $q)) {
                    $i += 2;
                    continue;
                }
                if ($sql[$i] === $q) {
                    $i++;
                    break;
                }
                $i++;
            }
            $out .= substr($sql, $start, $i - $start);
            continue;
        }
        if ($ch === '$' && preg_match('/^\$[A-Za-z_0-9]*\$/', substr($sql, $i), $dm)) {
            $tag = $dm[0];
            $close = strpos($sql, $tag, $i + strlen($tag));
            $end = $close === false ? $len : $close + strlen($tag);
            $out .= substr($sql, $i, $end - $i);
            $i = $end;
            continue;
        }
        if ($ch === '$' && preg_match('/^\$(\d+)/', substr($sql, $i), $pm)) {
            $out .= ':p' . $pm[1];
            $i += strlen($pm[0]);
            continue;
        }
        $out .= $ch;
        $i++;
    }
    return $out;
}

function createPdo(string $dialect, array $conn, string $sqliteAllowedDir, int $timeoutSec): PDO
{
    $options = [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_TIMEOUT => $timeoutSec,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_NUM,
    ];

    if ($dialect === 'sqlite') {
        $path = resolveSafeSqlitePath((string)($conn['filePath'] ?? $conn['database'] ?? ''), $sqliteAllowedDir);
        $pdo = new PDO('sqlite:' . $path, null, null, $options);
        $pdo->exec('PRAGMA foreign_keys = ON;');
        return $pdo;
    }

    $host = (string)($conn['host'] ?? '127.0.0.1');
    $user = (string)($conn['user'] ?? '');
    $pass = (string)($conn['password'] ?? '');
    $db   = (string)($conn['database'] ?? '');
    $ssl  = !empty($conn['ssl']);
    $verifyCert = !array_key_exists('sslRejectUnauthorized', $conn) || !empty($conn['sslRejectUnauthorized']);

    if (!empty($conn['url']) && is_string($conn['url'])) {
        $parsed = parse_url($conn['url']);
        if (is_array($parsed)) {
            if (isset($parsed['host'])) $host = $parsed['host'];
            if (isset($parsed['port'])) $conn['port'] = (int)$parsed['port'];
            if (isset($parsed['user'])) $user = rawurldecode($parsed['user']);
            if (isset($parsed['pass'])) $pass = rawurldecode($parsed['pass']);
            if (isset($parsed['path']) && $parsed['path'] !== '/') $db = rawurldecode(ltrim($parsed['path'], '/'));
        }
    }

    $host = validateDsnHost($host);
    $db = validateDsnDbName($db);

    if ($dialect === 'mysql' || $dialect === 'mariadb') {
        $port = (int)($conn['port'] ?? 3306);
        if ($port < 1 || $port > 65535) throw new InvalidArgumentException('Invalid port.');
        $dsn = sprintf('mysql:host=%s;port=%d;charset=utf8mb4', $host, $port);
        if ($db !== '') {
            $dsn .= ';dbname=' . $db;
        }
        if ($ssl && defined('PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT')) {
            $options[PDO::MYSQL_ATTR_SSL_VERIFY_SERVER_CERT] = $verifyCert;
        }
        return new PDO($dsn, $user, $pass, $options);
    }

    if ($dialect === 'postgresql') {
        $port = (int)($conn['port'] ?? 5432);
        if ($port < 1 || $port > 65535) throw new InvalidArgumentException('Invalid port.');
        $dsn = sprintf('pgsql:host=%s;port=%d;dbname=%s', $host, $port, $db !== '' ? $db : 'postgres');
        if ($ssl) {
            $dsn .= ';sslmode=' . ($verifyCert ? 'verify-full' : 'require');
        }
        return new PDO($dsn, $user, $pass, $options);
    }

    throw new InvalidArgumentException('Unsupported dialect.');
}

function getTestSql(string $dialect): string
{
    return match ($dialect) {
        'mysql', 'mariadb' => 'SELECT VERSION() AS version, DATABASE() AS current_db, 1 AS ok',
        'postgresql' => 'SELECT version() AS version, current_database() AS current_db, 1 AS ok',
        'sqlite' => 'SELECT sqlite_version() AS version, 1 AS ok',
    };
}

function bindTypedValue(PDOStatement $stmt, int|string $key, mixed $val): void
{
    if ($val === null) {
        $stmt->bindValue($key, null, PDO::PARAM_NULL);
    } elseif (is_bool($val)) {
        $stmt->bindValue($key, $val, PDO::PARAM_BOOL);
    } elseif (is_int($val)) {
        $stmt->bindValue($key, $val, PDO::PARAM_INT);
    } else {
        $stmt->bindValue($key, is_scalar($val) ? (string)$val : json_encode($val), PDO::PARAM_STR);
    }
}

function runStatement(PDO $pdo, string $dialect, string $sql, array $params, int $maxRows): array
{
    if ($dialect === 'sqlite') {
        assertSafeSqliteSql($sql);
    }

    $started = microtime(true);
    if (count($params) === 0) {
        $stmt = $pdo->query($sql);
    } elseif ($dialect === 'postgresql' && preg_match('/\$\d+/', $sql)) {
        $rewritten = rewritePgPlaceholdersForPdo($sql);
        $stmt = $pdo->prepare($rewritten);
        foreach (array_values($params) as $idx => $val) {
            bindTypedValue($stmt, ':p' . ($idx + 1), $val);
        }
        $stmt->execute();
    } else {
        $stmt = $pdo->prepare($sql);
        foreach (array_values($params) as $idx => $val) {
            bindTypedValue($stmt, $idx + 1, $val);
        }
        $stmt->execute();
    }

    $colCount = $stmt->columnCount();
    $columns = [];
    $rows = [];
    $truncated = false;
    $affected = $stmt->rowCount();
    $insertId = null;

    if ($colCount > 0) {
        for ($i = 0; $i < $colCount; $i++) {
            $meta = $stmt->getColumnMeta($i) ?: [];
            $columns[] = [
                'name' => (string)($meta['name'] ?? ('col_' . $i)),
                'type' => (string)($meta['native_type'] ?? $meta['sqlite:decl_type'] ?? 'ANY'),
            ];
        }
        $count = 0;
        while (($row = $stmt->fetch(PDO::FETCH_NUM)) !== false) {
            if ($count >= $maxRows) {
                $truncated = true;
                break;
            }
            $rows[] = array_map(static function ($val) {
                if (is_resource($val)) {
                    $bin = stream_get_contents($val, 4096);
                    return $bin === false ? null : '0x' . bin2hex($bin);
                }
                return $val;
            }, $row);
            $count++;
        }
    } else {
        try {
            $id = $pdo->lastInsertId();
            if ($id !== false && $id !== '' && $id !== '0') {
                $insertId = $id;
            }
        } catch (Throwable) {
            // PostgreSQL without sequence throws on lastInsertId
        }
    }

    $durationMs = round((microtime(true) - $started) * 1000, 2);
    return [
        'ok' => true,
        'columns' => $columns,
        'rows' => $rows,
        'rowCount' => count($rows),
        'affectedRows' => $affected,
        'insertId' => $insertId,
        'truncated' => $truncated,
        'durationMs' => $durationMs,
    ];
}

// ============================================================================
// Execute
// ============================================================================
$totalStart = microtime(true);
try {
    $pdo = createPdo($dialect, $conn, $SQLITE_ALLOWED_DIR, $QUERY_TIMEOUT_SEC);

    if ($action === 'test') {
        $result = runStatement($pdo, $dialect, getTestSql($dialect), [], $reqMaxRows);
        header('X-Query-Time-Ms: ' . $result['durationMs']);
        sendJson($result);
    }

    if ($action === 'batch') {
        $stmts = $req['statements'] ?? null;
        if (!is_array($stmts) || count($stmts) === 0 || count($stmts) > 50) {
            sendJson(['ok' => false, 'error' => 'Batch requires 1 to 50 SQL statements.'], 400);
        }
        $results = [];
        foreach ($stmts as $item) {
            if (!is_array($item) || !is_string($item['sql'] ?? null) || trim($item['sql']) === '') {
                sendJson(['ok' => false, 'error' => 'Each batch statement must contain a non-empty SQL string.'], 400);
            }
            $params = is_array($item['params'] ?? null) ? $item['params'] : [];
            $results[] = runStatement($pdo, $dialect, $item['sql'], $params, $reqMaxRows);
        }
        $totalMs = round((microtime(true) - $totalStart) * 1000, 2);
        header('X-Query-Time-Ms: ' . $totalMs);
        sendJson(['ok' => true, 'results' => $results, 'durationMs' => $totalMs]);
    }

    if ($action === 'query') {
        $sql = (string)($req['sql'] ?? '');
        if (trim($sql) === '') {
            sendJson(['ok' => false, 'error' => 'SQL query string is required.'], 400);
        }
        $params = is_array($req['params'] ?? null) ? $req['params'] : [];
        $result = runStatement($pdo, $dialect, $sql, $params, $reqMaxRows);
        header('X-Query-Time-Ms: ' . $result['durationMs']);
        sendJson($result);
    }

    sendJson(['ok' => false, 'error' => 'Invalid action. Expected test, query, or batch.'], 400);
} catch (Throwable $e) {
    $totalMs = round((microtime(true) - $totalStart) * 1000, 2);
    header('X-Query-Time-Ms: ' . $totalMs);
    $safeMsg = preg_replace('/([a-z][a-z0-9+.-]*:\/\/)([^\/\s]*)@([^\/@\s]+)/i', '$1***@$3', $e->getMessage()) ?? 'Database error';
    $pass = (string)($conn['password'] ?? '');
    if (strlen($pass) >= 4) {
        $safeMsg = str_replace($pass, '***', $safeMsg);
    }
    sendJson(['ok' => false, 'error' => substr($safeMsg, 0, 600), 'durationMs' => $totalMs], 400);
}
