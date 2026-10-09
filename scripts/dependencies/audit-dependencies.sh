#!/usr/bin/env bash
#
# Audit all dependencies for known vulnerabilities, apply non-breaking fixes and run the affected tests.
# Keep the project lists below in sync with .github/dependabot.yml.
#
# Usage: ./audit-dependencies.sh [check|fix|test|all] [options]
#   check   (default) Print one combined report. Changes nothing.
#   fix     Apply non-breaking fixes in place, then check again.
#   test    Run the build, lint and test commands of every project in scope.
#   all     fix, then test.
#
# Options:
#   --only <list>       Ecosystems: npm, nuget, cargo, gradle (android), cocoapods (ios). Default: all.
#   --project <dir>     Limit to a project directory, e.g. apps/web or core/rust. Repeatable.
#   --level <severity>  Lowest failing severity: low, moderate, high (default) or critical.
#   --ci                test: always run `npm ci` first.
#   --build-core        test: build the core libraries first.
#   --no-allowlist      Ignore audit-allowlist.json (accepted advisories, each with a reason).
#
# Exit codes: 0 = clean, 1 = findings at or above --level or a failed test, 2 = an ecosystem was skipped.

set -uo pipefail

if [ -z "${BASH_VERSION:-}" ]; then
    echo "Error: this script must be run with bash" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ALLOWLIST="$SCRIPT_DIR/audit-allowlist.json"
HELPER="$SCRIPT_DIR/audit-dependencies.mjs"

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

ECOSYSTEMS="npm nuget cargo gradle cocoapods"

# npm projects in install order: core packages first, since the apps link them via file: dependencies.
NPM_PROJECTS="core/models core/vault core/i18n core/client apps/browser-extension apps/web apps/mobile-app apps/server/AliasVault.Admin docs"
DOTNET_DIR="apps/server"
DOTNET_SLN="aliasvault.sln"
CARGO_DIR="core/rust"
GRADLE_DIR="apps/mobile-app/android"
PODS_DIR="apps/mobile-app/ios"

# npm scripts run by `test` per project, in order.
npm_test_scripts() {
    case "$1" in
        core/models|core/vault) echo "build lint test" ;;
        core/i18n|core/client|apps/browser-extension) echo "compile lint test" ;;
        apps/web) echo "compile lint build" ;;
        apps/mobile-app) echo "compile lint" ;;
        docs) echo "typecheck build" ;;
        *) echo "" ;;
    esac
}

# Print the header comment.
usage() {
    awk 'NR > 2 && /^#/ { sub(/^# ?/, ""); print; next } NR > 2 { exit }' "${BASH_SOURCE[0]}"
}

# ----------------------------------------------------------------------
# Arguments
# ----------------------------------------------------------------------

COMMAND="check"
ONLY="${ECOSYSTEMS// /,}"
PROJECTS=""
LEVEL="high"
NPM_CI=false
BUILD_CORE=false
USE_ALLOWLIST=true

while [ $# -gt 0 ]; do
    case "$1" in
        check|fix|test|all) COMMAND="$1"; shift ;;
        --only) ONLY="$(echo "${2:-}" | sed 's/android/gradle/g; s/ios/cocoapods/g')"; shift 2 ;;
        --project) PROJECTS="$PROJECTS ${2%/}"; shift 2 ;;
        --level) LEVEL="${2:-}"; shift 2 ;;
        --ci) NPM_CI=true; shift ;;
        --build-core) BUILD_CORE=true; shift ;;
        --no-allowlist) USE_ALLOWLIST=false; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo -e "${RED}Unknown argument: $1${RESET}" >&2; usage; exit 1 ;;
    esac
done

case "$LEVEL" in
    low|moderate|high|critical) ;;
    *) echo -e "${RED}--level must be low, moderate, high or critical${RESET}" >&2; exit 1 ;;
esac

for tool in node npm; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo -e "${RED}$tool is required${RESET}" >&2
        exit 1
    fi
done

# Whether ecosystem $1 is selected by --only.
eco_enabled() {
    case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac
}

