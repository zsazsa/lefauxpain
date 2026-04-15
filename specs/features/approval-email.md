# Feature: Approval Notification Email

## Intent

When an admin approves a pending user, the user has no way to know — they must manually retry logging in. This feature sends the user an email when their account is approved, so they know to come back and log in.

This is a small addition to the existing email infrastructure. No new UI, no new API endpoints, no database changes.

## Current Behavior

1. User registers → enters "pending approval" state
2. Admin approves the user via `POST /api/v1/admin/users/{id}/approve`
3. Server sets `approved = TRUE`, broadcasts `user_approved` on WebSocket to connected clients
4. **The approved user receives no notification.** They must manually retry login to discover they've been approved.

## New Behavior

After the admin approves a user:

1. Server sets `approved = TRUE` (unchanged)
2. Server broadcasts `user_approved` on WebSocket (unchanged)
3. **If the approved user has an email address on file**, the server sends them an approval notification email
4. Email send failure is **non-fatal** — log the error and continue. The approval still succeeds.

### Approval Email Content

- **Subject:** `"{AppName} — Your account has been approved"`
- **Body:** Tells the user their account has been approved and they can now log in
- **Format:** HTML and plain text versions, following the existing template style
- **No code, no link, no token** — this is purely informational

### When the Email Is NOT Sent

- The user has no email address on file (registered without email, or email verification was disabled)
- No email provider is configured — log a warning, do not error

## Changes Required

### 1. Email Templates (`server/email/templates.go`)

Add two functions following the existing pattern:

- `ApprovalEmailHTML(appName string) string`
- `ApprovalEmailText(appName string) string`

### 2. Provider Interface (`server/email/provider.go`)

Add to the `Provider` interface:

```go
SendApprovalEmail(to, appName string) error
```

Add to `EmailService`:

```go
func (s *EmailService) SendApprovalEmail(to, appName string) error
```

This method gets the provider and delegates — same pattern as `SendTestEmail`.

### 3. Provider Implementations

Implement `SendApprovalEmail` on all three providers:

- **PostmarkProvider** (`server/email/postmark.go`) — same HTTP POST pattern as other sends
- **SMTPProvider** (`server/email/smtp.go`) — delegates to `p.sendEmail(...)` like other sends
- **TestProvider** (`server/email/test_provider.go`) — returns `nil`

### 4. Admin Handler (`server/api/admin.go`)

In `ApproveUser()`, after the existing `DB.ApproveUser(targetID)` call and after fetching `approvedUser`:

```go
if approvedUser != nil && approvedUser.Email != nil && *approvedUser.Email != "" {
    if err := h.EmailService.SendApprovalEmail(*approvedUser.Email, "Le Faux Pain"); err != nil {
        log.Printf("send approval email to %s: %v", *approvedUser.Email, err)
    }
}
```

## Constraints

- Must not change the approval API response or behavior
- Must not block approval on email delivery failure
- Must follow existing email patterns exactly (template style, error handling, provider abstraction)
- No database changes
- No client-side changes
- No new API endpoints
- No new configuration settings

## Out of Scope

- Push notifications or in-app notifications for the approved user (they have no active session)
- Rejection notification emails
- Customizable email templates via admin UI
- Email delivery tracking or retry logic
