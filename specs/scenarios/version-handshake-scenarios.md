# Version Handshake Scenarios

Validation: `validation/version_test.go`

### Scenario V01: Health reports the build version
1. `GET /api/v1/health`
2. Assert: `version` is a non-empty string (validation builds stamp the git hash, so it is not `dev`)

### Scenario V02: ready carries the same version
1. Authenticate over WebSocket
2. Assert: `ready.server_version` equals the health `version`

### Scenario V03: Invalid token closes the socket with 1008
1. Open a WebSocket and send `authenticate` with a bogus token
2. Assert: the server closes the connection with status 1008 and a reason containing "token"

### Scenario V04: Pending account closes with 1008 and says so
1. Register a new user (not yet approved) and obtain no token; instead, log in is blocked — use the admin to create the situation: register, then attempt WebSocket auth with a freshly issued token before approval is impossible, so this scenario asserts the REST path instead
2. `POST /api/v1/auth/login` for an unapproved user
3. Assert: the response is not 200 and the body names approval

### Scenario V05: Deleted user is rejected on both transports
1. Register and approve a user, obtain a token
2. Admin deletes the user
3. `GET /api/v1/channels` with the token → 401
4. WebSocket `authenticate` with the token → closed with 1008
