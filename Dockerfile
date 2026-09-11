FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY public ./public
ARG GIT_SHA=dev
ENV NODE_ENV=production
ENV TAVERN_REVISION=$GIT_SHA
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "server/index.js"]
