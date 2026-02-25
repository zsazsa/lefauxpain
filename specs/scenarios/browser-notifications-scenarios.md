# Scenarios: Browser Notifications

These scenarios validate the browser notifications feature. They are the
contract. Code must satisfy these — scenarios must not be modified to
accommodate code.

---

## Permission Flow

### Scenario: Enable browser notifications when permission is "default"
1. User opens Settings panel
2. User sees "Notifications" section with toggle OFF
3. User clicks the toggle
4. Assert: browser's `Notification.requestPermission()` is called
5. User grants permission in the browser prompt
6. Assert: `browserNotifications` setting is saved as `true` in localStorage
7. Assert: toggle shows ON state

### Scenario: Enable browser notifications when permission is already "granted"
1. Browser notification permission is already "granted" (from a previous session)
2. User opens Settings panel
3. User clicks the toggle ON
4. Assert: no browser permission prompt appears
5. Assert: `browserNotifications` setting is saved as `true` in localStorage
6. Assert: toggle shows ON state

### Scenario: Enable browser notifications when permission is "denied"
1. Browser notification permission is "denied" (user previously blocked)
2. User opens Settings panel
3. Assert: toggle is disabled
4. Assert: status text reads "Blocked by browser — check site permissions"
5. Assert: `browserNotifications` remains `false`

### Scenario: Browser does not support Notification API
1. `window.Notification` is undefined (e.g., certain WebViews)
2. User opens Settings panel
3. Assert: toggle is disabled
4. Assert: status text reads "Not supported in this browser"
5. Assert: `browserNotifications` remains `false`

### Scenario: User denies permission when prompted
1. User opens Settings panel
2. User clicks the toggle
3. Browser permission prompt appears
4. User denies permission
5. Assert: toggle remains OFF
6. Assert: `browserNotifications` remains `false`
7. Assert: no error is thrown

---

## Notification Delivery

### Scenario: Mention notification fires when tab is not focused
1. User A has `browserNotifications` enabled and permission is "granted"
2. User A's tab is not focused (minimized, or another tab is active)
3. User B sends a message mentioning User A with `@UserA`
4. Server sends `notification_create` with type `"mention"` to User A
5. Assert: a browser `Notification` is created
6. Assert: notification title is `@UserB in #channel-name`
7. Assert: notification body contains the message content preview

### Scenario: Mention notification does NOT fire when tab is focused
1. User A has `browserNotifications` enabled and permission is "granted"
2. User A's tab IS focused (active and visible)
3. User B sends a message mentioning User A with `@UserA`
4. Server sends `notification_create` with type `"mention"` to User A
5. Assert: NO browser `Notification` is created
6. Assert: in-app notification bell still updates (unread count increments)

### Scenario: Mention notification does NOT fire when setting is disabled
1. User A has `browserNotifications` set to `false` (default)
2. Browser notification permission is "granted"
3. User A's tab is not focused
4. User B sends a message mentioning User A
5. Assert: NO browser `Notification` is created
6. Assert: in-app notification bell still updates normally

### Scenario: Non-mention notification types do not trigger browser notification
1. User A has `browserNotifications` enabled and permission is "granted"
2. User A's tab is not focused
3. Server sends `notification_create` with type `"pending_user"` to User A
4. Assert: NO browser `Notification` is created
5. Assert: in-app notification is added normally

### Scenario: Clicking browser notification focuses the app tab
1. User A receives a browser notification for a mention
2. User A clicks the notification
3. Assert: `window.focus()` is called to bring the app tab to the foreground
4. Assert: the notification is closed

### Scenario: Browser notification auto-closes after 5 seconds
1. User A receives a browser notification for a mention
2. User A does NOT interact with the notification
3. Assert: after 5 seconds, `notification.close()` is called
4. Assert: notification disappears

---

## Notification Format

### Scenario: Notification displays correct title and body
1. User "Alice" sends a message in channel "general" mentioning User "Bob"
2. Message content preview is "Hey Bob, check this out"
3. Bob's tab is not focused, `browserNotifications` is enabled
4. Assert: notification title is `@Alice in #general`
5. Assert: notification body is `Hey Bob, check this out`

### Scenario: Rapid mentions are deduplicated via tag
1. User A's tab is not focused, `browserNotifications` is enabled
2. User B sends two messages in quick succession, both mentioning User A
3. Both `notification_create` events arrive
4. Assert: the `tag` field on each `Notification` is set to `mention-{notification_id}`
5. Assert: browser deduplication behavior is determined by the unique tag per notification

---

## Settings Persistence

### Scenario: Default setting is OFF
1. User opens the app for the first time (no localStorage data)
2. Assert: `browserNotifications` is `false`
3. Assert: no browser notifications are shown for any mentions

### Scenario: Setting persists across page reloads
1. User enables `browserNotifications` in Settings
2. User reloads the page
3. Assert: `browserNotifications` is still `true` (loaded from localStorage)
4. Assert: toggle in Settings shows ON state

### Scenario: Toggling OFF stops browser notifications
1. User has `browserNotifications` enabled
2. User opens Settings and toggles it OFF
3. Assert: `browserNotifications` is saved as `false` in localStorage
4. User is mentioned while tab is not focused
5. Assert: NO browser `Notification` is created
6. Assert: in-app notification bell still updates

---

## In-App Notifications Unaffected

### Scenario: In-app bell always works regardless of browser notification setting
1. User has `browserNotifications` set to `false`
2. User is mentioned in a message
3. Assert: `notification_create` WS event is received
4. Assert: notification appears in the in-app bell dropdown
5. Assert: unread badge count increments on the sidebar bell icon

### Scenario: In-app bell works even when browser permission is denied
1. Browser notification permission is "denied"
2. User is mentioned in a message
3. Assert: in-app notification bell updates normally
4. Assert: unread badge count increments
5. Assert: no errors are thrown due to denied browser permission
