# Scenarios: Admin Email Settings Tab

These scenarios validate the admin email settings UI. They are the
contract. Code must satisfy these — scenarios must not be modified to
accommodate code.

---

## Tab Navigation

### Scenario: Email tab appears in admin interface
1. Admin logs in and navigates to the admin interface
2. Assert: an "Email" tab (or equivalent navigation item) is visible alongside existing tabs
3. Admin clicks the Email tab
4. Assert: the email settings panel loads

### Scenario: Email tab loads current settings on open
1. Admin has previously configured Postmark as their email provider
2. Admin opens the Email tab
3. Assert: provider selector shows "Postmark"
4. Assert: from_email field is populated with the saved value
5. Assert: from_name field is populated with the saved value
6. Assert: API key field shows a masked value (e.g. "••••••7f3a"), NOT the plain text key
7. Assert: verification toggle reflects the current state (on or off)

### Scenario: Email tab shows empty form when nothing is configured
1. Admin has never configured an email provider
2. Admin opens the Email tab
3. Assert: provider selector defaults to Postmark
4. Assert: all fields are empty
5. Assert: verification toggle is off
6. Assert: test email button is disabled

---

## Provider Selection

### Scenario: Selecting Postmark shows Postmark fields
1. Admin opens Email tab
2. Admin selects "Postmark" as the provider
3. Assert: form shows fields for API Key, From Email, From Name
4. Assert: form does NOT show SMTP-specific fields (host, port, username, password, encryption)

### Scenario: Selecting SMTP shows SMTP fields
1. Admin opens Email tab
2. Admin selects "SMTP" as the provider
3. Assert: form shows fields for Host, Port, Username, Password, Encryption, From Email, From Name
4. Assert: form does NOT show Postmark-specific fields (API Key)

### Scenario: Switching provider type clears the form
1. Admin selects Postmark and fills in API key, from email, from name
2. Admin switches to SMTP
3. Assert: Postmark fields are cleared
4. Assert: SMTP fields are empty and ready to fill
5. Admin switches back to Postmark
6. Assert: Postmark fields are empty (previously entered values are NOT restored)

### Scenario: SMTP encryption defaults to STARTTLS
1. Admin selects SMTP as the provider
2. Assert: encryption dropdown defaults to "STARTTLS"
3. Assert: port field suggests common defaults (587 for STARTTLS)

---

## Saving Configuration — Postmark

### Scenario: Save Postmark configuration successfully
1. Admin selects Postmark
2. Admin enters API key: "valid-postmark-token"
3. Admin enters from email: "noreply@lefauxpain.com"
4. Admin enters from name: "Le Faux Pain"
5. Admin clicks Save
6. Assert: POST /api/v1/admin/settings is called with correct payload
7. Assert: success message is displayed (terminal-style)
8. Assert: API key field now shows masked value, not the plain text entered

### Scenario: Save button shows loading state while saving
1. Admin fills in valid Postmark configuration
2. Admin clicks Save
3. Assert: save button is disabled during the request
4. Assert: a terminal-style loading indicator is visible (e.g. "SAVING..." or blinking cursor)
5. Assert: on completion, button re-enables and result message appears

### Scenario: Save failure shows API error message
1. Admin fills in configuration
2. API returns an error (e.g. 422 validation error)
3. Assert: the specific error message from the API is shown to the admin
4. Assert: form fields are preserved (not cleared) so admin can correct and retry

---

## Saving Configuration — SMTP

### Scenario: Save SMTP configuration successfully
1. Admin selects SMTP
2. Admin enters host: "smtp.postmarkapp.com"
3. Admin enters port: 587
4. Admin enters username: "postmark-token"
5. Admin enters password: "postmark-token"
6. Admin selects encryption: STARTTLS
7. Admin enters from email: "noreply@lefauxpain.com"
8. Admin enters from name: "Le Faux Pain"
9. Admin clicks Save
10. Assert: POST /api/v1/admin/settings is called with provider "smtp" and all SMTP fields
11. Assert: success message displayed
12. Assert: password field shows masked value after save

