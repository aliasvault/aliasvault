#!/bin/bash
set -e

# =============================================================================
# Local Docker Release Script
# =============================================================================
# Build and push Docker images locally instead of waiting for GitHub Actions.
# Useful when CI is slow (Rust compile step) or failing.
#
# Prerequisites:
#   - Docker with buildx: docker buildx create --use (if not already set up)
#   - GHCR login: echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
#   - Docker Hub login: docker login (for all-in-one image)
#
# Usage:
#   ./scripts/local-release.sh [options]
#
# Options:
#   --version VERSION     Version to release (e.g., 0.26.0). Auto-detected if not specified.
#   --multi               Build and push multi-container images (postgres, api, client, etc.)
#   --aio                 Build and push all-in-one image
#   --all                 Build all Docker images
#   --dry-run             Show what would be done without executing
#   --skip-push           Build but don't push (loads to local Docker instead)
#   --amd64-only          Build for amd64 only (faster, useful for testing)
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Defaults
VERSION=""
BUILD_MULTI=false
BUILD_AIO=false
DRY_RUN=false
SKIP_PUSH=false
AMD64_ONLY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --version) VERSION="$2"; shift 2 ;;
        --multi) BUILD_MULTI=true; shift ;;
        --aio) BUILD_AIO=true; shift ;;
        --all) BUILD_MULTI=true; BUILD_AIO=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        --skip-push) SKIP_PUSH=true; shift ;;
        --amd64-only) AMD64_ONLY=true; shift ;;
        -h|--help) head -28 "$0" | tail -25; exit 0 ;;
        *) echo -e "${RED}Unknown option: $1${NC}"; exit 1 ;;
    esac
done

if [[ "$BUILD_MULTI" == "false" && "$BUILD_AIO" == "false" ]]; then
    echo "Usage: ./scripts/local-release.sh [--multi] [--aio] [--all] [options]"
    echo ""
    echo "Examples:"
    echo "  ./scripts/local-release.sh --aio                    # Build & push all-in-one"
    echo "  ./scripts/local-release.sh --multi                  # Build & push multi-container"
    echo "  ./scripts/local-release.sh --all                    # Build everything"
    echo "  ./scripts/local-release.sh --aio --dry-run          # Preview commands"
    echo "  ./scripts/local-release.sh --aio --skip-push        # Build locally only"
    echo "  ./scripts/local-release.sh --aio --amd64-only       # Faster single-platform build"
    exit 1
fi

# Auto-detect version
if [[ -z "$VERSION" ]]; then
    VERSION=$(node -p "require('$ROOT_DIR/apps/browser-extension/package.json').version")
fi

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}AliasVault Docker Release - v$VERSION${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""

[[ "$DRY_RUN" == "true" ]] && echo -e "${YELLOW}DRY RUN MODE${NC}" && echo ""

# Platform selection
if [[ "$AMD64_ONLY" == "true" ]]; then
    PLATFORMS="linux/amd64"
else
    PLATFORMS="linux/amd64,linux/arm64"
fi

run_cmd() {
    if [[ "$DRY_RUN" == "true" ]]; then
        echo -e "${BLUE}[DRY RUN]${NC} $*"
    else
        echo -e "${GREEN}$${NC} $*"
        eval "$@"
    fi
}

build_multi() {
    echo -e "${GREEN}Building Multi-Container Images${NC}"
    echo ""
    cd "$ROOT_DIR"

    local images=(
        "postgres:apps/server/Databases/AliasServerDb/Dockerfile"
        "api:apps/server/AliasVault.Api/Dockerfile"
        "client:apps/server/AliasVault.Client/Dockerfile"
        "admin:apps/server/AliasVault.Admin/Dockerfile"
        "reverse-proxy:apps/server/Dockerfile"
        "smtp:apps/server/Services/AliasVault.SmtpService/Dockerfile"
        "task-runner:apps/server/Services/AliasVault.TaskRunner/Dockerfile"
        "installcli:apps/server/Utilities/AliasVault.InstallCli/Dockerfile"
    )

    local push_flag=""
    if [[ "$SKIP_PUSH" == "false" ]]; then
        push_flag="--push"
    fi
    # Without --push, buildx builds but doesn't output anywhere (validates the build)

    for item in "${images[@]}"; do
        local name="${item%%:*}"
        local dockerfile="${item#*:}"

        echo -e "${BLUE}→ ghcr.io/aliasvault/$name:$VERSION${NC}"

        run_cmd "docker buildx build \\
            --platform $PLATFORMS \\
            -f $dockerfile \\
            -t ghcr.io/aliasvault/$name:$VERSION \\
            -t ghcr.io/aliasvault/$name:latest \\
            $push_flag \\
            ."
        echo ""
    done
}

build_aio() {
    echo -e "${GREEN}Building All-in-One Image${NC}"
    echo ""
    cd "$ROOT_DIR"

    local push_flag=""
    if [[ "$SKIP_PUSH" == "false" ]]; then
        push_flag="--push"
    fi
    # Without --push, buildx builds but doesn't output anywhere (validates the build)

    echo -e "${BLUE}→ aliasvault/aliasvault:$VERSION${NC}"

    run_cmd "docker buildx build \\
        --platform $PLATFORMS \\
        -f dockerfiles/all-in-one/Dockerfile \\
        -t ghcr.io/aliasvault/aliasvault:$VERSION \\
        -t ghcr.io/aliasvault/aliasvault:latest \\
        -t aliasvault/aliasvault:$VERSION \\
        -t aliasvault/aliasvault:latest \\
        $push_flag \\
        ."
}

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker not found${NC}"
    exit 1
fi

# Ensure buildx is available
if ! docker buildx version &> /dev/null; then
    echo -e "${RED}Docker buildx not available. Run: docker buildx create --use${NC}"
    exit 1
fi

[[ "$BUILD_MULTI" == "true" ]] && build_multi
[[ "$BUILD_AIO" == "true" ]] && build_aio

echo ""
echo -e "${GREEN}Done!${NC}"
[[ "$DRY_RUN" == "true" ]] && echo -e "${YELLOW}(dry run - no changes made)${NC}"
[[ "$SKIP_PUSH" == "true" ]] && echo -e "${YELLOW}(skip-push - built locally only)${NC}"
