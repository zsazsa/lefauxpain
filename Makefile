.PHONY: validate lint test build-server

VALIDATION_PORT ?= 18080
GO ?= $(shell which go)

build-server:
	@cd server && $(GO) build -o voicechat .

validate: build-server
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
