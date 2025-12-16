ARG ALPINE_VERSION=3.20
ARG TARGETPLATFORM=linux/amd64

FROM node:22-alpine${ALPINE_VERSION} AS builder
RUN apk add --no-cache git
WORKDIR /usr/src/roon-web-stack
COPY . .
RUN corepack enable yarn && yarn install && yarn build

FROM alpine:${ALPINE_VERSION}
WORKDIR /usr/src/app
RUN addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node \
  && chown node:node ./
RUN mkdir /usr/src/app/config \
    && chown node:node /usr/src/app/config \
    && ln -sv /usr/src/app/config/config.json /usr/src/app/config.json
ENV HOST=0.0.0.0
COPY --from=builder /usr/local/bin/node /usr/local/bin/
RUN apk add --no-cache libstdc++ dumb-init openssl
RUN : > /usr/src/app/.env
COPY --from=builder /usr/src/roon-web-stack/LICENSE ./LICENSE
COPY --from=builder /usr/src/roon-web-stack/app/roon-web-api/node_modules ./node_modules
COPY --from=builder /usr/src/roon-web-stack/app/roon-web-api/bin/app.js ./app.js
COPY --from=builder /usr/src/roon-web-stack/app/roon-web-ng-client/dist/roon-web-ng-client/browser ./web
COPY --from=builder /usr/src/roon-web-stack/app/roon-web-api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Default SSL paths (generated at runtime if missing; persisted in config volume)
ENV SSL_CERT=/usr/src/app/config/tls/roon-web-stack.crt
ENV SSL_KEY=/usr/src/app/config/tls/roon-web-stack.key
ENV HTTPS=true

USER node
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["dumb-init", "node", "app.js"]

# Expose HTTPS port
EXPOSE 3000
EXPOSE 3443
