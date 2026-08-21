# Authentication and session security

Vanteloq uses Supabase Auth for public email/password identity and Cloudflare for the application edge. The browser is never authoritative for a role, organization, entitlement, or MFA decision.

## Implemented controls

- Every bearer token is validated against Supabase Auth before Vanteloq reads its claims.
- The first verified login binds the application user to the immutable Supabase user ID. A later email match with a different ID is denied.
- Every Supabase-backed application API requires an `aal2` session. Onboarding creation also requires `aal2`.
- TOTP enrollment and challenge use Supabase MFA. The application confirms the upgraded AAL after verification.
- Sign-in is same-origin, Turnstile-protected, body-bounded, and limited to five attempts per account/source pair and fifteen attempts per source per fifteen-minute window.
- Sign-up and password reset require at least 12 characters with uppercase, lowercase, number, and symbol checks. The same policy is now saved in the live Supabase Email provider, and secure password change is enabled.
- Signup detects a provider password minimum that exceeds the application policy and returns a safe operational message without exposing the raw provider error.
- Passwords are sent only to Supabase Auth and are never persisted by Vanteloq.
- The browser persists a rotating Supabase refresh token so separate phone and desktop sessions work. Business data and memory remain server-side and tenant-scoped; they are not copied into browser storage.
- Access JWTs are short-lived and refresh tokens use Supabase rotation/reuse detection. Global sign-out is used after a password change.
- PKCE protects email confirmation and recovery authorization codes. A recovery link should be opened in the browser that requested it.
- The Worker enforces CSP, frame denial, HSTS, no-sniff, no-store API responses, and same-origin mutation checks.
- Public Supabase tables have RLS enabled. Security-definer trigger functions are not executable by `anon` or `authenticated`; the authenticated tenant-role helper retains only the execution required by RLS.

## Required provider setting before launch

The Supabase security advisor currently reports one warning: leaked-password protection is disabled. The live dashboard confirms this control requires a Supabase Pro plan; the current project is on Free. After upgrading, enable **Authentication → Sign In / Providers → Email → Prevent use of leaked passwords**. This provider control checks new passwords against known breaches.

Multiple active sessions remain enabled because the product supports the same account on a phone and desktop. The live JWT lifetime is 3,600 seconds, refresh-token compromise detection is enabled, and the reuse interval is 10 seconds. Supabase requires Pro to configure inactivity/time-box controls; choose and record those values during the final launch review without enabling single-session mode.

## Verification evidence

- Production build and typecheck pass.
- Auth/MFA interaction tests pass.
- Hostile-path tests cover anonymous denial, cross-site sign-in and sign-up denial, and fail-closed Auth configuration.
- Tenant-isolation and migration flow tests pass.
- Production dependency audit reports zero known vulnerabilities.
- The live Supabase privilege recheck confirms both trigger functions are denied to `anon` and `authenticated`; the security advisor has only the leaked-password warning above.

No software can guarantee that a breach is impossible. These controls reduce credential stuffing, session theft, cross-account binding, client-side role bypass, CSRF, and cross-tenant access risks; monitoring, backup restoration tests, dependency patching, and independent penetration testing remain launch obligations.
