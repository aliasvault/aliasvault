#!/bin/bash
#
# Copies the shared image assets in core/assets to every app folder listed in targets.txt.
#
# Usage:
#   ./sync.sh          Copy every source to its destinations (only files that differ are written)
#   ./sync.sh --check  Change nothing; exit 1 when a copy is missing or differs, or an image is unmanaged
#   ./sync.sh --list   Print each source with the destinations it is copied to
#
# The copies are committed, so every app keeps building on its own (Docker contexts, Xcode, store archives).
#
# A source written as "paths:<svg>" is not copied: the path data of that SVG is written in place into the destination,
# for files that draw the logo in code (Android vector drawables, inline <svg> markup). The destination keeps its own
# sizes, transforms and colors; its android:pathData / d attributes are replaced in order and their count must match.

set -e
set -u

ASSETS_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$ASSETS_DIR/../.." && pwd)"
TARGETS_FILE="$ASSETS_DIR/targets.txt"

# App folders whose images must all come from core/assets. An image in here that targets.txt does not produce is reported.
# Folders that also hold content images (fastlane screenshots, docs) are mapped in targets.txt but not listed here.
MANAGED_ROOTS=(
    "apps/web/public"
    "apps/server/AliasVault.Admin/wwwroot"
    "apps/browser-extension/public"
    "apps/browser-extension/src/assets"
    "apps/browser-extension/build-assets"
    "apps/mobile-app/assets"
    "apps/mobile-app/ios"
    "apps/mobile-app/android/app/src/main/res"
)
IMAGE_PATTERN='\.(png|svg|ico|jpg|jpeg|gif|webp)$'

MODE="sync"
case "${1:-}" in
    "") ;;
    --check) MODE="check" ;;
    --list) MODE="list" ;;
    *) echo "Usage: $0 [--check | --list]"; exit 2 ;;
esac

cd "$REPO_ROOT"

# Read the mapping as "source destination" pairs, skipping comments and blank lines.
PAIRS=()
while read -r src dest rest; do
    case "$src" in ""|\#*) continue ;; esac
    if [ -z "$dest" ] || [ -n "$rest" ]; then echo "targets.txt: expected '<source> <destination>', got: $src $dest $rest"; exit 2; fi
    PAIRS+=("$src $dest")
done < "$TARGETS_FILE"

if [ "$MODE" = "list" ]; then
    for src in $(printf '%s\n' "${PAIRS[@]}" | cut -d' ' -f1 | sort -u); do
        echo "$src"
        printf '%s\n' "${PAIRS[@]}" | awk -v s="$src" '$1 == s { print "    -> " $2 }'
    done
    exit 0
fi

PROBLEMS=0
WRITTEN=0

# Writes the destination of an in-place path mapping, with its path attributes replaced by the SVG's paths, to stdout.
render_paths() {
    perl -e '
        local $/;
        open(my $fh, "<", $ARGV[0]) or die "cannot read $ARGV[0]\n"; my $svg = <$fh>; close($fh);
        open($fh, "<", $ARGV[1]) or die "cannot read $ARGV[1]\n"; my $text = <$fh>; close($fh);
        my @paths = $svg =~ /\sd="([^"]+)"/g;
        my $count = () = $text =~ /(?:android:pathData|\sd)="[^"]*"/g;
        if ($count != @paths) { print STDERR "path count mismatch: $ARGV[1] has $count, $ARGV[0] has " . @paths . "\n"; exit 3; }
        my $i = 0;
        $text =~ s/(android:pathData|\sd)="[^"]*"/$1 . "=\"" . $paths[$i++] . "\""/ge;
        print $text;
    ' "$1" "$2"
}

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

for pair in "${PAIRS[@]}"; do
    src="${pair%% *}"
    dest="${pair#* }"
    in_place=false
    case "$src" in paths:*) in_place=true; src="${src#paths:}" ;; esac
    src="core/assets/$src"
    if [ ! -f "$src" ]; then echo "missing source: $src (for $dest)"; PROBLEMS=$((PROBLEMS + 1)); continue; fi
    if [ "$in_place" = true ]; then
        if [ ! -f "$dest" ]; then echo "missing file: $dest (paths from $src)"; PROBLEMS=$((PROBLEMS + 1)); continue; fi
        if ! render_paths "$src" "$dest" > "$TMP_FILE"; then PROBLEMS=$((PROBLEMS + 1)); continue; fi
        if cmp -s "$TMP_FILE" "$dest"; then continue; fi
        if [ "$MODE" = "check" ]; then echo "stale paths: $dest (source $src)"; PROBLEMS=$((PROBLEMS + 1)); continue; fi
        cp "$TMP_FILE" "$dest"
        echo "wrote paths: $dest"
        WRITTEN=$((WRITTEN + 1))
        continue
    fi
    if cmp -s "$src" "$dest"; then continue; fi
    if [ "$MODE" = "check" ]; then
        if [ -f "$dest" ]; then echo "differs: $dest (source $src)"; else echo "missing copy: $dest (source $src)"; fi
        PROBLEMS=$((PROBLEMS + 1))
    else
        mkdir -p "$(dirname "$dest")"
        cp "$src" "$dest"
        echo "wrote: $dest"
        WRITTEN=$((WRITTEN + 1))
    fi
done

# Images in a managed app folder that no mapping produces (tracked, or untracked and not ignored).
DESTS="$(printf '%s\n' "${PAIRS[@]}" | cut -d' ' -f2 | sort -u)"
for f in $(git ls-files -co --exclude-standard -- "${MANAGED_ROOTS[@]}" | grep -iE "$IMAGE_PATTERN" | sort -u); do
    [ -f "$f" ] || continue
    if ! printf '%s\n' "$DESTS" | grep -qxF "$f"; then echo "unmanaged image: $f (add it to core/assets and targets.txt, or delete it)"; PROBLEMS=$((PROBLEMS + 1)); fi
done

# Sources that no mapping uses.
SOURCES="$(printf '%s\n' "${PAIRS[@]}" | cut -d' ' -f1 | sed 's/^paths://' | sort -u)"
for f in $(cd "$ASSETS_DIR" && find . -type f | sed 's|^\./||' | grep -iE "$IMAGE_PATTERN" | sort); do
    if ! printf '%s\n' "$SOURCES" | grep -qxF "$f"; then echo "unused source: core/assets/$f"; PROBLEMS=$((PROBLEMS + 1)); fi
done

if [ "$MODE" = "check" ]; then
    if [ "$PROBLEMS" -gt 0 ]; then echo "$PROBLEMS problem(s); run core/assets/sync.sh"; exit 1; fi
    echo "All asset copies are up to date."
else
    echo "$WRITTEN file(s) written."
    if [ "$PROBLEMS" -gt 0 ]; then echo "$PROBLEMS problem(s) above need a manual fix."; exit 1; fi
fi
