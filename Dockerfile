FROM node:14-alpine as node
ENV NO_UPDATE_NOTIFIER true

FROM node as base
WORKDIR /opt/backend
RUN chown -R nobody:nobody ./ && \
    mkdir /.npm && \
    chown -R nobody:nobody /.npm
USER nobody:nobody
COPY ./package.json .
COPY ./package-lock.json .
RUN npm audit --production && \
    npm ci --production

FROM base as build
WORKDIR /opt/backend
USER nobody:nobody
RUN npm ci
ADD ./src ./src
COPY ./rollup.config.js .
COPY ./tsconfig.json .
RUN npm run build

FROM base as release
WORKDIR /opt/backend
COPY --from=build /opt/backend/dist ./dist
USER nobody:nobody
COPY ./liveTime.json .
COPY ./config.json .
ENV NODE_ENV=production
ENV DEBUG=app:*

EXPOSE 1339

CMD node ./dist/main.js 1>> ./log/stdout.log 2>> ./log/stderr.log