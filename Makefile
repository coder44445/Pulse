# Pulse — Development Makefile
# Usage: make <target>

.PHONY: up down dashboard quiz build check commit help

## Start the Pulse engine (API + reverse proxy)
up:
	cargo run -- up

## Stop all running apps via the API
down:
	@echo "Stopping all apps..."
	@curl -s -X POST http://localhost:7777/applications/quiz/stop || true
	@curl -s -X POST http://localhost:7777/applications/quiz-ui/stop || true
	@curl -s -X POST http://localhost:7777/applications/identity/stop || true
	@curl -s -X POST http://localhost:7777/applications/persona/stop || true
	@echo "Done."

## Start the Dashboard frontend (port 4173)
dashboard:
	cd pulse-dashboard && npm run dev

## Start the Quiz frontend (port 3000) — for development with hot-reload
quiz:
	cd ../open-quiz-web && npm run dev

## Build the Pulse engine binary
build:
	cargo build --release

## Check that everything compiles (no warnings as errors)
check:
	cargo check && cd pulse-dashboard && npm run build

## Initial git commit or stage all changes
commit:
	git add -A && git commit -m "chore: stabilization pass"

## Show this help message
help:
	@echo ""
	@echo "  make up        — Start Pulse engine (proxy + API)"
	@echo "  make down      — Stop all managed apps"
	@echo "  make dashboard — Start the Dashboard frontend"
	@echo "  make quiz      — Start the Quiz frontend (hot-reload)"
	@echo "  make build     — Build release binary"
	@echo "  make check     — Compile-check everything"
	@echo ""
