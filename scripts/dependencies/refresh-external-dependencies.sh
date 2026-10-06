#!/usr/bin/env bash
#
# Refresh local copies of external dependencies that we cache in the repo
# (allowlists, public key bundles, etc.) so the mobile/browser/server apps
# do not need to fetch them at runtime.
#
# Run as part of the manual release pipeline.
#
# Usage:
#   ./refresh-external-dependencies.sh              # run every task
#   ./refresh-external-dependencies.sh <task>...    # run only the named task(s)
#   ./refresh-external-dependencies.sh --list       # show available tasks
#
# Adding a new task:
#   1. Define a function named `task_<name>` that fetches the upstream payload
#      and writes the result into the relevant source file. Use the
#      `replace_generated_block` helper to swap content between
#      `// BEGIN_GENERATED: <id>` and `// END_GENERATED: <id>` markers (any
#      comment syntax works — the helper matches both line- and block-style).
#   2. Register the task in TASK_ORDER + TASK_DESCRIPTIONS below.

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

# Replace everything between `BEGIN_GENERATED: <id>` and `END_GENERATED: <id>`
# markers in $1 with the contents of the file at $3. The marker lines
# themselves are preserved; only the lines between them change.
#
# Arguments:
#   $1 target file
#   $2 block id (must match the marker)
#   $3 path to file whose contents become the new block body
replace_generated_block() {
    local target_file="$1"
    local block_id="$2"
    local payload_file="$3"

    python3 - "$target_file" "$block_id" "$payload_file" <<'PY'
import re
import sys

target, block_id, payload_path = sys.argv[1:4]

with open(target, "r") as f:
    src = f.read()
with open(payload_path, "r") as f:
    payload = f.read().rstrip("\n")

pattern = re.compile(
    r"(BEGIN_GENERATED:\s*" + re.escape(block_id) + r".*?\n)"
    r"(.*?)"
    r"(^[ \t]*\S+\s*END_GENERATED:\s*" + re.escape(block_id) + r")",
    re.DOTALL | re.MULTILINE,
)

match = pattern.search(src)
if not match:
    sys.stderr.write(
        f"ERROR: BEGIN_GENERATED/END_GENERATED markers for '{block_id}' "
        f"not found in {target}\n"
    )
    sys.exit(1)

new_src = src[:match.start()] + match.group(1) + payload + "\n" + match.group(3) + src[match.end():]

with open(target, "w") as f:
    f.write(new_src)
PY
}

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
# Tasks — one function per external dependency
# ----------------------------------------------------------------------

task_passkeys_allowlist() {
    local url="https://www.gstatic.com/gpm-passkeys-privileged-apps/apps.json"
    local target="$REPO_ROOT/apps/mobile-app/android/app/src/main/java/net/aliasvault/app/credentialprovider/OriginVerifier.kt"
    local block_id="passkeys-allowlist"

    echo -e "  ${BLUE}↓${RESET} fetching $url"
    local raw="$WORK_DIR/passkeys-allowlist.json"
    download "$url" "$raw"
    ensure_valid_json "$raw"

    # Build the replacement block. The JSON lines are embedded inside a
    # Kotlin triple-quoted string with `.trimIndent()`, so we prefix every
    # line with 8 spaces of indent — trimIndent strips that back out at
    # runtime, leaving the upstream bytes intact.
    local block="$WORK_DIR/passkeys-allowlist.block"
    {
        echo "        // Source: $url"
        echo "        // Last refreshed: $TODAY"
        echo '        private val PRIVILEGED_ALLOWLIST_JSON = """'
        awk '{ if (length($0) > 0) print "        " $0; else print "" }' "$raw"
        echo '        """.trimIndent()'
    } > "$block"

    replace_generated_block "$target" "$block_id" "$block"
    echo -e "  ${GREEN}✓${RESET} updated ${target#$REPO_ROOT/}"
}

task_public_suffix_list() {
    local url="https://publicsuffix.org/list/public_suffix_list.dat"
    local target="$REPO_ROOT/core/rust/src/credential_matcher/public_suffix/public_suffix_list.dat"

    echo -e "  ${BLUE}↓${RESET} fetching $url"
    local raw="$WORK_DIR/public_suffix_list.dat"
    download "$url" "$raw"

    # Rewrite the upstream list into the rules-only form the Rust core embeds: comments and blank
    # lines dropped (the section markers are kept), internationalized rules converted to punycode
    # since the matcher only ever sees ASCII hostnames. The MPL-2.0 notice stays with the data.
    python3 - "$raw" "$target" "$url" "$TODAY" <<'PY'
import re
import sys

raw_path, target, url, today = sys.argv[1:5]

with open(raw_path, encoding="utf-8") as f:
    lines = f.read().splitlines()

version = next((l[len("// VERSION:"):].strip() for l in lines if l.startswith("// VERSION:")), None)
if version is None or "// ===BEGIN ICANN DOMAINS===" not in lines or "// ===END PRIVATE DOMAINS===" not in lines:
    sys.stderr.write("ERROR: downloaded content does not look like the Public Suffix List\n")
    sys.exit(1)

def to_ascii(rule):
    prefix = "!" if rule.startswith("!") else ""
    labels = [label if label == "*" else label.encode("idna").decode("ascii") for label in rule[len(prefix):].split(".")]
    return prefix + ".".join(labels)

out = []
rule_count = 0
for line in lines:
    if line.startswith("// ===") and line.endswith("==="):
        out.append(line)
        continue
    rule = line.split()[0] if line.strip() else ""
    if not rule or rule.startswith("//"):
        continue
    if not re.fullmatch(r"!?(\*|[^\s.!*]+)(\.[^\s.!*]+)*", rule):
        sys.stderr.write(f"ERROR: unexpected rule syntax: {line}\n")
        sys.exit(1)
    out.append(to_ascii(rule.lower()))
    rule_count += 1

if rule_count < 5000:
    sys.stderr.write(f"ERROR: only {rule_count} rules parsed, refusing to write a truncated list\n")
    sys.exit(1)

header = [
    "// Mozilla Public Suffix List, rules only: comments and blank lines stripped, internationalized rules in punycode.",
    f"// Source: {url}",
    f"// Upstream version: {version}",
    f"// Last refreshed: {today} by scripts/dependencies/refresh-external-dependencies.sh (task public-suffix-list)",
    "//",
    "// This Source Code Form is subject to the terms of the Mozilla Public",
    "// License, v. 2.0. If a copy of the MPL was not distributed with this",
    "// file, You can obtain one at https://mozilla.org/MPL/2.0/.",
]

with open(target, "w", encoding="utf-8") as f:
    f.write("\n".join(header + out) + "\n")

print(f"  {rule_count} rules, upstream version {version}")
PY

    echo -e "  ${GREEN}✓${RESET} updated ${target#$REPO_ROOT/}"
}

# ----------------------------------------------------------------------
# Registry
# ----------------------------------------------------------------------

# Each entry is "task-name:human description". The order here is the order
# tasks run when no specific task argument is given.
TASKS=(
    "passkeys-allowlist:Android privileged-apps allowlist for WebAuthn (gstatic.com/gpm-passkeys-privileged-apps/apps.json)"
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
