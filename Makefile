.PHONY: help up down migrate seed seed-small test perf demo lint frontend-dev backend-dev

help:
	@echo "Brightloop Subscription Management System"
	@echo "make up          - Start all services with Docker Compose"
	@echo "make down        - Stop all Docker Compose services"
	@echo "make migrate     - Run database migrations"
	@echo "make seed        - Populate full database seed (deterministic)"
	@echo "make seed-small  - Populate small demo seed"
	@echo "make test        - Run backend test suite"
	@echo "make perf        - Run performance benchmark suite (50 runs per endpoint)"
	@echo "make demo        - Reset DB, migrate, seed-small, and start services"
	@echo "make lint        - Run ruff check and type check"

up:
	docker compose up --build -d

down:
	docker compose down

migrate:
	cd backend && python -m alembic upgrade head

seed:
	cd backend && python -m app.seed

seed-small:
	cd backend && python -m app.seed --small

test:
	cd backend && pytest -v --cov=app
	python scripts/verify_api_routes.py

perf:
	cd backend && python -m app.perf

demo:
	docker compose down -v || true
	docker compose up -d db mailpit
	@echo "Waiting for database..."
	sleep 5
	cd backend && python -m alembic upgrade head
	cd backend && python -m app.seed --small
	docker compose up -d api worker web

lint:
	cd backend && ruff check . && mypy app
