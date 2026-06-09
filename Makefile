.PHONY: test build up down logs bump-version lint clean

test:
	cd backend && go test ./...
	cd web && npm test -- --run

build:
	docker compose build --pull

up:
	docker compose up --build --pull

down:
	docker compose down

logs:
	docker compose logs -f

lint:
	cd backend && golangci-lint run ./...
	cd web && npx eslint . && npx prettier --check .

clean:
	cd backend && go clean
	rm -rf web/dist web/node_modules

bump-version:
	@OLD_VERSION=$$(cat VERSION) && \
	echo "Bumping version from $$OLD_VERSION to $(VERSION)..." && \
	find . -type f \( -name "*.md" -o -name "*.yml" -o -name "*.yaml" -o -name "Dockerfile" -o -name "package.json" -o -name "package-lock.json" -o -name "index.html" -o -name ".env.example" -o -name "config.go" \) -exec sed -i "s/$$(echo $$OLD_VERSION | sed 's/\./\\./g')/$(VERSION)/g" {} + && \
	echo "$(VERSION)" > VERSION && \
	echo "Version bumped to $(VERSION). Run 'make test' to verify."
