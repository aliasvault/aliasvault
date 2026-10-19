#!/usr/bin/env bash
#
# Re-exports the draw.io diagrams in docs/static/assets/diagrams to the files the docs use:
# <name>-light.svg, <name>-dark.svg and <name>.html (full screen viewer), plus a dark <name>-thumb.jpg
# when that file already exists (the README thumbnail of the overview diagram).
# Whitepaper diagrams live in diagrams/whitepaper (named after their section), the others in diagrams/technical.
#
# The .drawio file is the source; edit it in draw.io (desktop or app.diagrams.net) and run this script.
# Runs draw.io headless in Docker, so only Docker is required.
#
# Usage:
#   docs/scripts/export-diagrams.sh               # export diagrams whose .drawio is newer than its exports
#   docs/scripts/export-diagrams.sh --all         # export every diagram
#   docs/scripts/export-diagrams.sh 4-key-hierarchy # export the named diagram(s), by file name or path
#   docs/scripts/export-diagrams.sh --png <dir>   # also write a light PNG of each exported diagram to <dir> (for previewing)

set -euo pipefail

IMAGE="${DRAWIO_IMAGE:-rlespinasse/drawio-desktop-headless:latest}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../static/assets/diagrams" && pwd)"
THUMB_WIDTH=1280

ALL=0
PNG_DIR=""
NAMES=()
while [ $# -gt 0 ]; do
    case "$1" in
        --all) ALL=1 ;;
        --png) PNG_DIR="$(mkdir -p "$2" && cd "$2" && pwd)"; shift ;;
        -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) NAMES+=("$(basename "$1" .drawio)") ;;
    esac
    shift
done

if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running." >&2
    exit 1
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    # An empty Docker config skips the macOS keychain credential helper, which can hang on a public pull.
    EMPTY_CONFIG="$(mktemp -d)"
    echo '{}' > "$EMPTY_CONFIG/config.json"
    DOCKER_CONFIG="$EMPTY_CONFIG" docker pull "$IMAGE"
    rm -rf "$EMPTY_CONFIG"
fi

# Runs the draw.io CLI on a path relative to $ROOT. --shm-size avoids Chromium crashes on larger diagrams.
drawio() {
    local png_mount=()
    if [ -n "$PNG_DIR" ]; then png_mount=(-v "$PNG_DIR:/png"); fi
    docker run --rm --shm-size=1g -v "$ROOT:/data" ${png_mount[@]+"${png_mount[@]}"} -w /data "$IMAGE" "$@" >/dev/null
}

# Whether any export of a diagram is missing or older than its .drawio source.
is_stale() {
    local src="$1" base="${1%.drawio}"
    for out in "$base-light.svg" "$base-dark.svg" "$base.html"; do
        if [ ! -f "$ROOT/$out" ] || [ "$ROOT/$src" -nt "$ROOT/$out" ]; then return 0; fi
    done
    return 1
}

export_diagram() {
    local src="$1" base="${1%.drawio}"
    echo "Exporting $src"
    drawio -x -f svg --theme light --embed-svg-fonts false -b 10 -o "$base-light.svg" "$src"
    drawio -x -f svg --theme dark --embed-svg-fonts false -b 10 -o "$base-dark.svg" "$src"
    drawio -x -f html -o "$base.html" "$src"
    if [ -f "$ROOT/$base-thumb.jpg" ]; then
        drawio -x -f jpg --theme dark --width "$THUMB_WIDTH" -b 10 -o "$base-thumb.jpg" "$src"
    fi
    if [ -n "$PNG_DIR" ]; then
        drawio -x -f png --width 2400 -b 10 -o "/png/$(basename "$base").png" "$src"
    fi
}

SOURCES=()
while IFS= read -r src; do
    name="$(basename "$src" .drawio)"
    if [ ${#NAMES[@]} -gt 0 ]; then
        for wanted in "${NAMES[@]}"; do
            if [ "$wanted" = "$name" ]; then SOURCES+=("$src"); fi
        done
    elif [ "$ALL" = 1 ] || is_stale "$src"; then
        SOURCES+=("$src")
    fi
done < <(cd "$ROOT" && find . -name '*.drawio' | sed 's|^\./||' | sort)

if [ ${#NAMES[@]} -gt 0 ] && [ ${#SOURCES[@]} -ne ${#NAMES[@]} ]; then
    echo "Unknown diagram name in: ${NAMES[*]}" >&2
    exit 1
fi

if [ ${#SOURCES[@]} -eq 0 ]; then
    echo "All diagrams are up to date (use --all to export them anyway)."
    exit 0
fi

for src in "${SOURCES[@]}"; do
    export_diagram "$src"
done
echo "Done: ${#SOURCES[@]} diagram(s) exported."
