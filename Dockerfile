# Dependencies are pure JavaScript, so they are installed once on the build
# machine's own architecture and copied into both images; running npm under
# QEMU for the arm64 image is slow and has crashed (illegal instruction).
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# The pmtiles CLI (Go, from its own GitHub release), for cutting a map region out of a world file (Maps' "Add a
# region"; see documentation/plans/plan-map-region-download.md). Unlike npm, this needs no compiling and nothing runs
# under emulation: buildx builds this stage once per target platform, so $TARGETARCH is that platform's own, and the
# step is just downloading and unpacking the matching prebuilt binary. Pinned to one release and checked against its
# own sha256 (computed here from the asset itself; the release carries no checksums file of its own).
FROM alpine:3.20 AS pmtiles
ARG TARGETARCH
ARG PMTILES_VERSION=1.31.2
WORKDIR /tmp/pmtiles
RUN apk add --no-cache curl ca-certificates && \
    case "$TARGETARCH" in \
      amd64) PMTILES_ARCH=x86_64; PMTILES_SHA=3ed7dbf4ec2e6dfe5e25b6f70d1ffc932729f93c86db353bf514dd71010a312f ;; \
      arm64) PMTILES_ARCH=arm64; PMTILES_SHA=f8bd47e7ea866863489cad588fbaf2f31f42e5821f7a03f009b3769f05801cb1 ;; \
      *) echo "no pmtiles build for architecture $TARGETARCH" >&2; exit 1 ;; \
    esac && \
    curl -fsSL -o pmtiles.tar.gz "https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/go-pmtiles_${PMTILES_VERSION}_Linux_${PMTILES_ARCH}.tar.gz" && \
    echo "${PMTILES_SHA}  pmtiles.tar.gz" | sha256sum -c - && \
    tar -xzf pmtiles.tar.gz pmtiles && \
    chmod +x pmtiles

FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=pmtiles /tmp/pmtiles/pmtiles /usr/local/bin/pmtiles
COPY server ./server
COPY public ./public
# The modules that ship with Tavern (sources, not zips): Manage > Modules installs and updates them from here.
COPY modules ./modules
ARG GIT_SHA=dev
ENV NODE_ENV=production
ENV TAVERN_REVISION=$GIT_SHA
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server/index.js"]
