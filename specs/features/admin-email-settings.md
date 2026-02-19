# Feature: Admin Email Settings Tab

## Intent

The backend for email provider configuration and verification toggling already exists (see API below). There is no frontend for it — admins currently have to use curl. This feature adds an "Email" tab to the existing admin interface that lets admins configure their email provider, toggle email verification, and test the connection — all through the UI they already know.

## Existing API (Already Built — Do Not Modify)

**Configure email provider + enable verification:**
```
POST /api/v1/admin/settings
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "email_verification_enabled": true,
  "email_provider_config": {
    "provider": "postmark",
    "api_key": "<postmark-server-token>",
    "from_email": "noreply@yourdomain.com",
    "from_name": "Le Faux Pain"
  }
}
```

**Disable verification:**
```
POST /api/v1/admin/settings
Authorization: Bearer <admin-token>
Content-Type: application/json

{"email_verification_enabled": false}
```

The frontend is a UI layer over these existing endpoints. If additional API endpoints are needed (e.g. for test email, fetching current settings), they should be added following the same patterns.

### New API Endpoints Needed

**Get current email settings** (if not already available):
```
GET /api/v1/admin/settings/email
```
Returns current email_verification_enabled status, provider type, from_email, from_name. Must NOT return the API key or SMTP password in the response — only a masked version (e.g. "sk-****...7f3a") or a boolean "is_configured" flag.

**Send test email:**
```
POST /api/v1/admin/settings/email/test
```
Sends a test email to the currently authenticated admin's email address using the saved provider configuration. Returns success/failure with a human-readable error message on failure.

## New Behavior

### Email Tab in Admin Interface

A new "Email" tab appears in the existing admin interface navigation, alongside whatever tabs already exist. The tab contains:

#### 1. Email Verification Toggle

A clearly labeled toggle or switch:
- Label: "Require email verification for new registrations"
- Shows current state (on/off)
- When toggled on: the provider configuration section must be filled out and saved first — if no provider is configured, show an inline error and prevent enabling
- When toggled off: saves immediately, provider config is preserved (not wiped)

#### 2. Provider Selection

A selector to choose the email provider type:
- **Postmark** — requires: API key (server token), from email, from name
- **SMTP** — requires: host, port, username, password, from email, from name, encryption (none / TLS / STARTTLS)

When the admin selects a provider, the form below updates to show the relevant fields.

#### 3. Provider Configuration Form

**Postmark fields:**
| Field | Required | Notes |
|---|---|---|
| API Key (Server Token) | Yes | Password-type input, masked. If previously saved, show masked value (e.g. "sk-••••••7f3a") |
| From Email | Yes | Must be a valid email format |
| From Name | Yes | Display name for outgoing emails (e.g. "Le Faux Pain") |

**SMTP fields:**
| Field | Required | Notes |
|---|---|---|
| Host | Yes | e.g. "smtp.postmarkapp.com" or "smtp.gmail.com" |
| Port | Yes | Common defaults: 587 (STARTTLS), 465 (TLS), 25 (none). Offer these as suggestions |
| Username | Yes | Often the full email address |
| Password | Yes | Password-type input, masked |
| Encryption | Yes | Dropdown: None, TLS, STARTTLS. Default to STARTTLS |
| From Email | Yes | Must be a valid email format |
| From Name | Yes | Display name for outgoing emails |

#### 4. Save Button

- Saves the provider configuration via the existing POST /api/v1/admin/settings endpoint
- On success: show a confirmation message (terminal-style, e.g. "SETTINGS SAVED" or "> configuration updated")
- On failure: show the error message from the API
- While saving: disable the button and show a loading state consistent with the terminal aesthetic (e.g. blinking cursor, "SAVING...")

#### 5. Test Email Button

- Label: "Send Test Email" or "> TEST CONNECTION"
- Only enabled when a provider is configured and saved
- Sends a POST to /api/v1/admin/settings/email/test
- On success: show "Test email sent to [admin's email] — check your inbox"
- On failure: show the specific error (e.g. "Authentication failed", "Connection refused on port 587")
- While sending: show a terminal-style loading state (e.g. "CONNECTING..." → "SENDING..." → "DELIVERED" or "FAILED: [reason]")

#### 6. Settings Retrieval on Tab Load

- When the Email tab is opened, fetch current settings from GET /api/v1/admin/settings/email
- Populate the form with existing values
- API keys and passwords are NOT returned from the API in plain text — show a masked placeholder and a "Change" button to enter a new value
- If no provider is configured: show empty form with provider selector defaulting to Postmark

## SMTP Provider Specifics

The SMTP integration sends emails via standard SMTP protocol. This supports:
- Postmark's SMTP interface (smtp.postmarkapp.com, port 587, STARTTLS)
- Gmail SMTP (smtp.gmail.com, port 587, STARTTLS)
- AWS SES SMTP
- Any standard SMTP relay

The SMTP provider config payload to the API:
```json
{
  "email_verification_enabled": true,
  "email_provider_config": {
    "provider": "smtp",
    "host": "smtp.postmarkapp.com",
    "port": 587,
    "username": "postmark-server-token",
    "password": "postmark-server-token",
    "encryption": "starttls",
    "from_email": "noreply@yourdomain.com",
    "from_name": "Le Faux Pain"
  }
}
```

## Design Constraints

- **Must follow the existing admin interface design** — same colors, fonts, spacing, terminal aesthetic, component patterns
- No new design system or component library — use whatever the admin interface already uses
- Form inputs should match existing input styling in the admin interface
- Error and success messages should match existing patterns (terminal-style if that's what the app uses)
- The tab should be responsive enough to work on smaller screens but the primary use case is desktop

## Constraints

- Must not modify the existing POST /api/v1/admin/settings endpoint behavior
- Must add GET endpoint for retrieving current settings and POST endpoint for test email
- Must never display API keys or SMTP passwords in plain text after save — always masked
- Must validate form fields client-side before submitting (valid email format, required fields, port is a number)
- Must disable the verification toggle if no provider is configured
- Must disable the test button if no provider is saved
- When switching provider type (Postmark → SMTP or vice versa), previously entered fields should clear to avoid sending mismatched config

## Out of Scope

- Email template editing in the UI
- Email delivery logs or history
- Multiple provider configurations (only one active provider at a time)
- DNS/SPF/DKIM verification helpers
- Admin email address management (uses whatever email is on the admin's account)

## Resolved Decisions

1. **The API key / password is never returned from the API in plain text** — the GET endpoint returns a masked version or a boolean. The admin must re-enter the key to change it.
2. **Toggling verification off preserves the provider config** — the admin doesn't have to re-enter everything if they temporarily disable verification.
3. **Test email goes to the admin's own email** — no need for a "test recipient" field. The server uses the authenticated admin's email address.
