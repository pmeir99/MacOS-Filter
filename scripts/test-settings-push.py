"""Exercise a live packaged native host. Run only with an isolated home."""
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import os

with tempfile.TemporaryDirectory() as home:
    process = subprocess.Popen([sys.argv[1], "chrome-extension://" + "a"*32 + "/"],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               env={**os.environ, "CFFIXED_USER_HOME": home, "HOME": home})
    def read():
        import select
        assert select.select([process.stdout], [], [], 5)[0], "settings push timed out"
        length, = struct.unpack("<I", process.stdout.read(4))
        return json.loads(process.stdout.read(length))
    try:
        payload = json.dumps({"protocolVersion":1, "requestID":"first", "action":"subscribe"}).encode()
        process.stdin.write(struct.pack("<I", len(payload)) + payload)
        process.stdin.flush()
        initial = read()["settings"]
        initial["enabled"] = not initial["enabled"]
        file = Path(home, "Library/Application Support/MacOSFilter/settings.json")
        file.parent.mkdir(parents=True, exist_ok=True)
        tmp = file.with_suffix(".tmp")
        tmp.write_text(json.dumps(initial))
        tmp.replace(file)
        event = read()
        assert event["requestID"] == "settingsChanged" and event["settings"] == initial, event
    finally:
        process.stdin.close()
        process.wait(timeout=10)
