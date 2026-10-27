import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SUPABASE_ROOT_CA } from './supabase-ca.ts';

describe('embedded Supabase CA', () => {
  it('matches server/certs/supabase-ca.crt', () => {
    const file = readFileSync(new URL('../certs/supabase-ca.crt', import.meta.url), 'utf8');
    expect(SUPABASE_ROOT_CA.trim()).toBe(file.replace(/\r\n/g, '\n').trim());
  });

  it('is a CA certificate with no private key', () => {
    expect(SUPABASE_ROOT_CA).not.toContain('PRIVATE KEY');
    expect(new X509Certificate(SUPABASE_ROOT_CA).ca).toBe(true);
  });
});
