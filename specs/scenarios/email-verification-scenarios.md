# Scenarios: Email Verification

These scenarios validate the email verification feature. They are the
contract. Code must satisfy these — scenarios must not be modified to
accommodate code.

---

## Registration (Verification Enabled)

### Scenario: Successful registration with email verification
1. Admin enables "Require email verification"
2. Admin has configured Postmark with valid API key
3. User submits registration with name: "alice", email: "alice@example.com", password: "Str0ngP@ss"
4. Assert: registration accepted, user is in "pending_verification" state
5. Assert: a 6-digit numeric code was sent to alice@example.com via Postmark
6. Assert: user is NOT visible in admin approval queue yet
7. Assert: user cannot log in (receives "please verify your email" message)

### Scenario: Registration requires all three fields when verification is enabled
1. Admin enables email verification
2. User submits registration with name and email but NO password
3. Assert: registration rejected with clear error indicating password is required
4. User submits registration with name and password but NO email
5. Assert: registration rejected with clear error indicating email is required
6. User submits registration with email and password but NO name
7. Assert: registration rejected with clear error indicating name is required

### Scenario: Duplicate email is rejected (exact match)
1. Admin enables email verification
2. User registers as "alice" with alice@example.com — succeeds
3. Second user attempts to register as "bob" with alice@example.com
4. Assert: registration rejected with error indicating email is already in use
5. Assert: no verification email sent for the duplicate attempt

### Scenario: Duplicate name is rejected (case-insensitive)
1. Admin enables email verification
2. User registers as "Kalli" with kalli@example.com — succeeds
3. Second user attempts to register as "kalli" with someone@example.com
4. Assert: registration rejected with error indicating name is already in use
5. Second user attempts to register as "KALLI" with someone@example.com
6. Assert: registration rejected with error indicating name is already in use
7. Second user attempts to register as "kAlLi" with someone@example.com
8. Assert: registration rejected with error indicating name is already in use

### Scenario: Display case is preserved from registration
1. Admin enables email verification
2. User registers as "Kalli" (capital K)
3. Assert: user's display name is stored and shown as "Kalli" — not lowercased or altered

### Scenario: Login by name is case-insensitive
1. User "Kalli" has completed registration, verification, and admin approval
2. User logs in with name "kalli" and correct password
3. Assert: login succeeds
4. User logs in with name "KALLI" and correct password
5. Assert: login succeeds
6. User logs in with name "Kalli" and correct password
7. Assert: login succeeds

### Scenario: Duplicate email is rejected (case-insensitive)
1. Admin enables email verification
2. User registers as "alice" with Alice@Example.com — succeeds
3. Second user attempts to register as "bob" with alice@example.com
4. Assert: registration rejected with error indicating email is already in use

---

## Email Verification Flow

### Scenario: Successful email verification
1. User has registered and received a 6-digit code
2. User submits the correct code
3. Assert: user state changes to "verified_pending_approval"
4. Assert: user now appears in admin approval queue
5. Assert: user still cannot log in (receives "waiting for admin approval" message)

### Scenario: Wrong code is rejected
1. User has registered and received a code
2. User submits an incorrect code
3. Assert: verification fails with "invalid code" error
4. Assert: user remains in "pending_verification" state
5. Assert: attempt count is incremented

### Scenario: Code expires after 15 minutes
1. User registers and receives a code
2. Wait 15 minutes (or simulate time passage)
3. User submits the correct code
4. Assert: verification fails with "code expired" error
5. Assert: user is prompted to request a new code

### Scenario: 5 failed attempts invalidates the code
1. User registers and receives a code
2. User submits wrong code 5 times
3. Assert: after 5th failure, code is invalidated
4. Assert: even the correct code no longer works
5. Assert: user is prompted to request a new code

### Scenario: Resend code works and invalidates previous code
1. User registers and receives Code A
2. User requests a resend — receives Code B
3. User submits Code A
4. Assert: verification fails (Code A is invalidated)
5. User submits Code B
6. Assert: verification succeeds

### Scenario: Resend is rate-limited to 3 per hour
1. User registers and receives a code
2. User requests resend — succeeds (resend 1)
3. User requests resend — succeeds (resend 2)
4. User requests resend — succeeds (resend 3)
5. User requests resend again
6. Assert: resend rejected with rate limit error
7. Assert: most recent code is still valid

### Scenario: Verification codes are not stored in plain text
1. User registers and receives a code
2. Query the database for the verification code record
3. Assert: the stored value does NOT match the plain text code
4. Assert: the stored value is a hash

---

## Login

### Scenario: Login with name after full approval
1. User completes registration, verification, and admin approval
2. User logs in with name: "alice" and password: "Str0ngP@ss"
3. Assert: login succeeds, user has full access

### Scenario: Login with email after full approval (case-insensitive)
1. User completes registration with email "Alice@Example.com", verification, and admin approval
2. User logs in with email: "alice@example.com" and correct password
3. Assert: login succeeds
4. User logs in with email: "ALICE@EXAMPLE.COM" and correct password
5. Assert: login succeeds

### Scenario: Login blocked before email verification
1. User has registered but NOT verified email
2. User attempts to log in with correct credentials
3. Assert: login fails with message directing user to verify email
4. Assert: no session or token is created

