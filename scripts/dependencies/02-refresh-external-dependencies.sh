#!/usr/bin/env bash
#
# Refresh local copies of external dependencies that we cache in the repo
# (allowlists, public key bundles, etc.) so the mobile/browser/server apps
# do not need to fetch them at runtime.
#
# Run as part of the manual release pipeline.
#
# Helpers: 02-build-privileged-apps-list.py (task privileged-apps), 02-convert-public-suffix-list.py (task public-suffix-list).
#
# Usage:
#   ./02-refresh-external-dependencies.sh              # run every task
#   ./02-refresh-external-dependencies.sh <task>...    # run only the named task(s)
#   ./02-refresh-external-dependencies.sh --list       # show available tasks
#
# Adding a new task:
#   1. Define a function named `task_<name>` that downloads the upstream payload
#      and writes the result file. Put any conversion logic in a helper script
#      next to this one.
#   2. Register the task in TASKS below.

set -euo pipefail

if [ -z "${BASH_VERSION:-}" ]; then
    echo "Error: this script must be run with bash" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TODAY="$(date +%Y-%m-%d)"

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# ----------------------------------------------------------------------
# Helpers shared by all tasks
# ----------------------------------------------------------------------

# Download a URL into a file, failing loudly on HTTP errors.
download() {
    local url="$1"
    local out="$2"
    if ! curl --fail --silent --show-error --location "$url" -o "$out"; then
        echo -e "  ${RED}✗${RESET} download failed: $url" >&2
        return 1
    fi
}

# Validate that a file contains parseable JSON.
ensure_valid_json() {
    local file="$1"
    if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$file" 2>/dev/null; then
        echo -e "  ${RED}✗${RESET} downloaded content is not valid JSON" >&2
        return 1
    fi
}

# ----------------------------------------------------------------------
# Tasks: one function per external dependency
# ----------------------------------------------------------------------

# Browsers trusted to request credentials on behalf of websites: Google's privileged-apps list combined with other
# open-source lists, built by 02-build-privileged-apps-list.py.
task_privileged_apps() {
    local google_url="https://www.gstatic.com/gpm-passkeys-privileged-apps/apps.json"
    local target="$REPO_ROOT/apps/mobile-app/android/app/src/main/res/raw/privileged_apps.json"

    # vendor|repository|branch|path, fetched at the current commit of the branch.
    local community_sources=(
        "Bitwarden|https://github.com/bitwarden/android|main|app/src/main/assets/fido2_privileged_community.json"
        "Proton Pass|https://github.com/protonpass/android-pass|main|scripts/ci/browser_cert_extras.json"
        "Proton Pass|https://github.com/protonpass/android-pass|main|scripts/ci/browser_cert_extras_fdroid.json"
    )

    local build_args=(--today "$TODAY" --out "$target")

    echo -e "  ${BLUE}↓${RESET} fetching $google_url"
    download "$google_url" "$WORK_DIR/privileged-apps-google.json"
    ensure_valid_json "$WORK_DIR/privileged-apps-google.json"
    build_args+=(--google "$google_url" "$WORK_DIR/privileged-apps-google.json")

    local entry vendor repo branch path commit raw_url file i=0
    for entry in "${community_sources[@]}"; do
        IFS='|' read -r vendor repo branch path <<< "$entry"
        commit="$(git ls-remote "$repo" "refs/heads/$branch" | cut -f1)"
        if [ -z "$commit" ]; then
            echo -e "  ${RED}✗${RESET} could not resolve $branch of $repo" >&2
            return 1
        fi
        raw_url="${repo/github.com/raw.githubusercontent.com}/$commit/$path"
        file="$WORK_DIR/privileged-apps-community-$i.json"
        echo -e "  ${BLUE}↓${RESET} fetching $raw_url"
        download "$raw_url" "$file"
        ensure_valid_json "$file"
        build_args+=(--community "$vendor" "$repo/blob/$commit/$path" "$file")
        i=$((i + 1))
    done

    mkdir -p "$(dirname "$target")"
    python3 "$SCRIPT_DIR/02-build-privileged-apps-list.py" "${build_args[@]}"
    echo -e "  ${GREEN}✓${RESET} updated ${target#$REPO_ROOT/}"
}

# Public Suffix List in the rules-only form the Rust credential matcher embeds, converted by 02-convert-public-suffix-list.py.
task_public_suffix_list() {
    local url="https://publicsuffix.org/list/public_suffix_list.dat"
    local target="$REPO_ROOT/core/rust/src/credential_matcher/public_suffix/public_suffix_list.dat"

    echo -e "  ${BLUE}↓${RESET} fetching $url"
    local raw="$WORK_DIR/public_suffix_list.dat"
    download "$url" "$raw"

    python3 "$SCRIPT_DIR/02-convert-public-suffix-list.py" --url "$url" --today "$TODAY" "$raw" "$target"
    echo -e "  ${GREEN}✓${RESET} updated ${target#$REPO_ROOT/}"
}

# ----------------------------------------------------------------------
# Registry
# ----------------------------------------------------------------------

# Each entry is "task-name:human description". The order here is the order
# tasks run when no specific task argument is given.
TASKS=(
    "privileged-apps:Android privileged apps list (trusted browsers) for passkeys and autofill (Google list + other open-source lists)"
    "public-suffix-list:Public Suffix List for root domain matching in the Rust credential matcher (publicsuffix.org)"
)

# ----------------------------------------------------------------------
# Dispatch
# ----------------------------------------------------------------------

task_description() {
    local needle="$1"
    local entry
    for entry in "${TASKS[@]}"; do
        if [ "${entry%%:*}" = "$needle" ]; then
            echo "${entry#*:}"
            return 0
        fi
    done
    return 1
}

list_tasks() {
    echo "Available tasks:"
    local entry name desc
    for entry in "${TASKS[@]}"; do
        name="${entry%%:*}"
        desc="${entry#*:}"
        printf "  %-24s %s\n" "$name" "$desc"
    done
}

run_task() {
    local name="$1"
    local fn="task_${name//-/_}"
    if ! declare -F "$fn" > /dev/null; then
        echo -e "${RED}Unknown task: $name${RESET}" >&2
        echo >&2
        list_tasks >&2
        return 1
    fi
    echo -e "${YELLOW}→${RESET} $name"
    "$fn"
}

usage() {
    cat <<EOF
Usage: $0 [options] [task...]

Refreshes local copies of external dependencies cached in this repo.
With no arguments, runs every registered task in order.

Options:
  -l, --list    Show available tasks and exit
  -h, --help    Show this help and exit

EOF
    list_tasks
}

case "${1:-}" in
    -h|--help|help)
        usage
        ;;
    -l|--list)
        list_tasks
        ;;
    "")
        for entry in "${TASKS[@]}"; do
            run_task "${entry%%:*}"
        done
        ;;
    *)
        for arg in "$@"; do
            run_task "$arg"
        done
        ;;
esac
