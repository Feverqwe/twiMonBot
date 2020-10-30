FROM node:12-alpine as node
ENV NO_UPDATE_NOTIFIER true

FROM node as base
WORKDIR /opt/twiMonBot
RUN chown -R nobody:nobody ./ && \
    mkdir /.npm && \
    chown -R nobody:nobody /.npm
USER nobody:nobody
COPY ./package.json .
COPY ./package-lock.json .
RUN npm install --production

FROM base as build
WORKDIR /opt/twiMonBot
USER nobody:nobody
RUN npm install
ADD ./src ./src
COPY ./rollup.config.js .
COPY ./tsconfig.json .
RUN npm run build

FROM base as release
WORKDIR /opt/twiMonBot
COPY --from=build /opt/twiMonBot/dist ./dist
USER nobody:nobody
COPY ./liveTime.json .
COPY ./config.json .
ENV NODE_ENV=production
ENV DEBUG=*,-node-telegram-bot-api,-sequelize:*,-express:*,-body-parser:*,-proxy-agent,-http-proxy-agent,-https-proxy-agent

EXPOSE 1339

CMD node ./dist/main.js 1>> ./log/stdout.log 2>> ./log/stderr.log