# Whether project directory $2 of ecosystem $1 is selected by --only and --project.
in_scope() {
    eco_enabled "$1" || return 1
    [ -z "$PROJECTS" ] && return 0
    case " $PROJECTS " in *" $2 "*) return 0 ;; *) return 1 ;; esac
}

WORK_DIR="$(mktemp -d)"
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aliasvault-audit.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

SKIPPED=""
EXIT_CODE=0

# Read by the helper script.
export AUDIT_REPO_ROOT="$REPO_ROOT"
export AUDIT_FINDINGS="$WORK_DIR/findings.tsv"
export AUDIT_ALLOWLIST="$ALLOWLIST"
[ "$USE_ALLOWLIST" = true ] || AUDIT_ALLOWLIST="-"

# Mark ecosystem/project $1 as skipped with reason $2.
skip() {
    echo -e "  ${YELLOW}!${RESET} skipped $1: $2"
    SKIPPED="$SKIPPED\n  - $1: $2"
}

# Whether tool $1 is installed; otherwise skips $2 with reason $3 (default "$1 not installed").
need() {
    command -v "$1" >/dev/null 2>&1 && return 0
    skip "$2" "${3:-$1 not installed}"
    return 1
}

# Run "${@:2}" in repo directory $1.
at() {
    local dir="$1"; shift
    (cd "$REPO_ROOT/$dir" && "$@")
}

# Run phase $1 (audit, fix or test) for every ecosystem; each function checks its own scope.
run_phase() {
    local eco
    for eco in $ECOSYSTEMS; do "${1}_$eco"; done
}

# Run "$@" with output to log file $LOG_DIR/$1.log; prints the tail on failure.
run_logged() {
    local name="$1"; shift
    local log="$LOG_DIR/$name.log"
    if "$@" >"$log" 2>&1; then
        return 0
    fi
    echo -e "    ${RED}failed${RESET}, last lines of $log:"
    tail -n 25 "$log" | sed 's/^/      /'
    return 1
}

# Write the vulnerable NuGet packages as JSON to file $1; on failure the dotnet output is in $1.raw.
nuget_list() {
    at "$DOTNET_DIR" dotnet list "$DOTNET_SLN" package --vulnerable --include-transitive --format json >"$1.raw" 2>&1 || return 1
    # dotnet prints restore output ahead of the JSON.
    sed -n '/^{/,$p' "$1.raw" >"$1"
}

# Write `cargo audit --json` to file $1, errors to $1.err.
cargo_audit() {
    at "$CARGO_DIR" cargo audit --json >"$1" 2>"$1.err"
}

# Whether the Gradle build can run: it needs java and the mobile app's node_modules (the RN/Expo plugins live there).
gradle_ready() {
    need java gradle || return 1
    if [ ! -d "$REPO_ROOT/apps/mobile-app/node_modules" ]; then skip "gradle" "apps/mobile-app/node_modules missing (run npm ci there)"; return 1; fi
}

# Write the resolved release runtime classpath of the Android app to file $1.
gradle_dependencies() {
    at "$GRADLE_DIR" ./gradlew :app:dependencies --configuration releaseRuntimeClasspath -q >"$1" 2>&1
}

# ----------------------------------------------------------------------
# check: audit every project in scope
# ----------------------------------------------------------------------

audit_npm() {
    local project out
    for project in $NPM_PROJECTS; do
        in_scope npm "$project" || continue
        echo -e "  ${BLUE}→${RESET} npm audit $project"
        out="$WORK_DIR/npm-${project//\//_}.json"
        at "$project" npm audit --json >"$out" 2>/dev/null
        node "$HELPER" npm-parse "$project" "$out" || skip "npm $project" "npm audit failed"
    done
}

audit_nuget() {
    in_scope nuget "$DOTNET_DIR" && need dotnet nuget || return 0
    echo -e "  ${BLUE}→${RESET} dotnet list package --vulnerable ($DOTNET_DIR/$DOTNET_SLN)"
    local out="$WORK_DIR/nuget.json"
    if ! nuget_list "$out"; then skip "nuget" "dotnet list package failed, see output below"; tail -n 20 "$out.raw"; return 0; fi
    node "$HELPER" nuget-parse "$out" || skip "nuget" "could not parse dotnet output"
}

