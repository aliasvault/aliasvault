#!/bin/bash

# Combined script to generate SQL files and TypeScript constants
# This script runs both generate-sql-files.sh and generate-sql-constants.sh

echo "=== AliasVault SQL Generation Pipeline ==="
echo ""

# Step 1: Generate SQL files from EF Core migrations
echo "Step 1: Generating SQL files from EF Core migrations..."
if [ -f "generate-sql-files.sh" ]; then
    bash generate-sql-files.sh
    if [ $? -ne 0 ]; then
        echo "Error: Failed to generate SQL files"
        exit 1
    fi
else
    echo "Error: generate-sql-files.sh not found"
    exit 1
fi

echo ""

# Step 2: Convert SQL files to TypeScript constants
echo "Step 2: Converting SQL files to TypeScript constants..."
if [ -f "convert-sql-to-ts.sh" ]; then
    bash convert-sql-to-ts.sh
    if [ $? -ne 0 ]; then
        echo "Error: Failed to generate TypeScript constants"
        exit 1
    fi
else
    echo "Error: generate-sql-constants.sh not found"
    exit 1
fi

echo ""
echo "=== Pipeline completed successfully! ==="
echo ""
echo "Generated files:"
echo "- SQL files: MigrationSql/"
echo "- TypeScript files: MigrationTs/"
echo ""
echo "The TypeScript files have been copied to the core vault directory."
echo ""
echo "Next, make sure to add the new vault SQL migrations to the VaultVersions.ts file in the vault library."
echo ""
echo "Afterwards, run the following command to build and distribute the vault library:"
echo "core/build-and-distribute.sh"