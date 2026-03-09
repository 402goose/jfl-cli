#!/usr/bin/env bash
set -euo pipefail

echo "PATH=$PATH"

if command -v jfl >/dev/null 2>&1; then
  echo "existing jfl before install: $(command -v jfl)"
  jfl --version || true
fi

if [ -n "${JFL_LOCAL_PATH:-}" ] && [ -e "${JFL_LOCAL_PATH}" ]; then
  echo "Installing local jfl from ${JFL_LOCAL_PATH}"
  npm rm -g jfl >/dev/null 2>&1 || true
  rm -f /usr/local/bin/jfl
  hash -r
  npm install -g "${JFL_LOCAL_PATH}"
elif [ -n "${JFL_TGZ_PATH:-}" ] && [ -f "${JFL_TGZ_PATH}" ]; then
  echo "Installing jfl from tarball ${JFL_TGZ_PATH}"
  npm rm -g jfl >/dev/null 2>&1 || true
  rm -f /usr/local/bin/jfl
  hash -r
  npm install -g "${JFL_TGZ_PATH}"
else
  JFL_VERSION="${JFL_VERSION:-0.3.0}"
  echo "Installing jfl@${JFL_VERSION}"
  npm rm -g jfl >/dev/null 2>&1 || true
  rm -f /usr/local/bin/jfl
  hash -r
  npm install -g "jfl@${JFL_VERSION}"
fi

hash -r

echo "resolved jfl: $(command -v jfl)"
jfl --version || true

exec "$@"