#!/bin/bash
# Run on an isolated macOS Actions runner with a logged-in GUI session.
set -euo pipefail
shipped="$1"
version="$2"
scratch="$(mktemp -d)"
scratch="$(cd "$scratch" && pwd -P)"
token="$(uuidgen)"
updates="$HOME/Library/Caches/com.pmeir99.MacOS-Filter/Updates"
workspace="$updates/$token"
old="$scratch/MacOS Filter.app"
cleanup() {
  python3 - "$old/Contents/MacOS/MacOSFilter" <<'PY'
import os, signal, subprocess, sys
for line in subprocess.check_output(["ps", "-axo", "pid=,command="], text=True).splitlines():
    match = line.strip().split(None, 1)
    if len(match) == 2 and (match[1] == sys.argv[1] or match[1].startswith(sys.argv[1] + " ")):
        try: os.kill(int(match[0]), signal.SIGTERM)
        except ProcessLookupError: pass
PY
  rm -rf "$scratch" "$workspace"
}
trap cleanup EXIT
mkdir -p "$workspace/unpacked" "$old/Contents/MacOS" "$old/Contents/Helpers"
chmod 700 "$workspace"
ditto "$shipped" "$workspace/unpacked/MacOS Filter.app"
cp "$shipped/Contents/Helpers/FilterUpdate" "$old/Contents/Helpers/"
cp "$shipped/Contents/Info.plist" "$old/Contents/"
plutil -replace CFBundleShortVersionString -string 0.0.1 "$old/Contents/Info.plist"
# Stand in for the outgoing GUI process. The helper checks the parent's real
# executable path and waits for its PID to exit before it can swap the bundle.
cat > "$scratch/outgoing.c" <<'C'
#include <unistd.h>
#include <stdio.h>
#include <sys/wait.h>
int main(int argc, char **argv) {
    if (argc != 6) return 2;
    char parent[32];
    snprintf(parent, sizeof parent, "%d", getpid());
    pid_t child = fork();
    if (child < 0) return 3;
    if (child == 0) {
        execl(argv[1], argv[1], "--install", argv[2], argv[3], parent, argv[4], NULL);
        _exit(4);
    }
    for (int i = 0; i < 1200; i++) {
        if (access(argv[5], F_OK) == 0) return 0;
        if (waitpid(child, NULL, WNOHANG) == child) return 5;
        usleep(100000);
    }
    return 6;
}
C
clang "$scratch/outgoing.c" -o "$old/Contents/MacOS/MacOSFilter"
"$old/Contents/MacOS/MacOSFilter" "$old/Contents/Helpers/FilterUpdate" "$workspace/unpacked/MacOS Filter.app" "$version" "$token" "$workspace/ready"
# Only a receipt from the real relaunched app lets the helper remove its workspace.
for ((i=0; i<600; i++)); do
  [[ -d "$workspace" ]] || break
  sleep .1
done
if [[ -d "$workspace" ]]; then
  cat "$updates/last-error" >&2 || true
  exit 1
fi
"$old/Contents/Helpers/FilterUpdate" --verify "$old" "$version"
