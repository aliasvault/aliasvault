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
DOTNET_DIR="$DIST_DIR/dotnet"
IOS_DIR="$DIST_DIR/ios"
ANDROID_DIR="$DIST_DIR/android"

# Target directories in consumer apps
BROWSER_EXT_DIST="$SCRIPT_DIR/../../apps/browser-extension/src/utils/dist/core/rust"
BLAZOR_CLIENT_DIST="$SCRIPT_DIR/../../apps/server/AliasVault.Client/wwwroot/wasm"
IOS_APP_DIST="$SCRIPT_DIR/../../apps/mobile-app/ios/RustCoreFramework/RustCore"
ANDROID_APP_DIST="$SCRIPT_DIR/../../apps/mobile-app/android/app/src/main/jniLibs"

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

# Portable checksum function (works on macOS and Linux)
# Includes Rust sources AND Cargo.toml/Cargo.lock to detect dependency changes
# that can cause UniFFI checksum mismatches
compute_source_checksum() {
    local dir="$1"
    if [ -d "$dir" ]; then
        # Combine checksums of:
        # 1. All .rs source files
        # 2. Cargo.toml and Cargo.lock (dependency changes affect UniFFI checksums)
        {
            find "$dir" -name "*.rs" -type f -print0 2>/dev/null | \
                sort -z | \
                xargs -0 shasum -a 256 2>/dev/null
            # Include Cargo files from parent directory (where Cargo.toml lives)
            local cargo_dir="$(dirname "$dir")"
            shasum -a 256 "$cargo_dir/Cargo.toml" "$cargo_dir/Cargo.lock" 2>/dev/null
        } | shasum -a 256 | cut -d' ' -f1
    else
        echo "unknown"
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
BUILD_DOTNET=false
BUILD_IOS=false
BUILD_ANDROID=false
FAST_MODE=false
INCREMENTAL=false
FORCE_BUILD=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --browser)
            BUILD_BROWSER=true
            shift
            ;;
        --dotnet)
            BUILD_DOTNET=true
            shift
            ;;
        --ios)
            BUILD_IOS=true
            shift
            ;;
        --android)
            BUILD_ANDROID=true
            shift
            ;;
        --all)
            BUILD_BROWSER=true
            BUILD_DOTNET=true
            BUILD_IOS=true
            BUILD_ANDROID=true
            shift
            ;;
        --fast|--dev)
            FAST_MODE=true
            echo -e "${YELLOW}Fast/dev mode enabled${NC}"
            shift
            ;;
        --incremental)
            INCREMENTAL=true
            shift
            ;;
        --force)
            FORCE_BUILD=true
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Target options:"
            echo "  --browser     Build WASM for browser extension and Blazor WASM client"
            echo "  --dotnet      Build native library for .NET server-side use (macOS/Linux/Windows)"
            echo "  --ios         Build for iOS (device + simulator arm64) with Swift bindings"
            echo "  --android     Build for Android (arm64-v8a, armeabi-v7a, x86_64) with Kotlin bindings"
=            echo "  --all         Build all targets"
            echo ""
            echo "Speed options:"
            echo "  --fast, --dev Faster builds (for development)"
            echo "  --incremental Skip build if sources unchanged (for Xcode build phases)"
            echo "  --force       Force rebuild even with --incremental"
            echo ""
            echo "Other options:"
            echo "  --help        Show this help message"
            echo ""
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# If no targets specified, show help
if ! $BUILD_BROWSER && ! $BUILD_DOTNET && ! $BUILD_IOS && ! $BUILD_ANDROID; then
    echo "No target specified. Use --help for usage."
    echo ""
    echo "Quick start:"
    echo "  ./build.sh --browser    # Build for browser extension"
    echo "  ./build.sh --dotnet     # Build for .NET"
    echo "  ./build.sh --ios        # Build for iOS"
    echo "  ./build.sh --android    # Build for Android"
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

        # Also distribute to Blazor client
        echo ""
        echo -e "${BLUE}Distributing to Blazor client...${NC}"
        rm -rf "$BLAZOR_CLIENT_DIST"
        mkdir -p "$BLAZOR_CLIENT_DIST"
        cp "$WASM_DIR"/aliasvault_core_bg.wasm "$BLAZOR_CLIENT_DIST/"
        cp "$WASM_DIR"/aliasvault_core.js "$BLAZOR_CLIENT_DIST/"

        echo -e "${GREEN}Distributed to: $BLAZOR_CLIENT_DIST${NC}"
        ls -lh "$BLAZOR_CLIENT_DIST/"
    fi
}

