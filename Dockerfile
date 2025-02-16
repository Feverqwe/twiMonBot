FROM node:22-alpine AS node
WORKDIR /opt

FROM node AS base
COPY ./package.json .
COPY ./package-lock.json .
RUN chown -R nobody:nogroup ./ && \
    touch /.npmrc && chown nobody:nogroup /.npmrc && \
    mkdir /.npm && chown nobody:nogroup /.npm && \
    mkdir ./log && chown nobody:nogroup ./log && \
    mkdir ./store && chown nobody:nogroup ./store && \
    ln -sf /dev/stdout ./log/stdout.log && \
    ln -sf /dev/stderr ./log/stderr.log
USER nobody:nobody
RUN npm config set update-notifier false && \
    npm ci --omit dev --fund false

FROM base AS build
RUN npm i --fund false
ADD ./src ./src
COPY ./tsconfig.json .
RUN npm run build

FROM base AS release
COPY --from=build /opt/dist ./dist

ENV NODE_ENV=production
ENV DEBUG=app:*

EXPOSE 80

CMD node ./dist/main.js 1>> ./log/stdout.log 2>> ./log/stderr.log
