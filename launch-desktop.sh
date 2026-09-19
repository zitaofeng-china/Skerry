#!/bin/sh
set -e
cd "$(dirname "$0")"
exe="src-tauri/target/release/skerry"
if [ ! -x "$exe" ]; then
  echo "首次启动需要构建桌面程序。"
  npm run desktop:build
fi
exec "./$exe"
