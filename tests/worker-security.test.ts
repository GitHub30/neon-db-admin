import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  sanitizeError,
  validateHexId,
  validateHost,
  validateHttpsUrl,
  validatePort,
  validateUuid,
} from '../workers/proxy-worker/src/security.js';

describe('Cloudflare Worker proxy SSRF & security guards (post-adversarial hardening)', () => {
  it('blocks loopback, RFC1918, metadata, internal, short/octal/hex IPv4, colon escape, and all private IPv6 forms (C1)', () => {
    const blocked = [
      'localhost',
      'localhost.',
      'localhost.localdomain',
      'localhost:3306',
      'db.internal',
      'printer.local',
      'router.home.arpa',
      '127.0.0.1',
      '127.1',
      '127.0.1',
      '10.1',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.10',
      '169.254.169.254',
      '169.254.43518',
      '0.0.0.0',
      '100.64.0.1',
      '198.51.100.1',
      '203.0.113.5',
      '224.0.0.1',
      '239.255.255.250',
      '245.1.2.3',
      '255.255.255.255',
      '2130706433',
      '0x7f000001',
      '0x7f.0x0.0x0.0x1',
      '0177.0.0.1',
      '0177.0.1',
      '::1',
      '::',
      '0:0:0:0:0:0:0:1',
      '0:0:0:0:0:0:0:0',
      '::0:1',
      '0::1',
      '0:0:0:0:0:ffff:127.0.0.1',
      '0::ffff:169.254.169.254',
      '::127.0.0.1',
      '::7f00:1',
      '64:ff9b::169.254.169.254',
      '64:ff9b::a9fe:a9fe',
      '2002:7f00:0001::1',
      '2001:db8::1',
      'fe80::1',
      'fe81::1',
      'febf::1',
      'fc00::1',
      'fd12:3456::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      'fe80::1%eth0',
      'metadata.google.internal',
    ];
    for (const host of blocked) {
      expect(() => validateHost(host), `Expected "${host}" to be blocked`).toThrow();
    }
  });

  it('allows valid public database hostnames, public IPv4, and public IPv6', () => {
    expect(validateHost('ep-cool-sky.us-east-2.aws.neon.tech')).toBe('ep-cool-sky.us-east-2.aws.neon.tech');
    expect(validateHost('db.example.com.')).toBe('db.example.com');
    expect(validateHost('8.8.8.8')).toBe('8.8.8.8');
    expect(validateHost('2606:4700:4700::1111')).toBe('2606:4700:4700::1111');
  });

  it('validates ports, HTTPS URLs (blocking embedded credentials & non-443 ports), and D1 IDs (C2)', () => {
    expect(validatePort(5432, 5432)).toBe(5432);
    expect(() => validatePort(70000, 5432)).toThrow();
    expect(() => validateHttpsUrl('http://db.turso.io')).toThrow();
    expect(() => validateHttpsUrl('https://127.0.0.1/v2/pipeline')).toThrow();
    expect(() => validateHttpsUrl('https://user:pass@mydb.turso.io')).toThrow();
    expect(() => validateHttpsUrl('https://mydb.turso.io:8443')).toThrow();
    expect(() => validateHttpsUrl('https://[fe81::1]/v2/pipeline')).toThrow();
    expect(validateHttpsUrl('https://mydb-org.turso.io').hostname).toBe('mydb-org.turso.io');
    expect(validateHexId('0123456789abcdef0123456789abcdef', 'Account ID')).toHaveLength(32);
    expect(() => validateHexId('../../admin', 'Account ID')).toThrow();
    expect(validateUuid('123e4567-e89b-12d3-a456-426614174000', 'DB ID')).toContain('123e4567');
    expect(() => validateUuid('../evil', 'DB ID')).toThrow();
  });

  it('scrubs credentials including empty-user URIs and explicit secrets (L5)', () => {
    const scrubbed = sanitizeError(
      new Error('Failed postgresql://admin:Super@Secret123@db.example.com:5432/prod and token=tok_live_abc123'),
      ['tok_live_abc123']
    );
    expect(scrubbed).not.toContain('Super@Secret123');
    expect(scrubbed).not.toContain('tok_live_abc123');
    expect(scrubbed).toContain('postgresql://***@db.example.com:5432/prod');
    expect(constantTimeEqual('secret-token-abc', 'secret-token-abc')).toBe(true);
    expect(constantTimeEqual('secret-token-abc', 'secret-token-xyz')).toBe(false);
    expect(constantTimeEqual('short', 'longer-token')).toBe(false);
  });
});
