# frontend build
FROM node:22-alpine AS webbuild
WORKDIR /web
ARG VITE_OPENFREEMAP_STYLE_URL=
ARG VITE_OPENFREEMAP_TILEJSON_URL=https://tiles.openfreemap.org/planet
ARG VITE_TERRAIN_TILE_URL=https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
ARG VITE_TERRAIN_EXAGGERATION=1.25
ARG VITE_PMTILES_BASEMAP_URL=
ARG VITE_PMTILES_TERRAIN_URL=
ARG VITE_BUILD_NUMBER=
ARG VITE_GIT_SHA=
ARG VITE_BUILD_TIME=
ARG VITE_APP_BRAND_NAME=MC-CartoLive
ARG VITE_APP_BRAND_URL=https://github.com/n30nex/MC-CartoLive
ARG VITE_APP_BRAND_LOGO=
ARG VITE_OPENWEATHERMAP_API_KEY=
ARG VITE_ENABLE_SERVICE_WORKER=false
ARG VITE_PUBLIC_WS_SUBSCRIPTIONS_ENABLED=false
ARG APP_VERSION=2.9.5
ENV VITE_OPENFREEMAP_STYLE_URL=$VITE_OPENFREEMAP_STYLE_URL
ENV VITE_OPENFREEMAP_TILEJSON_URL=$VITE_OPENFREEMAP_TILEJSON_URL
ENV VITE_TERRAIN_TILE_URL=$VITE_TERRAIN_TILE_URL
ENV VITE_TERRAIN_EXAGGERATION=$VITE_TERRAIN_EXAGGERATION
ENV VITE_PMTILES_BASEMAP_URL=$VITE_PMTILES_BASEMAP_URL
ENV VITE_PMTILES_TERRAIN_URL=$VITE_PMTILES_TERRAIN_URL
ENV VITE_BUILD_NUMBER=$VITE_BUILD_NUMBER
ENV VITE_GIT_SHA=$VITE_GIT_SHA
ENV VITE_BUILD_TIME=$VITE_BUILD_TIME
ENV VITE_APP_BRAND_NAME=$VITE_APP_BRAND_NAME
ENV VITE_APP_BRAND_URL=$VITE_APP_BRAND_URL
ENV VITE_APP_BRAND_LOGO=$VITE_APP_BRAND_LOGO
ENV VITE_OPENWEATHERMAP_API_KEY=$VITE_OPENWEATHERMAP_API_KEY
ENV VITE_ENABLE_SERVICE_WORKER=$VITE_ENABLE_SERVICE_WORKER
ENV VITE_PUBLIC_WS_SUBSCRIPTIONS_ENABLED=$VITE_PUBLIC_WS_SUBSCRIPTIONS_ENABLED
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# backend build
FROM golang:1.25.11-alpine AS gobuild
WORKDIR /src
RUN apk add --no-cache ca-certificates
COPY backend/go.mod backend/go.sum ./backend/
WORKDIR /src/backend
RUN go mod download
COPY backend/ ./
COPY --from=webbuild /web/dist ./internal/api/static
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/meshcore-live ./cmd/app \
  && CGO_ENABLED=0 GOOS=linux go build -o /out/mc-diagnose ./cmd/diagnose

# runtime
FROM alpine:3.22
ARG APP_VERSION=2.9.5
ARG VITE_GIT_SHA=
ARG VITE_BUILD_TIME=
LABEL org.opencontainers.image.title="MC-CartoLive" \
  org.opencontainers.image.description="Public-safe MeshCore MQTT live map with routed packet replay" \
  org.opencontainers.image.source="https://github.com/n30nex/MC-CartoLive" \
  org.opencontainers.image.url="https://github.com/n30nex/MC-CartoLive" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.version=$APP_VERSION \
  org.opencontainers.image.revision=$VITE_GIT_SHA \
  org.opencontainers.image.created=$VITE_BUILD_TIME
RUN apk add --no-cache ca-certificates tzdata
RUN adduser -D -h /app appuser
WORKDIR /app
COPY --from=gobuild /out/meshcore-live /app/meshcore-live
COPY --from=gobuild /out/mc-diagnose /app/mc-diagnose
RUN mkdir -p /app/data /app/examples/fixtures && chown -R appuser:appuser /app
COPY --chown=appuser:appuser examples/fixtures/ /app/examples/fixtures/
ENV APP_VERSION=$APP_VERSION
ENV GIT_SHA=$VITE_GIT_SHA
ENV BUILD_TIME=$VITE_BUILD_TIME
USER appuser
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["/app/meshcore-live"]