### Scenario: Login blocked after verification but before admin approval
1. User has registered and verified email but admin has NOT approved
2. User attempts to log in with correct credentials
3. Assert: login fails with message indicating pending admin approval
4. Assert: no session or token is created

---

## Admin Controls

### Scenario: Admin can toggle email verification on
1. Admin navigates to settings
2. Admin enables "Require email verification"
3. Assert: setting is persisted
4. Assert: new registrations now require name, email, and password

### Scenario: Admin can toggle email verification off
1. Admin has email verification enabled
2. Admin disables it
3. Assert: setting is persisted
4. Assert: new registrations revert to original behavior (password optional, no email required)

### Scenario: Existing approved users are not affected when verification is enabled
1. User "olduser" was registered and approved BEFORE verification was enabled
2. Admin enables email verification
3. Assert: "olduser" can still log in normally
4. Assert: "olduser" is NOT prompted to verify email
5. Assert: "olduser" retains full access

### Scenario: Admin approval queue shows verification status and email
1. Admin enables email verification
2. User A registers with name "alice", email "alice@example.com" but has NOT verified
3. User B registers with name "bob", email "bob@example.com" and has verified
4. Admin views approval queue
5. Assert: User A is NOT in the queue (not yet verified)
6. Assert: User B IS in the queue, shown as email-verified
7. Assert: User B's email "bob@example.com" is visible to the admin in the queue

### Scenario: Admin approves a verified user
1. User registers and verifies email
2. Admin sees user in approval queue
3. Admin approves the user
4. Assert: user state changes to "approved"
5. Assert: user can now log in

### Scenario: Admin rejects a verified user
1. User registers and verifies email
2. Admin sees user in approval queue
3. Admin rejects the user
4. Assert: user state changes to "rejected"
5. Assert: user cannot log in

---

## Email Provider

### Scenario: Postmark sends verification email successfully
1. Admin configures Postmark with valid API key
2. Admin enables email verification
3. User registers
4. Assert: Postmark API was called with correct recipient, subject, and body containing a 6-digit code
5. Assert: email contains both HTML and plain text versions
6. Assert: email subject includes the app/channel name

### Scenario: Email provider failure is handled gracefully
1. Admin configures Postmark with an INVALID API key (or Postmark is down)
2. Admin enables email verification
3. User registers
4. Assert: registration still succeeds (user is created in pending_verification state)
5. Assert: user sees a message like "verification email could not be sent, please try again"
6. Assert: user can request a resend
7. Assert: no error details or stack traces are exposed to the user

### Scenario: Missing email provider config prevents verification from being enabled
1. Admin has NOT configured any email provider
2. Admin attempts to enable email verification
3. Assert: setting is rejected with clear error telling admin to configure an email provider first

### Scenario: Email provider is swappable
1. Admin configures email provider as "postmark" with Postmark API key
2. User registers — verification email is sent via Postmark
3. Admin switches email provider to a different configured provider
4. New user registers — verification email is sent via the new provider
5. Assert: both users can verify successfully regardless of which provider sent their code

### Scenario: Provider API keys are stored encrypted
1. Admin configures Postmark API key via settings
2. Query the database for the email provider config
3. Assert: the API key is NOT stored in plain text

---

## Edge Cases

### Scenario: Mid-verification users auto-advance when verification is disabled
1. Admin enables email verification
2. User "charlie" registers and receives a verification code but has NOT verified yet
3. Admin disables email verification
4. Assert: "charlie" is automatically moved to "pending_approval" state
5. Assert: "charlie" now appears in the admin approval queue
6. Assert: "charlie" does NOT need to complete email verification
7. Assert: admin can approve or reject "charlie" normally

### Scenario: Multiple mid-verification users all advance when verification is disabled
1. Admin enables email verification
2. Users "alice", "bob", and "charlie" all register but none have verified
3. Admin disables email verification
4. Assert: all three users move to "pending_approval" state
5. Assert: all three appear in the admin approval queue

### Scenario: Verified-but-not-approved users persist indefinitely
1. Admin enables email verification
2. User registers and verifies their email
3. Admin does NOT approve or reject the user
4. Assert: user remains in "verified_pending_approval" state indefinitely
5. Assert: user still appears in the admin approval queue after any amount of time
6. Assert: user's registration is never automatically expired or deleted

### Scenario: Registration when verification is disabled still works as before
1. Admin has NOT enabled email verification (default state)
2. User registers with just a name (no email, no password)
3. Assert: registration succeeds as it does today
4. Assert: no verification email is sent
5. Assert: user goes directly to admin approval queue

### Scenario: User tries to verify with no pending code
1. User has already verified their email
2. User attempts to submit a verification code again
3. Assert: request is rejected, user is told they are already verified

### Scenario: Rapid registration attempts from same email
1. User registers with alice@example.com — first registration succeeds
2. Immediately, same email attempts to register again
3. Assert: second attempt is rejected (email already in use)
4. Assert: first registration and its verification code are unaffected

### Scenario: Code contains exactly 6 numeric digits
1. User registers and triggers verification
2. Inspect the code sent via email
3. Assert: code matches pattern /^\d{6}$/ (exactly 6 digits, no letters, no spaces)
