#!/bin/bash

# Build the frontend
echo "Building frontend..."
yarn workspace @nihilux/roon-web-ng-client build

# Copy the frontend to the backend
cp -r ./app/roon-web-ng-client/dist/roon-web-ng-client/browser/* ./app/roon-web-api/bin/web/

# Build the AMD64 image
docker buildx build --platform linux/amd64 \
  -t nihiluxorg/roon-web-stack:latest \
  -f app/roon-web-api/Dockerfile \
  --load \
  .

# Save to tar file
docker save nihiluxorg/roon-web-stack:latest > roon-backend.tar