### Scenario: SMTP port must be a valid number
1. Admin selects SMTP
2. Admin enters port: "abc"
3. Admin clicks Save
4. Assert: client-side validation error on port field before request is sent
5. Assert: no API call is made

---

## Form Validation

### Scenario: Required fields are validated before submit — Postmark
1. Admin selects Postmark
2. Admin leaves API key empty, enters from email and from name
3. Admin clicks Save
4. Assert: validation error shown on API key field
5. Assert: no API call is made

### Scenario: Required fields are validated before submit — SMTP
1. Admin selects SMTP
2. Admin fills in host and port but leaves username empty
3. Admin clicks Save
4. Assert: validation error shown on username field
5. Assert: no API call is made

### Scenario: From email must be valid email format
1. Admin enters from email: "not-an-email"
2. Admin clicks Save
3. Assert: validation error on from email field (e.g. "Must be a valid email address")
4. Assert: no API call is made

### Scenario: All required SMTP fields must be present
1. Admin selects SMTP
2. For each required field (host, port, username, password, encryption, from_email, from_name):
   - Leave that field empty, fill all others
   - Click Save
   - Assert: validation error on the empty field
   - Assert: no API call is made

---

## Credential Masking

### Scenario: API key is masked after save
1. Admin saves a Postmark configuration with API key "sk-abc123def456"
2. Admin navigates away and returns to the Email tab
3. Assert: API key field shows a masked value (e.g. "••••••f456")
4. Assert: the full key is NOT present in the page source, DOM, or any network response

### Scenario: SMTP password is masked after save
1. Admin saves an SMTP configuration with password "mysecretpassword"
2. Admin navigates away and returns to the Email tab
3. Assert: password field shows a masked placeholder
4. Assert: the full password is NOT present in the page source, DOM, or any network response

### Scenario: Admin can update API key by entering a new one
1. Admin has a saved Postmark config with masked API key
2. Admin clicks into the API key field (or clicks a "Change" button)
3. Admin enters a new API key
4. Admin clicks Save
5. Assert: new key is saved via the API
6. Assert: field returns to masked state with new masked value

### Scenario: Saving without changing masked credential does not wipe it
1. Admin has a saved Postmark config
2. Admin changes only the from_name field
3. Admin clicks Save (API key field still shows masked value)
4. Assert: the API key is NOT overwritten or wiped
5. Assert: only the from_name is updated

---

## Email Verification Toggle

### Scenario: Enable verification when provider is configured
1. Admin has a saved and working email provider configuration
2. Admin toggles "Require email verification" to ON
3. Assert: toggle saves successfully
4. Assert: email_verification_enabled is set to true via the API

### Scenario: Cannot enable verification without a configured provider
1. Admin has NOT configured any email provider (no saved config)
2. Admin attempts to toggle verification ON
3. Assert: an error is displayed (e.g. "Configure an email provider before enabling verification")
4. Assert: toggle remains OFF
5. Assert: no API call to enable verification is made

### Scenario: Disable verification preserves provider config
1. Admin has Postmark configured and verification enabled
2. Admin toggles verification OFF
3. Assert: verification is disabled
4. Admin opens the Email tab again
5. Assert: Postmark configuration is still present (from email, from name, masked key)
6. Assert: admin does not need to re-enter credentials to re-enable verification later

### Scenario: Toggling verification off saves immediately
1. Admin has verification enabled
2. Admin toggles it OFF
3. Assert: POST /api/v1/admin/settings is called with {"email_verification_enabled": false}
4. Assert: confirmation shown to admin

---

## Test Email

