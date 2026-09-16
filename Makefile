.PHONY: validate lint test build build-client build-server verify-scenarios update-scenario-checksums

VALIDATION_PORT ?= 18080
GO ?= $(shell which go)
# Build identifier shared by server and client so a stale tab can detect a deploy.
APP_VERSION ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
export APP_VERSION
GO_LDFLAGS ?= -X main.Version=$(APP_VERSION)

# The Go binary embeds server/static (gitignored), so the client must be
# built and copied in before the server compiles. Done automatically when
# the embedded index.html is missing.
build-client:
	@cd client && npm install --silent && npm run build --silent
	@mkdir -p server/static
	@rm -rf server/static/assets/* server/static/index.html
	@cp -r client/dist/* server/static/

server/static/index.html:
	@$(MAKE) build-client

build-server: server/static/index.html
	@cd server && $(GO) build -ldflags "$(GO_LDFLAGS)" -o voicechat .

# Static production binary (no glibc dependency) for deploying to a VPS.
build-release: server/static/index.html
	@cd server && CGO_ENABLED=0 $(GO) build -trimpath -ldflags "-s -w $(GO_LDFLAGS)" -o voicechat .

build: build-client build-server

# Scenario files are the contract; their checksums are committed so CI
# fails if one changes without the architect updating the manifest.
verify-scenarios:
	@cd specs/scenarios && sha256sum --check --strict CHECKSUMS.sha256

update-scenario-checksums:
	@cd specs/scenarios && ls *.md | LC_ALL=C sort | xargs sha256sum > CHECKSUMS.sha256
	@echo "Updated specs/scenarios/CHECKSUMS.sha256"

validate: verify-scenarios build-server
	@set -e; \
	TMPDIR=$$(mktemp -d); \
	trap 'kill $$PID 2>/dev/null; rm -rf $$TMPDIR' EXIT; \
	echo "=== Starting server (port $(VALIDATION_PORT), data: $$TMPDIR) ==="; \
	./server/voicechat --dev --port $(VALIDATION_PORT) --data-dir "$$TMPDIR" & \
	PID=$$!; \
	for i in 1 2 3 4 5 6 7 8 9 10; do \
		if curl -sf http://localhost:$(VALIDATION_PORT)/api/v1/health > /dev/null 2>&1; then \
			break; \
		fi; \
		if [ $$i -eq 10 ]; then \
			echo "Server failed to start"; \
			exit 1; \
		fi; \
		sleep 0.5; \
	done; \
	echo "=== Running scenario validation ==="; \
	cd validation && SERVER_URL=http://localhost:$(VALIDATION_PORT) $(GO) test -v -count=1 ./...

lint:
	@echo "=== TypeScript check ==="
	@cd client && npx tsc --noEmit

test: validate lint
	@echo "=== All checks passed ==="
