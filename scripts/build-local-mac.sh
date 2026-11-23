#!/usr/bin/env bash
set -euo pipefail

# Build, ad-hoc sign, and optionally install a local macOS Orca.app.
# Designed for clean execution on any macOS machine after cloning/pulling this fork.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FAST=0
FORCE_DEPS=0
RUN_TYPECHECK=0
INSTALL_APP=0
UNINSTALL_BREW=0
DRY_RUN=0
SIGN_IDENTITY="${ORCA_LOCAL_SIGN_IDENTITY:--}"

usage() {
  cat <<'EOF'
Usage: ./scripts/build-local-mac.sh [options]

Build a local macOS Orca.app (default: ad-hoc signed, no DMG, no network notarization).

Options:
  --fast             Incremental rebuild (reuse existing wsl-guest, mobile-web, and Swift helpers)
  --deps             Force pnpm install for root and mobile/ before building
  --typecheck        Run `pnpm run tc` before building
  --install          Install built Orca.app to /Applications/Orca.app and link `orca` CLI
  --uninstall-brew   With --install, automatically run `brew uninstall --cask orca` (keeps user data)
  --sign <identity>  Codesign identity (default: "-" for ad-hoc; or env ORCA_LOCAL_SIGN_IDENTITY)
  --dry-run          Print detected environment and planned commands without executing
  -h, --help         Show this help message

Examples:
  # First-time build & install on a new Mac:
  ./scripts/build-local-mac.sh --install --uninstall-brew

  # Fast rebuild after pulling JS/TS changes:
  ./scripts/build-local-mac.sh --fast --install
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fast)
      FAST=1
      shift
      ;;
    --deps)
      FORCE_DEPS=1
      shift
      ;;
    --typecheck)
      RUN_TYPECHECK=1
      shift
      ;;
    --install)
      INSTALL_APP=1
      shift
      ;;
    --uninstall-brew)
      UNINSTALL_BREW=1
      shift
      ;;
    --sign)
      if [[ $# -lt 2 ]]; then
        echo "Error: --sign requires an identity argument" >&2
        exit 1
      fi
      SIGN_IDENTITY="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown option '$1'" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: this script only supports macOS (Darwin)." >&2
  exit 1
fi

for cmd in node pnpm git codesign ditto; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: required command '$cmd' not found in PATH." >&2
    exit 1
  fi
done

UNAME_ARCH="$(uname -m)"
case "$UNAME_ARCH" in
  arm64)
    ARCH_FLAG="arm64"
    APP_PATH="$ROOT_DIR/dist/mac-arm64/Orca.app"
    DEFAULT_CLI_BIN_DIR="/opt/homebrew/bin"
    ;;
  x86_64)
    ARCH_FLAG="x64"
    APP_PATH="$ROOT_DIR/dist/mac/Orca.app"
    DEFAULT_CLI_BIN_DIR="/usr/local/bin"
    ;;
  *)
    echo "Error: unsupported macOS architecture '$UNAME_ARCH'." >&2
    exit 1
    ;;
esac

if [[ -z "${DEVELOPER_DIR:-}" && -d "/Applications/Xcode.app/Contents/Developer" ]]; then
  export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
fi

export ORCA_CLI_BUILD_COMPILER="${ORCA_CLI_BUILD_COMPILER:-tsrs}"

run() {
  echo "+ $*"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    "$@"
  fi
}

echo "==> Orca local macOS build"
echo "    repo:      $ROOT_DIR"
echo "    arch:      $ARCH_FLAG"
echo "    mode:      $([[ "$FAST" -eq 1 ]] && echo "fast" || echo "full")"
echo "    sign:      $SIGN_IDENTITY"
echo "    install:   $([[ "$INSTALL_APP" -eq 1 ]] && echo "/Applications/Orca.app" || echo "no")"
echo "    compiler:  ORCA_CLI_BUILD_COMPILER=$ORCA_CLI_BUILD_COMPILER"
[[ -n "${DEVELOPER_DIR:-}" ]] && echo "    xcode:     DEVELOPER_DIR=$DEVELOPER_DIR"

# 1. Dependencies
if [[ "$FORCE_DEPS" -eq 1 || ! -d "$ROOT_DIR/node_modules" ]]; then
  run pnpm install --frozen-lockfile
fi
if [[ "$FORCE_DEPS" -eq 1 || ! -d "$ROOT_DIR/mobile/node_modules" ]]; then
  run pnpm -C mobile install --frozen-lockfile
fi

# 2. Optional typecheck
if [[ "$RUN_TYPECHECK" -eq 1 ]]; then
  run pnpm run tc
fi

# 3. Build assets
if [[ "$FAST" -eq 0 || ! -f "$ROOT_DIR/out/relay/wsl/wsl-agent-hook-relay.js" ]]; then
  run pnpm run build:wsl-guest
fi

run pnpm run build:cli
run pnpm run build:electron-vite
run pnpm run verify:built-skills-cli
run pnpm run build:web-from-renderer

