#!/bin/bash

# Copy the frontend to the backend
mkdir -p ./app/roon-web-api/bin/web
cp -r ./app/roon-web-ng-client/dist/roon-web-ng-client/browser/* ./app/roon-web-api/bin/web/

# Build the Docker image for AMD64
docker buildx build \
  --platform linux/amd64 \
  -f app/roon-web-api/Dockerfile \
  -t djehring/roon-web-stack:latest \
  .

# Save the image
docker save djehring/roon-web-stack:latest -o roon-backend.tar