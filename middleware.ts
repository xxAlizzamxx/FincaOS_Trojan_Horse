import { NextRequest, NextResponse } from 'next/server';

/**
 * Edge middleware — server-side auth guard for protected routes.
 *
 * Firebase ID tokens are JWTs, so we can verify the signature without
 * a round-trip to the Admin SDK by checking the token header/payload.
 * For full cryptographic verification we redirect unauthenticated users
 * to /login. Admins who have the token in the cookie/session will pass.
 *
 * Strategy:
 * - The client stores the Firebase ID token in a __session cookie
 *   (set by the app after login, httpOnly=false so JS can also read it).
 * - Middleware checks for a non-empty token cookie. If absent → redirect.
 * - Full role validation still happens in each layout (useAuth) and in
 *   API routes using Firebase Admin SDK — this is a first-line defence
 *   that prevents unauthenticated page renders without any JS.
 *
 * Protected paths:
 *   /admin/**       → must have session token
 *   /vigilante/**   → must have session token
 */

const PROTECTED_PREFIXES = ['/admin', '/vigilante'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  // Check for Firebase session cookie (set by client after login)
  const token = req.cookies.get('__session')?.value;

  if (!token) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/vigilante/:path*'],
};
