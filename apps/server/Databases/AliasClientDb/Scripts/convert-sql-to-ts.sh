#!/bin/bash

# Script to convert SQL migration files to TypeScript constants
# Run this after generate-sql-files.sh to create SqlConstants.ts and VaultVersions.ts

# Configurable settings
SQL_DIR="MigrationSql"
OUTPUT_FILE="MigrationTs/SqlConstants.ts"
TEMP_DIR="/tmp/sql_to_ts"

# Path to the core vault package
SHARED_SQL_DIR="../../../../../core/vault/src/sql"

# Create temp directory and output directory
mkdir -p "$TEMP_DIR"
mkdir -p "$(dirname "$OUTPUT_FILE")"

# Function to escape SQL content for TypeScript
escape_sql_for_ts() {
    local sql_content="$1"
    # Escape backticks and backslashes
    echo "$sql_content" | sed 's/\\/\\\\/g' | sed 's/`/\\`/g'
}

# Function to extract migration number from filename
extract_migration_number() {
    local filename="$1"
    # Extract number from filename like "001_InitialMigration_to_AddEmail.sql"
    echo "$filename" | sed -n 's/^0*\([0-9]*\)_.*\.sql$/\1/p'
}

# Function to extract migration name from filename
extract_migration_name() {
    local filename="$1"
    # Extract name from filename like "001_InitialMigration_to_AddEmail.sql"
    echo "$filename" | sed -n 's/^[0-9]*_\(.*\)\.sql$/\1/p'
}

# Function to extract version, description, and release date from filename (using the last migration segment)
extract_version_info() {
    local filename="$1"
    # Get the last migration segment (after the last _)
    local last_segment=$(echo "$filename" | awk -F'_to_' '{print $NF}' | sed 's/\.sql$//')
    # last_segment example: 20250310131554_1.5.0-AddTotpCodes
    local timestamp=$(echo "$last_segment" | awk -F'_' '{print $1}')
    local version_and_desc=$(echo "$last_segment" | awk -F'_' '{print $2}')
    local version=$(echo "$version_and_desc" | awk -F'-' '{print $1}')
    local description=$(echo "$version_and_desc" | awk -F'-' '{print $2}')
    # Format date
    local year=${timestamp:0:4}
    local month=${timestamp:4:2}
    local day=${timestamp:6:2}
    local release_date="$year-$month-$day"
    # Make description readable
    local readable_desc=$(echo "$description" | sed 's/\([A-Z]\)/ \1/g' | sed 's/^./\U&/' | sed 's/^U //;s/^ *//')
    echo "$version|$readable_desc|$release_date"
}

# Function to copy files to core vault directory
copy_to_shared_sql() {
    local source_file="$1"
    local target_file="$2"

    if [ -f "$source_file" ]; then
        echo "Copying $source_file to $target_file"
        cp "$source_file" "$target_file"
        if [ $? -eq 0 ]; then
            echo "✓ Successfully copied to core vault directory"
        else
            echo "✗ Failed to copy to core vault directory"
            return 1
        fi
    else
        echo "✗ Source file $source_file not found"
        return 1
    fi
}

echo "Converting SQL files to TypeScript constants..."

# Start building the TypeScript file
cat > "$OUTPUT_FILE" << 'EOF'
/* eslint-disable no-irregular-whitespace */

/**
 * Complete database schema SQL (latest version)
 * Auto-generated from EF Core migrations
 */
export const COMPLETE_SCHEMA_SQL = `
EOF

# Add the full schema SQL if it exists
if [ -f "$SQL_DIR/000_FullSchema.sql" ]; then
    echo "Adding complete schema SQL..."
    FULL_SCHEMA=$(cat "$SQL_DIR/000_FullSchema.sql")
    ESCAPED_SCHEMA=$(escape_sql_for_ts "$FULL_SCHEMA")
    echo "$ESCAPED_SCHEMA" >> "$OUTPUT_FILE"
else
    echo "Warning: 000_FullSchema.sql not found"
fi

# Close the complete schema constant
cat >> "$OUTPUT_FILE" << 'EOF'
`;
/**
 * Individual migration SQL scripts
 * Auto-generated from EF Core migrations
 */
export const MIGRATION_SCRIPTS: Record<number, string> = {
EOF

# Process all migration files (excluding the full schema)
migration_files=($(ls "$SQL_DIR"/*.sql | grep -v "000_FullSchema.sql" | sort))

if [ ${#migration_files[@]} -eq 0 ]; then
    echo "No migration files found in $SQL_DIR"
    # Add empty object
    echo "};" >> "$OUTPUT_FILE"
    exit 0
fi

# Process each migration file
for file in "${migration_files[@]}"; do
    filename=$(basename "$file")
    migration_number=$(extract_migration_number "$filename")
    migration_name=$(extract_migration_name "$filename")

    if [ -z "$migration_number" ]; then
        echo "Warning: Could not extract migration number from $filename, skipping..."
        continue
    fi

    echo "Processing migration $migration_number: $migration_name"

    # Read and escape SQL content
    sql_content=$(cat "$file")
    escaped_sql=$(escape_sql_for_ts "$sql_content")

    # Add to TypeScript file
    cat >> "$OUTPUT_FILE" << EOF
  $migration_number: \`$escaped_sql\`,
EOF
done

# Close the TypeScript file
cat >> "$OUTPUT_FILE" << 'EOF'
};
EOF

echo "TypeScript constants file generated: $OUTPUT_FILE"
echo "Total migrations processed: ${#migration_files[@]}"


# Copy generated files to core vault directory
echo ""
echo "Copying generated files to core vault directory..."

# Check if core vault directory exists
if [ ! -d "$SHARED_SQL_DIR" ]; then
    echo "✗ Core vault directory not found: $SHARED_SQL_DIR"
    echo "Make sure you're running this script from the correct location"
    exit 1
fi

# Copy SqlConstants.ts
copy_to_shared_sql "$OUTPUT_FILE" "$SHARED_SQL_DIR/SqlConstants.ts"

echo ""
echo "Done!"

# Clean up temp directory
rm -rf "$TEMP_DIR"