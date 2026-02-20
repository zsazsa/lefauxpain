# Feature: Admin-Enabled Email Verification

## Intent

Currently, users register and an admin approves them — password is optional. This feature adds an optional email verification step that admins can toggle on. When enabled, registration requires a name, email, and password. The user must verify their email via a 6-digit code before they can log in. After verification, the user still requires admin approval to join the channel.

This creates a two-gate registration flow: first the user proves they own the email, then the admin decides whether to let them in.

## Current Behavior (Before This Feature)

- User registers (password optional)
- Admin reviews and approves/rejects
- Once approved, user can access the channel

## New Behavior (When Email Verification Is Enabled)

### Registration Flow

1. User submits registration with **name**, **email**, and **password** (all three required when verification is enabled)
2. System sends a **6-digit verification code** to the provided email
3. User enters the code on a verification screen
4. On successful verification, user enters **"verified, pending approval"** state
5. Admin sees the user in their approval queue, now marked as email-verified
6. Admin approves → user can log in and access the channel
7. Admin rejects → user is rejected as normal

### Login

- User can log in with **either their name or their email**, plus their password
- Login is only permitted after email verification AND admin approval
- If verified but not yet approved: show a message indicating they're waiting for admin approval
- If not yet verified: redirect to the verification screen

### Verification Code Rules

- Code is 6 digits, numeric only
- Code expires after **15 minutes**
- User may request a new code (previous code is invalidated)
- After **5 failed attempts**, the code is invalidated and user must request a new one
- Resend is rate-limited: max **3 resends per hour**

### Admin Controls

- Admin setting: **"Require email verification for new registrations"** (toggle, default off)
- When toggled on: all NEW registrations require email verification
- When toggled off: registration behaves as it does today (password optional, no verification)
- **Existing approved users are grandfathered** — toggling this on does NOT affect users already approved
- The admin approval queue shows verification status for each pending user

## Email Service

- **Default provider: Postmark**
- Architecture must support swappable email providers via a provider interface
- The system should define an email provider contract (send verification email, check delivery status) that Postmark implements
- Other providers (SendGrid, AWS SES, Mailgun, etc.) can be added by implementing the same contract
- **Admin configuration:** admin can set the email provider and API key in settings
- If no email provider is configured and verification is enabled, registration should fail gracefully with a clear error to the admin, not to the user

### Verification Email Content

- Subject: "Verify your email for [App/Channel Name]"
- Body: includes the 6-digit code, expiration time (15 minutes), and a note that they didn't need to do anything if they didn't request this
- Plain text and HTML versions
- Email templates should be stored in a dedicated templates directory, not hardcoded

## Constraints

- Must not break existing registration flow when verification is disabled
- Must not affect existing approved users when verification is toggled on
- Password becomes **required** when verification is enabled (it is currently optional)
- **Name uniqueness is case-insensitive.** "Kalli", "kalli", and "KALLI" are the same name. The display case entered at registration is preserved exactly, but no other user can register a name that matches when compared case-insensitively. Login by name is also case-insensitive — the user can type any casing and it matches.
- Email must be unique across all users (verified or not). Email comparison is also case-insensitive (per RFC 5321, the local part is technically case-sensitive, but virtually no provider enforces this — treat the entire email as case-insensitive).
- All verification codes must be hashed in the database, not stored in plain text
- Provider API keys must be stored encrypted

## Database Changes

- Users table needs: `email` (nullable, unique), `email_verified_at` (nullable timestamp)
- New table or columns for verification codes: `user_id`, `code_hash`, `expires_at`, `attempts`, `created_at`
- Admin settings: new setting key for `email_verification_enabled` (boolean) and `email_provider_config` (encrypted JSON)

## Out of Scope

- Email verification for existing/grandfathered users
- Password reset via email (future feature, can reuse the email infrastructure)
- OAuth / social login
- Multi-factor authentication (this is verification, not MFA)
- Email change flow for existing users

## Resolved Decisions

1. **Admin sees the email in the approval queue** — the admin approval screen shows the user's email alongside their name and verified status. No privacy abstraction needed.
2. **Mid-verification users auto-advance when verification is disabled** — if an admin disables email verification while users are mid-verification, those users skip the verification step and move directly to "pending approval" in the admin queue.
3. **No registration expiration** — verified-but-not-approved users wait indefinitely. There is no automatic expiration or cleanup of pending registrations.
