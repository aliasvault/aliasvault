#!/bin/bash

# Make sure to install the dotnet ef tool first before running this script:
# dotnet tool install --global dotnet-ef

# Configurable settings
PROJECT="../AliasClientDb.csproj"
STARTUP_PROJECT="../AliasClientDb.csproj"   # Adjust if different from main project
CONTEXT="AliasClientDbContext"
OUTPUT_DIR="MigrationSql"
FULL_FILE="$OUTPUT_DIR/000_FullSchema.sql"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Regenerate the full schema script.
echo "Generating full schema script..."
dotnet ef migrations script \
  --project "$PROJECT" \
  --startup-project "$STARTUP_PROJECT" \
  --context "$CONTEXT" \
  --output "$FULL_FILE"

echo "Done. Full schema written to $FULL_FILE"