audit_cargo() {
    in_scope cargo "$CARGO_DIR" && need cargo-audit cargo "cargo-audit not installed (cargo install cargo-audit --locked)" || return 0
    echo -e "  ${BLUE}→${RESET} cargo audit $CARGO_DIR"
    local out="$WORK_DIR/cargo.json"
    cargo_audit "$out"
    node "$HELPER" cargo-parse "$CARGO_DIR" "$out" 2>/dev/null || { skip "cargo" "cargo audit failed"; cat "$out.err"; }
}

audit_gradle() {
    in_scope gradle "$GRADLE_DIR" && gradle_ready || return 0
    echo -e "  ${BLUE}→${RESET} gradle releaseRuntimeClasspath + osv.dev ($GRADLE_DIR)"
    local deps="$WORK_DIR/gradle-deps.txt"
    if ! gradle_dependencies "$deps"; then skip "gradle" "gradlew :app:dependencies failed, see output below"; tail -n 20 "$deps"; return 0; fi
    node "$HELPER" gradle-parse "$GRADLE_DIR" "$deps" || skip "gradle" "osv.dev lookup failed"
}

audit_cocoapods() {
    in_scope cocoapods "$PODS_DIR" || return 0
    echo -e "  ${BLUE}→${RESET} Podfile.lock trunk pods + osv.dev ($PODS_DIR)"
    node "$HELPER" pods-parse "$PODS_DIR" || skip "cocoapods" "osv.dev lookup failed"
}

run_check() {
    echo -e "\n${BLUE}== Auditing dependencies${RESET}"
    : >"$AUDIT_FINDINGS"
    run_phase audit
    node "$HELPER" report "$LEVEL" || EXIT_CODE=1
}

# ----------------------------------------------------------------------
# fix: apply non-breaking fixes in place
# ----------------------------------------------------------------------

fix_npm() {
    local project name log audit raises
    for project in $NPM_PROJECTS; do
        in_scope npm "$project" || continue
        echo -e "  ${BLUE}→${RESET} npm audit fix $project"
        name="${project//\//_}"
        log="$LOG_DIR/fix-npm-$name.log"
        # npm audit fix exits non-zero while unfixable advisories remain; the re-audit reports those.
        at "$project" npm audit fix --no-fund >"$log" 2>&1
        grep -E "^(added|removed|changed|up to date)" "$log" | head -n 1 | sed 's/^/      /'

        # npm audit fix never touches our own overrides, so raise exact pins that hold a vulnerable version.
        audit="$WORK_DIR/fix-npm-$name.json"
        at "$project" npm audit --json >"$audit" 2>/dev/null
        raises="$(node "$HELPER" npm-raise-overrides "$project" "$audit")"
        [ -n "$raises" ] || continue
        echo -e "$raises" | sed "s/^\([^ ]*\) /      $(printf "$GREEN")+$(printf "$RESET") override \1 -> /"
        at "$project" run_logged "fix-npm-$name-install" npm install --no-audit --no-fund || EXIT_CODE=1
    done
}

fix_nuget() {
    in_scope nuget "$DOTNET_DIR" && need dotnet nuget || return 0
    echo -e "  ${BLUE}→${RESET} dotnet package update --vulnerable (direct references, can take a few minutes)"
    at "$DOTNET_DIR" run_logged fix-nuget-update dotnet package update --vulnerable --project "$DOTNET_SLN" || EXIT_CODE=1

    echo -e "  ${BLUE}→${RESET} pinning vulnerable transitive packages"
    local out="$WORK_DIR/nuget-fix.json" csproj pkg version
    nuget_list "$out"
    while IFS="$(printf '\t')" read -r csproj pkg version; do
        [ -n "$csproj" ] || continue
        echo -e "      ${GREEN}+${RESET} $pkg $version in ${csproj#$REPO_ROOT/}"
        run_logged "fix-nuget-pin-$pkg" dotnet add "$csproj" package "$pkg" --version "$version" || EXIT_CODE=1
    done <<<"$(node "$HELPER" nuget-pins "$out")"
}

