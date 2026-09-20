# Dependencies are pure JavaScript, so they are installed once on the build
# machine's own architecture and copied into both images; running npm under
# QEMU for the arm64 image is slow and has crashed (illegal instruction).
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
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
