#!/bin/bash
set -e  # Exit on any error, except where explicitly ignored
trap 'echo "🛑 Interrupted. Exiting..."; exit 130' INT  # Handle Ctrl+C cleanly

# Create outputs bind dir and set correct permissions
mkdir -p outputs
sudo chown -R 1000:1000 outputs

# Build and run the Docker environment
echo "Building Docker images..."
if ! docker compose build; then
  echo "⚠️  Warning: Docker build failed, continuing..."
fi

echo "Running fdroid-buildserver..."
docker compose run --rm fdroid-buildserver