# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /opt

ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json ./

FROM base AS prod-deps
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

FROM base AS build
RUN --mount=type=cache,target=/root/.npm npm ci
COPY src ./src
COPY tsconfig.json ./
RUN npm run build

FROM node:24-alpine AS release
WORKDIR /opt

RUN apk add --no-cache su-exec

ENV NODE_ENV=production \
    DEBUG=app:*

COPY package.json ./
COPY --from=prod-deps /opt/node_modules ./node_modules
COPY --from=build /opt/dist ./dist

EXPOSE 80

CMD ["sh", "-c", "mkdir -p /opt/log && chown -R nobody:nogroup /opt/log && exec su-exec nobody:nogroup sh -c 'exec node ./dist/main.js >> /opt/log/stdout.log 2>> /opt/log/stderr.log'"]