if [[ "$FAST" -eq 0 || ! -d "$ROOT_DIR/out/mobile-web" ]]; then
  run pnpm run build:mobile-web
fi

# 4. Native macOS Swift helpers
if [[ "$FAST" -eq 0 || ! -d "$ROOT_DIR/native/computer-use-macos/.build/release/Orca Computer Use.app" ]]; then
  run pnpm run build:computer-macos
fi
if [[ "$FAST" -eq 0 || ! -f "$ROOT_DIR/native/keyboard-layout-macos/.build/release/orca-keyboard-layout" ]]; then
  run pnpm run build:keyboard-layout-macos
fi
if [[ "$FAST" -eq 0 || ! -f "$ROOT_DIR/native/process-footprint-macos/.build/release/orca-process-footprint" ]]; then
  run pnpm run build:process-footprint-macos
fi
if [[ "$FAST" -eq 0 || ! -f "$ROOT_DIR/native/notification-status-macos/.build/release/orca-notification-status" ]]; then
  run pnpm run build:notification-status-macos
fi

run pnpm run ensure:electron-runtime

# 5. Compute local version identity (same format as upstream build-mac-local.mjs)
BUILD_IDENTITY_JSON="$(node -e "import('./config/scripts/desktop-distribution/macos/build-mac-local.mjs').then(m => console.log(JSON.stringify(m.getLocalBuildIdentity())))")"
ORCA_BUILD_COMMIT="$(node -e "const d = JSON.parse(process.argv[1]); console.log(d.commit)" "$BUILD_IDENTITY_JSON")"
ORCA_LOCAL_BUILD_VERSION="$(node -e "const d = JSON.parse(process.argv[1]); console.log(d.version)" "$BUILD_IDENTITY_JSON")"
echo "==> Packaging version: $ORCA_LOCAL_BUILD_VERSION (commit $ORCA_BUILD_COMMIT)"

# 6. Package macOS .app directory (skip auto cert discovery for fast offline builds)
run env \
  CSC_IDENTITY_AUTO_DISCOVERY=false \
  ORCA_BUILD_COMMIT="$ORCA_BUILD_COMMIT" \
  ORCA_LOCAL_BUILD_VERSION="$ORCA_LOCAL_BUILD_VERSION" \
  pnpm exec electron-builder \
    --config config/electron-builder.config.cjs \
    --mac dir \
    "--$ARCH_FLAG"

# 7. Sign & verify
ENTITLEMENTS_PATH="$ROOT_DIR/resources/build/entitlements.mac.plist"
if [[ "$SIGN_IDENTITY" == "-" ]]; then
  run codesign --force --deep --sign - --entitlements "$ENTITLEMENTS_PATH" "$APP_PATH"
else
  run codesign --force --deep --sign "$SIGN_IDENTITY" --timestamp=none --entitlements "$ENTITLEMENTS_PATH" "$APP_PATH"
fi
run codesign --verify --verbose=2 "$APP_PATH"

echo "==> Built & signed: $APP_PATH"

# 8. Optional install to /Applications/Orca.app
if [[ "$INSTALL_APP" -eq 1 ]]; then
  if command -v brew >/dev/null 2>&1 && brew list --cask orca >/dev/null 2>&1; then
    if [[ "$UNINSTALL_BREW" -eq 1 ]]; then
      echo "==> Detaching Homebrew cask 'orca' (keeping ~/Library/Application Support/orca)..."
      run brew uninstall --cask orca
    else
      echo "Error: Homebrew cask 'orca' is currently installed." >&2
      echo "Re-run with --uninstall-brew, or run: brew uninstall --cask orca" >&2
      exit 1
    fi
  fi

  if pgrep -f '^/Applications/Orca\.app/Contents/MacOS/Orca$' >/dev/null 2>&1; then
    echo "Error: /Applications/Orca.app is currently running. Quit Orca first, then re-run with --install." >&2
    exit 1
  fi

  echo "==> Installing to /Applications/Orca.app..."
  if [[ -d "/Applications/Orca.app" ]]; then
    run rm -rf /Applications/Orca.app
  fi
  run ditto "$APP_PATH" /Applications/Orca.app
  if [[ "$DRY_RUN" -eq 0 ]]; then
    xattr -dr com.apple.quarantine /Applications/Orca.app 2>/dev/null || true
  else
    echo "+ xattr -dr com.apple.quarantine /Applications/Orca.app"
  fi
  run codesign --verify --verbose=2 /Applications/Orca.app

  if [[ -d "$DEFAULT_CLI_BIN_DIR" && -w "$DEFAULT_CLI_BIN_DIR" ]]; then
    run ln -sf /Applications/Orca.app/Contents/Resources/bin/orca "$DEFAULT_CLI_BIN_DIR/orca"
  else
    echo "Note: skipped linking 'orca' CLI ($DEFAULT_CLI_BIN_DIR not writable)."
  fi

  echo "==> Installed /Applications/Orca.app successfully."
fi
