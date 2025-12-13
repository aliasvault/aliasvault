#!/bin/bash

set -e  # Stop on error
set -u  # Treat unset variables as errors

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Output directories
DIST_DIR="$SCRIPT_DIR/dist"
WASM_DIR="$DIST_DIR/wasm"

# Target directories in consumer apps
BROWSER_EXT_DIST="$SCRIPT_DIR/../../apps/browser-extension/src/utils/dist/core/rust"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  AliasVault Rust Core Build Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check for required tools
check_tool() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}Error: $1 is not installed${NC}"
        echo "Please install $1 first:"
        echo "$2"
        exit 1
    fi
}

echo -e "${YELLOW}Checking prerequisites...${NC}"
check_tool "rustc" "Visit https://rustup.rs"
check_tool "cargo" "Visit https://rustup.rs"

# Check Rust version
RUST_VERSION=$(rustc --version | cut -d' ' -f2)
echo -e "  Rust version: ${GREEN}$RUST_VERSION${NC}"

# Build mode selection
BUILD_ALL=false
BUILD_BROWSER=false
FAST_MODE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --browser)
            BUILD_BROWSER=true
            shift
            ;;
        --fast|--dev)
            FAST_MODE=true
            echo -e "${YELLOW}Fast/dev mode enabled${NC}"
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Target options:"
            echo "  --browser     Build WASM for browser extension"
            echo ""
            echo "Speed options:"
            echo "  --fast, --dev Faster builds (for development)"
            echo ""
            echo "Other options:"
            echo "  --help        Show this help message"
            echo ""
            echo "Examples:"
            echo "  ./build.sh --browser        # Build WASM for browser extension"
            echo "  ./build.sh --browser --fast # Fast dev build"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# If no targets specified, show help
if ! $BUILD_BROWSER; then
    echo "No target specified. Use --help for usage."
    echo ""
    echo "Quick start:"
    echo "  ./build.sh --browser    # Build for browser extension"
    exit 0
fi

# ============================================
# Browser Extension Build (WASM)
# ============================================
build_browser() {
    echo ""
    echo -e "${BLUE}Building WASM for browser extension...${NC}"

    local start_time=$(date +%s)

    # Check for wasm-pack
    if ! command -v wasm-pack &> /dev/null; then
        echo -e "${YELLOW}Installing wasm-pack...${NC}"
        cargo install wasm-pack
    fi

    # Ensure wasm target is installed
    if ! rustup target list --installed 2>/dev/null | grep -q "wasm32-unknown-unknown"; then
        echo -e "  Installing wasm32-unknown-unknown target..."
        rustup target add wasm32-unknown-unknown
    fi

    # Build with wasm-pack
    echo -e "  Running wasm-pack build..."
    if $FAST_MODE; then
        wasm-pack build --dev --target web --out-dir "$WASM_DIR" --features wasm
    else
        wasm-pack build --release --target web --out-dir "$WASM_DIR" --features wasm
    fi

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # Show output size
    if [ -f "$WASM_DIR/aliasvault_core_bg.wasm" ]; then
        WASM_SIZE=$(ls -lh "$WASM_DIR/aliasvault_core_bg.wasm" | awk '{print $5}')
        echo -e "${GREEN}WASM build complete! (${duration}s)${NC}"
        echo -e "  Size: ${YELLOW}$WASM_SIZE${NC}"
    fi
}

# ============================================
# Distribution
# ============================================
distribute_browser() {
    echo ""
    echo -e "${BLUE}Distributing to browser extension...${NC}"

    if [ -d "$WASM_DIR" ] && [ -n "$(ls -A "$WASM_DIR" 2>/dev/null)" ]; then
        rm -rf "$BROWSER_EXT_DIST"
        mkdir -p "$BROWSER_EXT_DIST"
        cp "$WASM_DIR"/aliasvault_core* "$BROWSER_EXT_DIST/"
        cp "$WASM_DIR"/package.json "$BROWSER_EXT_DIST/"

        # Create README
        cat > "$BROWSER_EXT_DIST/README.md" << 'README_EOF'
# Rust Core WASM Module

Auto-generated from `/core/rust`. Do not edit manually.

## Regenerate

```bash
cd /core/rust
./build.sh --browser
```
README_EOF

        echo -e "${GREEN}Distributed to: $BROWSER_EXT_DIST${NC}"
        ls -lh "$BROWSER_EXT_DIST/"
    fi
}

# ============================================
# Main Build Process
# ============================================
TOTAL_START=$(date +%s)

if $BUILD_BROWSER; then
    build_browser
    distribute_browser
fi

TOTAL_END=$(date +%s)
TOTAL_DURATION=$((TOTAL_END - TOTAL_START))

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Build completed in ${TOTAL_DURATION}s${NC}"
echo -e "${GREEN}========================================${NC}"