fix_cargo() {
    in_scope cargo "$CARGO_DIR" && need cargo-audit cargo "cargo-audit not installed (cargo install cargo-audit --locked)" || return 0
    local out="$WORK_DIR/cargo-fix.json" spec
    cargo_audit "$out"
    for spec in $(node "$HELPER" cargo-updates "$out"); do
        echo -e "  ${BLUE}→${RESET} cargo update -p $spec"
        at "$CARGO_DIR" run_logged "fix-cargo-${spec%@*}" cargo update -p "$spec" || EXIT_CODE=1
    done
}

fix_gradle() {
    in_scope gradle "$GRADLE_DIR" && gradle_ready || return 0
    echo -e "  ${BLUE}→${RESET} bumping vulnerable versions in $GRADLE_DIR/app/build.gradle"
    local deps="$WORK_DIR/gradle-fix-deps.txt"
    if ! gradle_dependencies "$deps"; then skip "gradle" "gradlew :app:dependencies failed"; return 0; fi
    node "$HELPER" gradle-apply "$GRADLE_DIR" "$deps" | sed "s/^/      $(printf "$GREEN")+$(printf "$RESET") /"
}

fix_cocoapods() {
    in_scope cocoapods "$PODS_DIR" || return 0
    local pods
    pods="$(node "$HELPER" pods-updates "$PODS_DIR")" || { skip "cocoapods" "osv.dev lookup failed"; return 0; }
    [ -n "$pods" ] || return 0
    need pod cocoapods "pod not installed, run: pod update $pods" || return 0
    echo -e "  ${BLUE}→${RESET} pod update $pods"
    # shellcheck disable=SC2086
    at "$PODS_DIR" run_logged fix-cocoapods pod update $pods || EXIT_CODE=1
}

run_fix() {
    echo -e "\n${BLUE}== Applying non-breaking fixes${RESET}"
    run_phase fix
    echo -e "\n${BLUE}== Changed files${RESET}"
    git -C "$REPO_ROOT" status --short -- '*package.json' '*package-lock.json' '*.csproj' '*Cargo.lock' '*Cargo.toml' '*build.gradle' '*Podfile.lock'
    run_check
}

# ----------------------------------------------------------------------
# test: build, lint and test every project in scope
# ----------------------------------------------------------------------

TEST_RESULTS=""

# Run "${@:3}" in repo directory $2 as test step $1: logged, then recorded.
step() {
    local label="$1" dir="$2"; shift 2
    at "$dir" run_logged "test-${label//[^A-Za-z0-9]/_}" "$@"
    record "$label" $?
}

# Record the result of test $1 (exit status $2).
record() {
    if [ "$2" -eq 0 ]; then
        echo -e "    ${GREEN}✓${RESET} $1"
        TEST_RESULTS="$TEST_RESULTS\n  ${GREEN}✓${RESET} $1"
    else
        TEST_RESULTS="$TEST_RESULTS\n  ${RED}✗${RESET} $1"
        EXIT_CODE=1
    fi
}

test_npm() {
    local project script name
    for project in $NPM_PROJECTS; do
        in_scope npm "$project" || continue
        echo -e "  ${BLUE}→${RESET} $project"
        name="${project//\//_}"
        if [ "$NPM_CI" = true ] || [ ! -d "$REPO_ROOT/$project/node_modules" ]; then
            step "$project: npm ci" "$project" npm ci --no-audit --no-fund
        fi
        for script in $(npm_test_scripts "$project"); do
            step "$project: npm run $script" "$project" npm run "$script"
        done
        # build:admin-css runs in --watch mode and writes a tracked file, so compile the CSS to a temp file instead.
        if [ "$project" = "apps/server/AliasVault.Admin" ]; then
            step "$project: tailwindcss build" "$project" npx --no-install tailwindcss -i ./tailwind.css -o "$WORK_DIR/admin-tailwind.css"
        fi
    done
}

