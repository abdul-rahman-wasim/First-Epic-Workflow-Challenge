import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';

export type Claims = JWTPayload & { sub: string; role: string };
export type VerifyToken = (token: string) => Promise<Claims | null>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Verifies a Supabase Auth access token against the project's JWKS.
// This is the only gate: the Functions gateway does not check tokens for this project.
export function createVerifier(supabaseUrl: string): VerifyToken {
  const issuer = `${supabaseUrl}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

  return async (token) => {
    let payload: JWTPayload;
    try {
      // Asymmetric only: Supabase signing keys are ES256 or RS256; never accept HS* or none.
      ({ payload } = await jwtVerify(token, jwks, {
        issuer,
        audience: 'authenticated',
        algorithms: ['ES256', 'RS256'],
      }));
    } catch (e) {
      // Bad token → 401. JWKS unreachable or timing out → rethrow (500), not a fake sign-out.
      if (e instanceof errors.JOSEError && !(e instanceof errors.JWKSTimeout)) return null;
      throw e;
    }

    const anonymous = payload.is_anonymous === true;
    if (payload.role !== 'authenticated' || anonymous || typeof payload.sub !== 'string' || !UUID.test(payload.sub)) {
      return null;
    }
    return payload as Claims;
  };
}
