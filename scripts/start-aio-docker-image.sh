#!/bin/bash

# Go to root
cd ..

# Build the all-in-one docker image
echo "Building all-in-one docker image..."
docker build \
  -f dockerfiles/all-in-one/Dockerfile \
  -t aliasvault-allinone:local \
  .

# Stop the all-in-one docker container if it is running
docker stop aliasvault && docker rm aliasvault

# Run the all-in-one docker container
echo "Running all-in-one docker container..."
docker run -d \
  --name aliasvault \
  -p 80:80 \
  -v ./database:/database \
  -v ./logs:/logs \
  -v ./secrets:/secrets \
  -v ./certificates:/certificates \
  aliasvault-allinone:local

  # Go back to scripts
  cd scripts