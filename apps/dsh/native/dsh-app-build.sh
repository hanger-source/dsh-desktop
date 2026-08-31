#!/bin/bash
# 构建 DSH Desktop 原生 App 与随 App 发布的静态 runtime。
# 用法: bash dsh-app-build.sh [输出 App] [图标目录] [版本号]
set -euo pipefail

APP="${1:-$HOME/Applications/DSH.app}"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SRC_DIR/../../.." && pwd)"
WORK="${2:-$SRC_DIR}"
VERSION="${3:-0.0.0-dev}"
BIN_DIR="$APP/Contents/MacOS"
RS_DIR="$APP/Contents/Resources"
ICON_SRC="$WORK"

mkdir -p "$BIN_DIR" "$RS_DIR"

# --- Swift 源码：原生壳按职责拆分，统一从本目录编译 ---
SWIFT_SOURCES=(DSHApp.swift Runtime.swift DSHWindow.swift StartupPageController.swift AppUpdater.swift AppUpdateController.swift)
for source in "${SWIFT_SOURCES[@]}"; do
  if [ ! -f "$SRC_DIR/$source" ]; then
    echo "缺少 $SRC_DIR/$source" >&2; exit 1
  fi
  cp "$SRC_DIR/$source" "$BIN_DIR/$source"
done

RUNTIME_SRC="$REPO_ROOT/apps/dsh/runtime"
[ -f "$RUNTIME_SRC/host/index.js" ] || { echo "缺少 App Host runtime" >&2; exit 1; }
[ -f "$RUNTIME_SRC/client/package.json" ] || { echo "缺少 App Client runtime" >&2; exit 1; }
rm -rf "$RS_DIR/runtime"
ditto "$RUNTIME_SRC" "$RS_DIR/runtime"

# --- Info.plist ---
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>DSHApp</string>
  <key>CFBundleIdentifier</key><string>com.hanger.dsh-desktop</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>DSH</string>
  <key>CFBundleDisplayName</key><string>DeepSeek Harness</string>
  <key>CFBundleShortVersionString</key><string>__VERSION__</string>
  <key>CFBundleVersion</key><string>__BUILD__</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
</dict>
</plist>
PLIST
BUILD="$(printf '%s' "$VERSION" | tr -cd '0-9' | cut -c1-12)"
[ -n "$BUILD" ] || BUILD=1
sed -i '' "s/__VERSION__/$VERSION/g; s/__BUILD__/$BUILD/g" "$APP/Contents/Info.plist"

# --- 编译 ---
swiftc -O -swift-version 5 -o "$BIN_DIR/DSHApp" \
  "${SWIFT_SOURCES[@]/#/$BIN_DIR/}" \
  -framework AppKit -framework WebKit
for source in "${SWIFT_SOURCES[@]}"; do
  rm -f "$BIN_DIR/$source"
done

# --- 图标 ---
if [ -f "$ICON_SRC/icon-512.png" ]; then
  ISET="$RS_DIR/icon.iconset"
  mkdir -p "$ISET"
  for sz in 16 32 128 256 512; do
    sips -z $sz $sz "$ICON_SRC/icon-512.png" --out "$ISET/icon_${sz}x${sz}.png" >/dev/null
    d=$((sz * 2))
    sips -z $d $d "$ICON_SRC/icon-512.png" --out "$ISET/icon_${sz}x${sz}@2x.png" >/dev/null
  done
  iconutil -c icns "$ISET" -o "$RS_DIR/icon.icns"
  rm -rf "$ISET"
fi

# --- 签名 ---
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

echo "DSH.app ready at $APP"
