#!/bin/bash

# Set the N8N_CONFIG_FILES environment variable to point to the config.json file
export N8N_CONFIG_FILES="$(pwd)/config.json"

# Suppress deprecation warnings and increase memory limit
export NODE_OPTIONS="--no-deprecation --max-old-space-size=4096"

# Run pnpm dev
pnpm dev