# ============================================
# .NET Build (Native Library with FFI)
# ============================================
build_dotnet() {
    echo ""
    echo -e "${BLUE}Building native library for .NET...${NC}"

    local start_time=$(date +%s)

    # Detect current platform
    local os_name
    local arch_name
    local lib_name
    local target_dir

    case "$(uname -s)" in
        Darwin)
            os_name="macos"
            lib_name="libaliasvault_core.dylib"
            ;;
        Linux)
            os_name="linux"
            lib_name="libaliasvault_core.so"
            ;;
        MINGW*|MSYS*|CYGWIN*)
            os_name="windows"
            lib_name="aliasvault_core.dll"
            ;;
        *)
            echo -e "${RED}Unsupported OS: $(uname -s)${NC}"
            exit 1
            ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64)
            arch_name="x64"
            ;;
        arm64|aarch64)
            arch_name="arm64"
            ;;
        *)
            arch_name="$(uname -m)"
            ;;
    esac

    target_dir="$DOTNET_DIR/${os_name}-${arch_name}"
    mkdir -p "$target_dir"

    echo -e "  Platform: ${YELLOW}${os_name}-${arch_name}${NC}"

    # Build with cargo
    echo -e "  Running cargo build..."
    if $FAST_MODE; then
        cargo build --features ffi
        local cargo_target="target/debug"
    else
        cargo build --release --features ffi
        local cargo_target="target/release"
    fi

    # Copy the library
    if [ -f "$cargo_target/$lib_name" ]; then
        cp "$cargo_target/$lib_name" "$target_dir/"
        local lib_size
        lib_size=$(ls -lh "$target_dir/$lib_name" | awk '{print $5}')
        echo -e "${GREEN}Native library built! ${NC}"
        echo -e "  Output: ${YELLOW}$target_dir/$lib_name${NC}"
        echo -e "  Size: ${YELLOW}$lib_size${NC}"
    else
        echo -e "${RED}Build failed: $lib_name not found${NC}"
        exit 1
    fi

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    echo -e "${GREEN}.NET build complete! (${duration}s)${NC}"
}

