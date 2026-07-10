.PHONY: test build up down logs version-check release-bundle lint clean

test:
	cd backend && go test ./...
	cd web && npm test -- --run --pool=threads --maxWorkers=2

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

version-check:
	node scripts/check-version-sync.mjs

release-bundle: version-check
	node scripts/build-release-bundle.mjs
