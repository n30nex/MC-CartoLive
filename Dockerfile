# Base images are pinned to multi-platform manifest digests. Dependabot updates
# both the readable tag and the digest together.
FROM node:22-alpine@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS webbuild
WORKDIR /web
ARG VITE_OPENFREEMAP_STYLE_URL=
ARG VITE_OPENFREEMAP_TILEJSON_URL=https://tiles.openfreemap.org/planet
ARG VITE_TERRAIN_TILE_URL=https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
ARG VITE_TERRAIN_EXAGGERATION=1.25
ARG VITE_PMTILES_BASEMAP_URL=
ARG VITE_PMTILES_TERRAIN_URL=
ARG VITE_BUILD_NUMBER=
ARG GIT_SHA=dev
ARG BUILD_TIME=1970-01-01T00:00:00Z
ARG VITE_APP_BRAND_NAME=MC-CartoLive
ARG VITE_APP_BRAND_URL=https://github.com/n30nex/MC-CartoLive
ARG VITE_APP_BRAND_LOGO=
ARG VITE_APP_ASSET_PACK=world
ARG VITE_ENABLE_SERVICE_WORKER=false
ARG VITE_PUBLIC_WS_SUBSCRIPTIONS_ENABLED=false
ARG APP_VERSION=3.2.2
ENV VITE_OPENFREEMAP_STYLE_URL=$VITE_OPENFREEMAP_STYLE_URL
ENV VITE_OPENFREEMAP_TILEJSON_URL=$VITE_OPENFREEMAP_TILEJSON_URL
ENV VITE_TERRAIN_TILE_URL=$VITE_TERRAIN_TILE_URL
ENV VITE_TERRAIN_EXAGGERATION=$VITE_TERRAIN_EXAGGERATION
ENV VITE_PMTILES_BASEMAP_URL=$VITE_PMTILES_BASEMAP_URL
ENV VITE_PMTILES_TERRAIN_URL=$VITE_PMTILES_TERRAIN_URL
ENV VITE_BUILD_NUMBER=$VITE_BUILD_NUMBER
ENV VITE_GIT_SHA=$GIT_SHA
ENV VITE_BUILD_TIME=$BUILD_TIME
ENV VITE_APP_BRAND_NAME=$VITE_APP_BRAND_NAME
ENV VITE_APP_BRAND_URL=$VITE_APP_BRAND_URL
ENV VITE_APP_BRAND_LOGO=$VITE_APP_BRAND_LOGO
ENV VITE_APP_ASSET_PACK=$VITE_APP_ASSET_PACK
ENV VITE_ENABLE_SERVICE_WORKER=$VITE_ENABLE_SERVICE_WORKER
ENV VITE_PUBLIC_WS_SUBSCRIPTIONS_ENABLED=$VITE_PUBLIC_WS_SUBSCRIPTIONS_ENABLED
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# backend build
FROM golang:1.25.12-alpine@sha256:56961d79ea8129efddcc0b8643fd8a5416b4e6228cfd477e3fd61deb2672c587 AS gobuild
WORKDIR /src
ARG APP_VERSION=3.2.2
ARG GIT_SHA=dev
ARG BUILD_TIME=1970-01-01T00:00:00Z
RUN apk add --no-cache ca-certificates
COPY backend/go.mod backend/go.sum ./backend/
WORKDIR /src/backend
RUN go mod download
COPY backend/ ./
COPY --from=webbuild /web/dist ./internal/api/static
RUN build_flags="-s -w \
    -X meshcore-canada-live-map/backend/internal/app.BuildVersion=${APP_VERSION} \
    -X meshcore-canada-live-map/backend/internal/app.BuildGitSHA=${GIT_SHA} \
    -X meshcore-canada-live-map/backend/internal/app.BuildTime=${BUILD_TIME}" \
  && CGO_ENABLED=0 GOOS=linux go build -trimpath -buildvcs=false -ldflags="$build_flags" -o /out/meshcore-live ./cmd/app \
  && CGO_ENABLED=0 GOOS=linux go build -trimpath -buildvcs=false -ldflags="$build_flags" -o /out/mc-diagnose ./cmd/diagnose

# runtime
FROM alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce
ARG APP_VERSION=3.2.2
ARG GIT_SHA=dev
ARG BUILD_TIME=1970-01-01T00:00:00Z
LABEL org.opencontainers.image.title="MC-CartoLive" \
  org.opencontainers.image.description="Public-safe MeshCore MQTT map with continuous live RF traffic" \
  org.opencontainers.image.source="https://github.com/n30nex/MC-CartoLive" \
  org.opencontainers.image.url="https://github.com/n30nex/MC-CartoLive" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.version=$APP_VERSION \
  org.opencontainers.image.revision=$GIT_SHA \
  org.opencontainers.image.created=$BUILD_TIME
RUN apk add --no-cache ca-certificates tzdata
RUN adduser -D -h /app appuser
WORKDIR /app
COPY --from=gobuild /out/meshcore-live /app/meshcore-live
COPY --from=gobuild /out/mc-diagnose /app/mc-diagnose
RUN mkdir -p /app/data /app/examples/fixtures && chown -R appuser:appuser /app
COPY --chown=appuser:appuser examples/fixtures/ /app/examples/fixtures/
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["/app/meshcore-live"]
