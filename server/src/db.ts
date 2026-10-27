import type { Sql, TransactionSql } from 'postgres';
import type { Claims } from './auth.ts';

export type Tx = TransactionSql;

// The only way the API touches the database: one transaction, run as meetup_api,
// with the verified claims attached so RLS sees the real user via private.uid().
export async function asUser<T>(sql: Sql, claims: Claims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const run = () =>
    sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      return fn(tx);
    }) as Promise<T>;

  try {
    return await run();
  } catch (e) {
    // Supavisor rejects the first login after a password change while it refreshes its cache.
    if ((e as { code?: string }).code === '28P01') return run();
    throw e;
  }
}