test_nuget() {
    in_scope nuget "$DOTNET_DIR" && need dotnet "nuget tests" || return 0
    echo -e "  ${BLUE}→${RESET} $DOTNET_DIR"
    step "$DOTNET_DIR: dotnet build" "$DOTNET_DIR" dotnet build "$DOTNET_SLN"
    # NetworkTests fetch real third-party websites, excluded like in CI.
    step "$DOTNET_DIR: dotnet test AliasVault.UnitTests" "$DOTNET_DIR" dotnet test Tests/AliasVault.UnitTests --no-build --filter "Category!=NetworkTests"
}

test_cargo() {
    in_scope cargo "$CARGO_DIR" && need cargo "cargo tests" || return 0
    echo -e "  ${BLUE}→${RESET} $CARGO_DIR"
    step "$CARGO_DIR: cargo test --lib --features uniffi" "$CARGO_DIR" cargo test --lib --features uniffi
}

test_gradle() {
    in_scope gradle "$GRADLE_DIR" && gradle_ready || return 0
    echo -e "  ${BLUE}→${RESET} $GRADLE_DIR"
    step "$GRADLE_DIR: gradlew :app:testDebugUnitTest" "$GRADLE_DIR" ./gradlew :app:testDebugUnitTest --tests "net.aliasvault.app.*"
}

test_cocoapods() {
    in_scope cocoapods "$PODS_DIR" || return 0
    need xcodebuild "cocoapods tests" "needs macOS with Xcode and CocoaPods" && need pod "cocoapods tests" "needs macOS with Xcode and CocoaPods" || return 0
    local simulator simulator_id
    simulator="$(xcrun simctl list devices available | grep -m1 -E 'iPhone ')"
    simulator_id="$(echo "$simulator" | grep -oE '[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}')"
    simulator="$(echo "$simulator" | grep -oE 'iPhone [^(]+' | sed 's/ *$//')"
    if [ -z "$simulator_id" ]; then skip "cocoapods tests" "no iPhone simulator available"; return 0; fi
    echo -e "  ${BLUE}→${RESET} $PODS_DIR ($simulator)"
    step "$PODS_DIR: pod install" "$PODS_DIR" pod install
    step "$PODS_DIR: xcodebuild test VaultStoreKitTests" "$PODS_DIR" xcodebuild test -workspace AliasVault.xcworkspace -scheme AliasVault -destination "platform=iOS Simulator,id=$simulator_id" -only-testing:VaultStoreKitTests -quiet
}

run_tests() {
    echo -e "\n${BLUE}== Running tests${RESET} (logs in $LOG_DIR)"
    if [ "$BUILD_CORE" = true ]; then
        local targets=""
        eco_enabled npm && targets="$targets --browser-extension --web"
        eco_enabled gradle && targets="$targets --android"
        eco_enabled cocoapods && [ "$(uname)" = "Darwin" ] && targets="$targets --ios"
        if [ -n "$targets" ]; then
            echo -e "  ${BLUE}→${RESET} core/build-and-distribute.sh$targets"
            # shellcheck disable=SC2086
            step "core: build-and-distribute.sh$targets" core ./build-and-distribute.sh $targets
        fi
    elif eco_enabled npm && { [ ! -f "$REPO_ROOT/core/client/wasm-extension/aliasvault_core.js" ] || [ ! -f "$REPO_ROOT/core/client/wasm-web/aliasvault_core.js" ]; }; then
        echo -e "  ${YELLOW}!${RESET} core/client/wasm-extension or wasm-web is missing, the app builds and tests need both: rerun with --build-core"
    fi
    run_phase test
    echo -e "\n${BLUE}== Test results${RESET}$TEST_RESULTS"
}

# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

case "$COMMAND" in
    check) run_check ;;
    fix) run_fix ;;
    test) run_tests ;;
    all) run_fix; run_tests ;;
esac

if [ -n "$SKIPPED" ]; then
    echo -e "\n${YELLOW}Skipped:${RESET}$SKIPPED"
    [ "$EXIT_CODE" -eq 0 ] && EXIT_CODE=2
fi
if [ "$COMMAND" != "check" ]; then
    echo -e "\nLogs: $LOG_DIR"
else
    rmdir "$LOG_DIR" 2>/dev/null
fi
exit "$EXIT_CODE"
