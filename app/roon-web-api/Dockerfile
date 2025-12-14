ARG ALPINE_VERSION=3.20
ARG TARGETPLATFORM=linux/amd64

FROM node:22-alpine${ALPINE_VERSION} AS builder
RUN apk add --no-cache git
RUN mkdir -p /usr/src/roon-web-stack
WORKDIR /usr/src/roon-web-stack
COPY . /usr/src/roon-web-stack
RUN corepack enable yarn && \
    yarn workspaces focus @djehring/roon-web-api --production

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
RUN apk add --no-cache libstdc++ dumb-init
RUN : > /usr/src/app/.env
COPY --from=builder /usr/src/roon-web-stack/LICENSE ./LICENSE
COPY --from=builder /usr/src/roon-web-stack/app/roon-web-api/node_modules ./node_modules
COPY --from=builder /usr/src/roon-web-stack/app/roon-web-api/bin/app.js ./app.js
COPY --from=builder /usr/src/roon-web-stack/app/roon-web-ng-client/dist/roon-web-ng-client/browser ./web
USER node
CMD ["dumb-init", "node", "app.js"]

# Add SSL files
COPY ./certs/localhost+4.pem /etc/ssl/certs/localhost+4.pem
COPY ./certs/localhost+4-key.pem /etc/ssl/private/localhost+4-key.pem

# Set environment variables for SSL
ENV SSL_CERT=/etc/ssl/certs/localhost+4.pem
ENV SSL_KEY=/etc/ssl/private/localhost+4-key.pem
ENV HTTPS=true

# Expose HTTPS port
EXPOSE 3000
EXPOSE 3443
