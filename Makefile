.PHONY: test build up down logs bump-version

test:
	cd backend && go test ./...
	cd web && npm test -- --run

build:
	docker compose build

up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f

bump-version:
	@echo "Bumping version to $(VERSION)..."
	@find . -type f \( -name "*.md" -o -name "*.yml" -o -name "*.yaml" -o -name "Dockerfile" -o -name "package.json" -o -name "index.html" -o -name ".env.example" \) -exec sed -i 's/2\.7\.3/$(VERSION)/g' {} +
	@echo "$(VERSION)" > VERSION
	@echo "Version bumped to $(VERSION). Run 'make test' to verify."
