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
COPY --from=builder /usr/local/bin/docker-entrypoint.sh /usr/local/bin/
ENTRYPOINT ["docker-entrypoint.sh"]
RUN apk add --no-cache libstdc++ dumb-init openssl
RUN : > /usr/src/app/.env
COPY --from=builder /usr/src/roon-web-stack/LICENSE ./LICENSE
COPY --from=builder /usr/src/roon-web-stack/app/roon-web-api/node_modules ./node_modules
COPY --from=builder /usr/src/roon-web-stack/app/roon-web-api/bin/app.js ./app.js
COPY --from=builder /usr/src/roon-web-stack/app/roon-web-ng-client/dist/roon-web-ng-client/browser ./web
USER node
CMD ["dumb-init", "node", "app.js"]

# Create local self-signed SSL cert (dev convenience; avoids committing keys)
USER root
RUN mkdir -p /etc/ssl/private \
  && openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
    -subj "/CN=localhost" \
    -keyout /etc/ssl/private/roon-web-stack-local.key \
    -out /etc/ssl/certs/roon-web-stack-local.crt

# Set environment variables for SSL
ENV SSL_CERT=/etc/ssl/certs/roon-web-stack-local.crt
ENV SSL_KEY=/etc/ssl/private/roon-web-stack-local.key
ENV HTTPS=true

# Expose HTTPS port
EXPOSE 3000
EXPOSE 3443