# ============================================
# iOS Build (ARM64 only - device + simulator)
# ============================================
build_ios() {
    echo ""
    echo -e "${BLUE}Building for iOS...${NC}"

    local start_time=$(date +%s)

    # Check for Xcode (required for iOS builds)
    if ! command -v xcrun &> /dev/null; then
        echo -e "${RED}Error: Xcode command line tools not found${NC}"
        echo "Install with: xcode-select --install"
        exit 1
    fi

    # Incremental build check
    local checksum_file="$IOS_APP_DIST/.rust-core-checksum"
    local current_checksum=""
    current_checksum=$(compute_source_checksum "$SCRIPT_DIR/src")

    if $INCREMENTAL && [ "$FORCE_BUILD" = false ] && [ -f "$checksum_file" ] && [ -f "$IOS_APP_DIST/lib/device/libaliasvault_core.a" ]; then
        local stored_checksum=$(cat "$checksum_file" 2>/dev/null || echo "")
        if [ "$current_checksum" = "$stored_checksum" ]; then
            echo -e "${GREEN}Rust Core is up to date, skipping build${NC}"
            IOS_BUILD_SKIPPED=true
            return 0
        fi
    fi
    IOS_BUILD_SKIPPED=false

    # Install iOS targets if needed (ARM64 only - no Intel simulator support)
    echo -e "  Checking iOS build targets..."
    for target in aarch64-apple-ios aarch64-apple-ios-sim; do
        if ! rustup target list --installed 2>/dev/null | grep -q "$target"; then
            echo -e "  Installing $target..."
            rustup target add "$target"
        fi
    done

    # Create output directories
    mkdir -p "$IOS_DIR/device"
    mkdir -p "$IOS_DIR/simulator"
    mkdir -p "$IOS_DIR/swift"

    local cargo_profile
    if $FAST_MODE; then
        cargo_profile="debug"
        cargo_flags=""
    else
        cargo_profile="release"
        cargo_flags="--release"
    fi

    # Build for iOS device (arm64)
    # Note: Use only 'uniffi' feature for library builds (not uniffi-cli which includes heavy bindgen deps)
    echo -e "  Building for iOS device (aarch64-apple-ios)..."
    cargo build $cargo_flags --target aarch64-apple-ios --features uniffi

    # Build for iOS simulator (arm64 - Apple Silicon only)
    echo -e "  Building for iOS simulator arm64 (aarch64-apple-ios-sim)..."
    cargo build $cargo_flags --target aarch64-apple-ios-sim --features uniffi

    # Copy libraries (no lipo needed - single architecture for simulator)
    cp "target/aarch64-apple-ios/$cargo_profile/libaliasvault_core.a" "$IOS_DIR/device/"
    cp "target/aarch64-apple-ios-sim/$cargo_profile/libaliasvault_core.a" "$IOS_DIR/simulator/"

    # Strip debug symbols from static libraries to reduce size
    # Note: -S strips debug symbols but keeps the symbol table needed for linking
    if ! $FAST_MODE; then
        echo -e "  Stripping debug symbols from libraries..."
        strip -S "$IOS_DIR/device/libaliasvault_core.a" 2>/dev/null || true
        strip -S "$IOS_DIR/simulator/libaliasvault_core.a" 2>/dev/null || true
    fi

    # Generate Swift bindings using UniFFI
    # Note: Use uniffi-cli feature here since we need the bindgen CLI tool
    echo -e "  Generating Swift bindings..."
    cargo run $cargo_flags --features uniffi-cli --bin uniffi-bindgen -- generate \
        --library "target/aarch64-apple-ios/$cargo_profile/libaliasvault_core.a" \
        --language swift \
        --out-dir "$IOS_DIR/swift"

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # Show output sizes
    if [ -f "$IOS_DIR/device/libaliasvault_core.a" ]; then
        local device_size=$(ls -lh "$IOS_DIR/device/libaliasvault_core.a" | awk '{print $5}')
        local sim_size=$(ls -lh "$IOS_DIR/simulator/libaliasvault_core.a" | awk '{print $5}')
        echo -e "${GREEN}iOS build complete! (${duration}s)${NC}"
        echo -e "  Device library: ${YELLOW}$device_size${NC}"
        echo -e "  Simulator library: ${YELLOW}$sim_size${NC}"

        if [ -d "$IOS_DIR/swift" ] && [ -n "$(ls -A "$IOS_DIR/swift" 2>/dev/null)" ]; then
            echo -e "  Swift bindings: ${GREEN}Generated${NC}"
            ls "$IOS_DIR/swift/"
        fi
    fi
}

