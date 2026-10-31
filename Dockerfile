FROM node:22.23.1-alpine3.24@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.3.0 --activate

FROM base AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV CHARGEOS_API_HOST=0.0.0.0
ENV CHARGEOS_API_PORT=9080
ENV CHARGEOS_EVENT_LOG=/data/events.ndjson
ENV CHARGEOS_OCPP_HOST=0.0.0.0
ENV CHARGEOS_PORT=9000
ENV CHARGEOS_UI_DIRECTORY=/app/dist/ui

RUN addgroup -S chargeos && adduser -S -G chargeos -h /app chargeos && mkdir -p /data /run/secrets && chown chargeos:chargeos /data
COPY --from=build --chown=chargeos:chargeos /app/dist ./dist
COPY --from=build --chown=chargeos:chargeos /app/node_modules ./node_modules
COPY --from=build --chown=chargeos:chargeos /app/package.json ./package.json

USER chargeos
VOLUME ["/data"]
EXPOSE 9000 9080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:9080/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist/server/main.js"]
