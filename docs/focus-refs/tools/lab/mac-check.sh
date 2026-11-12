#!/bin/bash
# Build and test check ON THE MAC for work done from a session that cannot run Swift or Xcode itself.
# It only ever runs the fixed commands below: ReplayCore's `swift test` and an Xcode build of the app (no signing).
#
#   bash docs/focus-refs/tools/lab/mac-check.sh            # once: swift tests + iOS build
#   bash docs/focus-refs/tools/lab/mac-check.sh --watch    # stays open; runs again each time Claude asks
#
# In --watch mode Claude asks by writing one word (swift | ios | all) to lab/tests/build/request; results go to
# lab/tests/build/{swift-test.log,ios-build.log,status.txt}. Stop it with Ctrl-C.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
OUT="$ROOT/docs/focus-refs/lab/tests/build"
CORE="$ROOT/app/modules/replay-camera/ios/Core"
[ "$(uname -s)" = "Darwin" ] || { echo "Run this on the Mac (macOS)."; exit 1; }
mkdir -p "$OUT"

run_swift() {
  echo "== swift test (ReplayCore)"
  ( cd "$CORE" && swift test 2>&1 ) > "$OUT/swift-test.log"
  local code=$?
  grep -E "error:|failed|Executed [0-9]+ tests" "$OUT/swift-test.log" | tail -40 > "$OUT/swift-test.summary.txt"
  echo "swift=$code" >> "$OUT/status.tmp"
  tail -3 "$OUT/swift-test.summary.txt"
}

run_ios() {
  # A Swift file added to the module is not in the Pods project until `pod install` runs again.
  local stale=0
  while IFS= read -r f; do
    grep -q "$(basename "$f")" "$ROOT/app/ios/Pods/Pods.xcodeproj/project.pbxproj" || stale=1
  done < <(find "$ROOT/app/modules/replay-camera/ios" -name '*.swift' -not -path '*/Tests/*' -not -name 'Package.swift' -not -path '*/.build/*')
  if [ "$stale" = 1 ]; then
    echo "== pod install (new Swift files in the module)"
    ( cd "$ROOT/app/ios" && pod install 2>&1 ) > "$OUT/pod-install.log"
    echo "pods=$?" >> "$OUT/status.tmp"
  fi
  echo "== xcodebuild (Reprize, iOS device, Release, no signing)"
  ( cd "$ROOT/app/ios" && xcodebuild -workspace Reprize.xcworkspace -scheme Reprize -configuration Release \
      -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build 2>&1 ) > "$OUT/ios-build.log"
  local code=$?
  grep -E "error:|warning: .*replay-camera|BUILD SUCCEEDED|BUILD FAILED|\*\* " "$OUT/ios-build.log" | sort -u | tail -80 > "$OUT/ios-build.summary.txt"
  echo "ios=$code" >> "$OUT/status.tmp"
  tail -3 "$OUT/ios-build.summary.txt"
}

run() {
  : > "$OUT/status.tmp"
  case "$1" in
    swift) run_swift ;;
    ios) run_ios ;;
    all) run_swift; run_ios ;;
    *) echo "unknown request: $1"; echo "unknown=1" >> "$OUT/status.tmp" ;;
  esac
  echo "what=$1" >> "$OUT/status.tmp"
  echo "finished=$(date '+%Y-%m-%d %H:%M:%S')" >> "$OUT/status.tmp"
  mv "$OUT/status.tmp" "$OUT/status.txt"
}

if [ "${1:-}" = "--watch" ]; then
  echo "Watching $OUT/request (Ctrl-C to stop)."
  rm -f "$OUT/request"
  date '+%Y-%m-%d %H:%M:%S' > "$OUT/watching"
  trap 'rm -f "$OUT/watching"' EXIT
  while true; do
    if [ -f "$OUT/request" ]; then
      what="$(tr -cd 'a-z' < "$OUT/request" | head -c 8)"
      rm -f "$OUT/request" "$OUT/status.txt"
      echo "--- $(date '+%H:%M:%S') request: $what"
      # a fresh copy of this script each time, so a fix to the commands above needs no restart
      case "$what" in swift|ios|all) bash "$0" --run "$what" ;; *) echo "unknown request" ;; esac
      echo "--- done"
    fi
    date '+%Y-%m-%d %H:%M:%S' > "$OUT/watching"
    sleep 3
  done
elif [ "${1:-}" = "--run" ]; then
  run "${2:-all}"
else
  run all
  echo "Done. Results in $OUT. Tell Claude."
fi
