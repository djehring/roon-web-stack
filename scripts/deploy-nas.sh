#!/bin/bash

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | xargs)
fi

# Check if required variables are set
if [ -z "$NAS_HOST" ] || [ -z "$NAS_USER" ] || [ -z "$ROOT_PASSWORD" ]; then
    echo "Error: Required environment variables not set. Please check your .env file."
    exit 1
fi

REMOTE_PATH="/volume2/RoonServer"

# Check local tar file
if [ ! -f roon-backend.tar ] || [ ! -s roon-backend.tar ]; then
    echo "Error: roon-backend.tar is missing or empty"
    exit 1
fi

echo "Local tar file size: $(ls -lh roon-backend.tar)"

echo "Copying tar file to NAS..."
# First copy to /tmp
cat roon-backend.tar | ssh ${NAS_USER}@${NAS_HOST} "cat > /tmp/roon-backend.tar"

# Then move it to final location with sudo
ssh ${NAS_USER}@${NAS_HOST} "echo '${ROOT_PASSWORD}' | sudo -S bash -c '\
  mv /tmp/roon-backend.tar ${REMOTE_PATH}/roon-backend.tar && \
  chown root:root ${REMOTE_PATH}/roon-backend.tar && \
  ls -l ${REMOTE_PATH}/roon-backend.tar'"

# Verify the file transferred correctly
echo "Verifying file size..."
LOCAL_SIZE=$(ls -l roon-backend.tar | awk '{print $5}')
REMOTE_SIZE=$(ssh ${NAS_USER}@${NAS_HOST} "ls -l ${REMOTE_PATH}/roon-backend.tar | awk '{print \$5}'")

if [ "$LOCAL_SIZE" != "$REMOTE_SIZE" ]; then
    echo "Error: File sizes don't match! Local: $LOCAL_SIZE Remote: $REMOTE_SIZE"
    exit 1
fi

echo "Deploying container..."
# Execute commands directly via SSH
ssh -t ${NAS_USER}@${NAS_HOST} "echo '${ROOT_PASSWORD}' | sudo -S bash -c '\
  cd ${REMOTE_PATH} && \
  /usr/local/bin/docker rm -f roon-web-stack || true && \
  /usr/local/bin/docker rmi djehring/roon-web-stack:latest || true && \
  ls -l roon-backend.tar && \
  echo "Loading Docker image..." && \
  /usr/local/bin/docker load < ${REMOTE_PATH}/roon-backend.tar && \
  echo "Running container..." && \
  cd ${REMOTE_PATH} && \
  /usr/local/bin/docker run -d \
    --name roon-web-stack \
    --network host \
    --env-file ${REMOTE_PATH}/.env \
    -v ${REMOTE_PATH}/config:/usr/src/app/config \
    -v ${REMOTE_PATH}/certs:/etc/ssl/certs \
    --pull never \
    -e HTTPS=true \
    -e SSL_KEY=/etc/ssl/certs/localhost+4-key.pem \
    -e SSL_CERT=/etc/ssl/certs/localhost+4.pem \
    djehring/roon-web-stack:latest \
'"

echo "Deployment complete!"