# ============================================
# iOS Distribution
# ============================================
distribute_ios() {
    echo ""
    echo -e "${BLUE}Distributing to iOS app...${NC}"

    mkdir -p "$IOS_APP_DIST/lib/device"
    mkdir -p "$IOS_APP_DIST/lib/simulator"
    mkdir -p "$IOS_APP_DIST/include"
    mkdir -p "$IOS_APP_DIST/Generated"

    # Copy libraries
    if [ -f "$IOS_DIR/device/libaliasvault_core.a" ]; then
        cp "$IOS_DIR/device/libaliasvault_core.a" "$IOS_APP_DIST/lib/device/"
        echo -e "  Copied device library"
    fi

    if [ -f "$IOS_DIR/simulator/libaliasvault_core.a" ]; then
        cp "$IOS_DIR/simulator/libaliasvault_core.a" "$IOS_APP_DIST/lib/simulator/"
        echo -e "  Copied simulator library"
    fi

    # Copy headers and modulemap
    if [ -d "$IOS_DIR/swift" ] && [ -n "$(ls -A "$IOS_DIR/swift" 2>/dev/null)" ]; then
        # Copy C header to framework root (for public headers)
        cp "$IOS_DIR/swift"/aliasvault_coreFFI.h "$IOS_APP_DIST/../" 2>/dev/null || true

        # Create the framework modulemap at framework root
        cat > "$IOS_APP_DIST/../module.modulemap" << 'EOF'
framework module RustCoreFramework {
    umbrella header "RustCoreFramework.h"
    export *
    module * { export * }
}
EOF
        echo -e "  Copied headers and modulemap"

        # Copy Swift bindings
        cp "$IOS_DIR/swift"/*.swift "$IOS_APP_DIST/Generated/" 2>/dev/null || true
        echo -e "  Copied Swift bindings"
    fi

    # Save checksum for incremental builds
    local current_checksum=""
    current_checksum=$(compute_source_checksum "$SCRIPT_DIR/src")
    echo "$current_checksum" > "$IOS_APP_DIST/.rust-core-checksum"

    # Create README
    cat > "$IOS_APP_DIST/README.md" << 'README_EOF'
# Rust Core iOS Library

Auto-generated from `/core/rust`. Do not edit manually.

## Contents

- `lib/device/libaliasvault_core.a` - Static library for iOS devices (arm64)
- `lib/simulator/libaliasvault_core.a` - Static library for iOS simulator (arm64 Apple Silicon)
- `Generated/` - Swift bindings generated by UniFFI

## Regenerate

```bash
cd /core/rust
./build.sh --ios
```

## Xcode Integration

The library is automatically built by the Xcode build phase which calls:
```bash
../../core/rust/build.sh --ios --incremental
```

Build settings use `RUST_LIB_PLATFORM` to select device vs simulator library.
README_EOF

    echo -e "${GREEN}Distributed to: $IOS_APP_DIST${NC}"
    ls -la "$IOS_APP_DIST/"
}

# ============================================
# Android Build (Multiple ABIs + Kotlin Bindings)
# ============================================
build_android() {
    echo ""
    echo -e "${BLUE}Building for Android...${NC}"

    local start_time=$(date +%s)

    # Incremental build check
    local checksum_file="$ANDROID_APP_DIST/.rust-core-checksum"
    local current_checksum=""
    current_checksum=$(compute_source_checksum "$SCRIPT_DIR/src")

    if $INCREMENTAL && [ "$FORCE_BUILD" = false ] && [ -f "$checksum_file" ] && [ -f "$ANDROID_APP_DIST/arm64-v8a/libaliasvault_core.so" ]; then
        local stored_checksum=$(cat "$checksum_file" 2>/dev/null || echo "")
        if [ "$current_checksum" = "$stored_checksum" ]; then
            echo -e "${GREEN}Rust Core is up to date, skipping build${NC}"
            ANDROID_BUILD_SKIPPED=true
            return 0
        fi
    fi
    ANDROID_BUILD_SKIPPED=false

    # Check for Android NDK
    if [ -z "${ANDROID_NDK_HOME:-}" ]; then
        # Try to find NDK in common locations
        if [ -d "$HOME/Library/Android/sdk/ndk" ]; then
            # Find the latest NDK version
            ANDROID_NDK_HOME=$(ls -d "$HOME/Library/Android/sdk/ndk"/*/ 2>/dev/null | sort -V | tail -1)
            ANDROID_NDK_HOME="${ANDROID_NDK_HOME%/}"
        elif [ -d "$HOME/Android/Sdk/ndk" ]; then
            ANDROID_NDK_HOME=$(ls -d "$HOME/Android/Sdk/ndk"/*/ 2>/dev/null | sort -V | tail -1)
            ANDROID_NDK_HOME="${ANDROID_NDK_HOME%/}"
        fi

        if [ -z "${ANDROID_NDK_HOME:-}" ]; then
            echo -e "${RED}Error: Android NDK not found${NC}"
            echo "Set ANDROID_NDK_HOME environment variable or install NDK via Android Studio"
            exit 1
        fi
    fi

    echo -e "  Using Android NDK: ${YELLOW}$ANDROID_NDK_HOME${NC}"

    # Install Android targets if needed
    echo -e "  Checking Android build targets..."
    for target in aarch64-linux-android armv7-linux-androideabi x86_64-linux-android; do
        if ! rustup target list --installed 2>/dev/null | grep -q "$target"; then
            echo -e "  Installing $target..."
            rustup target add "$target"
        fi
    done

    # Create output directories
    mkdir -p "$ANDROID_DIR/arm64-v8a"
    mkdir -p "$ANDROID_DIR/armeabi-v7a"
    mkdir -p "$ANDROID_DIR/x86_64"
    mkdir -p "$ANDROID_DIR/kotlin"

    local cargo_profile
    if $FAST_MODE; then
        cargo_profile="debug"
        cargo_flags=""
    else
        cargo_profile="release"
        cargo_flags="--release"
    fi

    # Set up Android toolchain
    local host_tag
    case "$(uname -s)" in
        Darwin) host_tag="darwin-x86_64" ;;
        Linux) host_tag="linux-x86_64" ;;
        *) host_tag="windows-x86_64" ;;
    esac

    local toolchain="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$host_tag"
    local api_level=24  # Android 7.0 minimum

    # Build for each ABI
    # Note: Use only 'uniffi' feature for library builds (not uniffi-cli which includes heavy bindgen deps)
    echo -e "  Building for arm64-v8a..."
    AR="$toolchain/bin/llvm-ar" \
    CC="$toolchain/bin/aarch64-linux-android${api_level}-clang" \
    CXX="$toolchain/bin/aarch64-linux-android${api_level}-clang++" \
    CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$toolchain/bin/aarch64-linux-android${api_level}-clang" \
    cargo build $cargo_flags --target aarch64-linux-android --features uniffi

    echo -e "  Building for armeabi-v7a..."
    AR="$toolchain/bin/llvm-ar" \
    CC="$toolchain/bin/armv7a-linux-androideabi${api_level}-clang" \
    CXX="$toolchain/bin/armv7a-linux-androideabi${api_level}-clang++" \
    CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER="$toolchain/bin/armv7a-linux-androideabi${api_level}-clang" \
    cargo build $cargo_flags --target armv7-linux-androideabi --features uniffi

    echo -e "  Building for x86_64..."
    AR="$toolchain/bin/llvm-ar" \
    CC="$toolchain/bin/x86_64-linux-android${api_level}-clang" \
    CXX="$toolchain/bin/x86_64-linux-android${api_level}-clang++" \
    CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER="$toolchain/bin/x86_64-linux-android${api_level}-clang" \
    cargo build $cargo_flags --target x86_64-linux-android --features uniffi

    # Copy libraries
    cp "target/aarch64-linux-android/$cargo_profile/libaliasvault_core.so" "$ANDROID_DIR/arm64-v8a/"
    cp "target/armv7-linux-androideabi/$cargo_profile/libaliasvault_core.so" "$ANDROID_DIR/armeabi-v7a/"
    cp "target/x86_64-linux-android/$cargo_profile/libaliasvault_core.so" "$ANDROID_DIR/x86_64/"

    # Strip debug symbols from shared libraries using NDK strip
    # This removes debug info while keeping symbols needed for JNI
    if ! $FAST_MODE; then
        echo -e "  Stripping debug symbols from libraries..."
        local llvm_strip="$toolchain/bin/llvm-strip"
        if [ -x "$llvm_strip" ]; then
            "$llvm_strip" --strip-debug "$ANDROID_DIR/arm64-v8a/libaliasvault_core.so" 2>/dev/null || true
            "$llvm_strip" --strip-debug "$ANDROID_DIR/armeabi-v7a/libaliasvault_core.so" 2>/dev/null || true
            "$llvm_strip" --strip-debug "$ANDROID_DIR/x86_64/libaliasvault_core.so" 2>/dev/null || true
        fi
    fi

    # Generate Kotlin bindings using UniFFI
    # Note: We need to build a native library first because UniFFI bindgen
    # cannot extract metadata from cross-compiled libraries
    echo -e "  Generating Kotlin bindings..."

    # Detect platform-specific library extension
    local native_lib_name
    case "$(uname -s)" in
        Darwin)
            native_lib_name="libaliasvault_core.dylib"
            ;;
        Linux)
            native_lib_name="libaliasvault_core.so"
            ;;
        MINGW*|MSYS*|CYGWIN*)
            native_lib_name="aliasvault_core.dll"
            ;;
        *)
            echo -e "${RED}Unsupported OS for Kotlin bindgen: $(uname -s)${NC}"
            exit 1
            ;;
    esac

    # Build native library for bindgen (if not already built)
    if [ ! -f "target/debug/$native_lib_name" ]; then
        echo -e "    Building native library for bindgen..."
        cargo build --features uniffi --lib
    fi

    # Generate bindings from native library
    cargo run --features uniffi-cli --bin uniffi-bindgen -- generate \
        --library "target/debug/$native_lib_name" \
        --language kotlin \
        --out-dir "$ANDROID_DIR/kotlin"

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # Show output sizes
    echo -e "${GREEN}Android build complete! (${duration}s)${NC}"
    for abi in arm64-v8a armeabi-v7a x86_64; do
        if [ -f "$ANDROID_DIR/$abi/libaliasvault_core.so" ]; then
            local size=$(ls -lh "$ANDROID_DIR/$abi/libaliasvault_core.so" | awk '{print $5}')
            echo -e "  $abi: ${YELLOW}$size${NC}"
        fi
    done

    if [ -d "$ANDROID_DIR/kotlin" ] && [ -n "$(ls -A "$ANDROID_DIR/kotlin" 2>/dev/null)" ]; then
        echo -e "  Kotlin bindings: ${GREEN}Generated${NC}"
    fi
}

# ============================================
# Android Distribution
# ============================================
distribute_android() {
    echo ""
    echo -e "${BLUE}Distributing to Android app...${NC}"

    # Copy native libraries to jniLibs
    for abi in arm64-v8a armeabi-v7a x86_64; do
        if [ -f "$ANDROID_DIR/$abi/libaliasvault_core.so" ]; then
            mkdir -p "$ANDROID_APP_DIST/$abi"
            cp "$ANDROID_DIR/$abi/libaliasvault_core.so" "$ANDROID_APP_DIST/$abi/"
            echo -e "  Copied $abi library"
        fi
    done

    # Copy Kotlin bindings to app source
    # UniFFI generates bindings in uniffi/aliasvault_core/ directory structure
    local kotlin_dist="$SCRIPT_DIR/../../apps/mobile-app/android/app/src/main/java/net/aliasvault/app/rustcore"
    if [ -d "$ANDROID_DIR/kotlin/uniffi" ]; then
        mkdir -p "$kotlin_dist"
        # Copy the entire uniffi directory to preserve package structure
        cp -r "$ANDROID_DIR/kotlin/uniffi" "$kotlin_dist/"
        echo -e "  Copied Kotlin bindings to $kotlin_dist/uniffi/"

        # List what was copied
        if [ -d "$kotlin_dist/uniffi/aliasvault_core" ]; then
            ls -lh "$kotlin_dist/uniffi/aliasvault_core"/*.kt 2>/dev/null || true
        fi
    else
        echo -e "${RED}Warning: Kotlin bindings not found at $ANDROID_DIR/kotlin/uniffi${NC}"
    fi

    # Save checksum for incremental builds
    local current_checksum=""
    current_checksum=$(compute_source_checksum "$SCRIPT_DIR/src")
    echo "$current_checksum" > "$ANDROID_APP_DIST/.rust-core-checksum"

    echo -e "${GREEN}Distributed to: $ANDROID_APP_DIST${NC}"
}

# ============================================
# Main Build Process
# ============================================
TOTAL_START=$(date +%s)

if $BUILD_BROWSER; then
    build_browser
    distribute_browser
fi

if $BUILD_DOTNET; then
    build_dotnet
    # Note: dotnet native libs are built to dist/dotnet/ but not distributed
    # Blazor WASM uses the WASM module via JS interop instead
    echo -e "${YELLOW}Note: Native library built to dist/dotnet/ (for server-side .NET use)${NC}"
fi

if $BUILD_IOS; then
    IOS_BUILD_SKIPPED=false
    build_ios
    if [ "$IOS_BUILD_SKIPPED" = false ]; then
        distribute_ios
    fi
fi

if $BUILD_ANDROID; then
    build_android
    distribute_android
fi

TOTAL_END=$(date +%s)
TOTAL_DURATION=$((TOTAL_END - TOTAL_START))

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Build completed in ${TOTAL_DURATION}s${NC}"
echo -e "${GREEN}========================================${NC}"