### Scenario: Successful test email
1. Admin has a saved and working email provider configuration
2. Admin clicks "Send Test Email" (or "> TEST CONNECTION")
3. Assert: POST /api/v1/admin/settings/email/test is called
4. Assert: loading state shown (e.g. "CONNECTING..." → "SENDING...")
5. Assert: on success, message reads "Test email sent to [admin's email] — check your inbox"
6. Assert: test email actually arrives at the admin's email address

### Scenario: Test email shows progress in terminal style
1. Admin clicks test email button
2. Assert: button is disabled during the test
3. Assert: status updates appear in terminal style (e.g. sequential lines like "CONNECTING..." then "SENDING..." then "DELIVERED" or "FAILED")

### Scenario: Test email failure shows specific error
1. Admin has saved an email provider with invalid credentials
2. Admin clicks "Send Test Email"
3. Assert: error message is displayed with a specific reason (e.g. "Authentication failed" or "Connection refused on port 587")
4. Assert: no generic "something went wrong" — the actual error from the provider is surfaced

### Scenario: Test button is disabled when no provider is saved
1. Admin opens Email tab with no provider configured
2. Assert: test email button is disabled or hidden
3. Assert: it is clear to the admin why (e.g. "Save a provider configuration first")

### Scenario: Test button is disabled while save is in progress
1. Admin clicks Save
2. Assert: test email button is disabled until save completes
3. After save succeeds:
4. Assert: test email button becomes enabled

---

## API Endpoints

### Scenario: GET settings returns current config without secrets
1. Admin has saved Postmark config with API key "sk-abc123def456"
2. Frontend calls GET /api/v1/admin/settings/email
3. Assert: response includes provider type, from_email, from_name, email_verification_enabled
4. Assert: response does NOT include the plain text API key
5. Assert: response includes a masked version or an "is_configured" boolean

### Scenario: GET settings returns empty state when nothing configured
1. No email provider has been configured
2. Frontend calls GET /api/v1/admin/settings/email
3. Assert: response indicates no provider configured
4. Assert: email_verification_enabled is false

### Scenario: Test email endpoint requires authentication
1. Unauthenticated request to POST /api/v1/admin/settings/email/test
2. Assert: 401 Unauthorized
3. Non-admin authenticated request to the same endpoint
4. Assert: 403 Forbidden

### Scenario: Test email uses the authenticated admin's email address
1. Admin with email "admin@lefauxpain.com" sends test email
2. Assert: test email is delivered to "admin@lefauxpain.com"
3. Assert: no "recipient" field was needed in the request — server determines it from the auth token

---

## Edge Cases

### Scenario: Admin can switch from Postmark to SMTP and save
1. Admin has Postmark configured and working
2. Admin switches provider to SMTP
3. Admin fills in all SMTP fields
4. Admin clicks Save
5. Assert: configuration is saved as SMTP
6. Assert: Postmark config is replaced, not merged
7. Assert: test email works with the new SMTP config

### Scenario: Admin can switch from SMTP back to Postmark
1. Admin has SMTP configured
2. Admin switches to Postmark
3. Admin enters Postmark API key, from email, from name
4. Admin clicks Save
5. Assert: configuration is saved as Postmark
6. Assert: SMTP fields are not lingering in the saved config

### Scenario: Network error during save is handled gracefully
1. Admin fills in valid config and clicks Save
2. Network request fails (timeout, connection error)
3. Assert: error message shown (e.g. "CONNECTION FAILED — could not reach server")
4. Assert: form fields are preserved
5. Assert: admin can retry

### Scenario: Concurrent admin edits — last save wins
1. Admin A opens the Email tab and sees current config
2. Admin B opens the Email tab and sees same config
3. Admin B changes the from_name and saves
4. Admin A changes the from_email and saves
5. Assert: Admin A's save overwrites Admin B's from_name change (last write wins)
6. Assert: no crash or data corruption

### Scenario: Tab does not make API calls for non-admin users
1. Non-admin user somehow navigates to the admin interface URL
2. Assert: Email tab is not accessible (either hidden or returns 403)
3. Assert: no settings data is exposed
