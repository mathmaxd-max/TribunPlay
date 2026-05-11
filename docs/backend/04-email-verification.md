# Email verification (email/password accounts)

This project requires email verification for **email/password** accounts.

## Flow
- **Signup** (`POST /api/auth/signup`)
  - Creates the account and password credential
  - Creates a one-time verification token (stored hashed in D1)
  - Sends a verification email via Resend
  - Returns `{ success: true, requiresEmailVerification: true }`
- **Verify** (`POST /api/auth/verify-email`)
  - Consumes the token
  - Sets `accounts.email_verified_at`
- **Login** (`POST /api/auth/login`)
  - Returns **403** until the email is verified
- **Resend** (`POST /api/auth/resend-verification`)
  - Always returns `{ success: true }` to avoid account enumeration
  - Uses Turnstile (same as email/password auth)

Google sign-in does **not** use Turnstile and is not subject to email verification in this flow.

## Production configuration checklist

### Worker secrets / vars
Set these on the `tribunplay-server` Worker:

- `AUTH_TOKEN_SECRET` (secret)
  - Must be **>= 32 chars** (required for sessions)
- `RESEND_API_KEY` (secret)
  - Resend API key for sending transactional emails
- `EMAIL_FROM` (var or secret)
  - Example: `TribunPlay <noreply@tribun-ppc.com>`
- `APP_BASE_URL` (var)
  - Example: `https://tribun-ppc.com`

Optional:
- `TURNSTILE_ENABLED` (var, default is set in `apps/server/wrangler.jsonc`)
- `TURNSTILE_SECRET_KEY` (secret) when Turnstile is enabled
- `GOOGLE_CLIENT_ID` (var/secret) for Google sign-in

### Database
Apply migrations (including `0005_email_verification.sql`) to your D1 database.

## Manual test plan
- Signup with an email/password account
  - Expect `{ requiresEmailVerification: true }`
  - Receive email and open `/verify-email?token=...`
- Verify endpoint succeeds and the UI shows success
- Login succeeds after verification
- Google sign-in still works
