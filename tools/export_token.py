#!/usr/bin/env python3
"""
export_token.py — Erzeugt den Wert für das GitHub-Secret GARMINTOKENS.

Liest deinen lokalen Garmin-Token-Store (garth, vom Garmin MCP angelegt),
packt die Token-Dateien als base64(JSON) zusammen. Den ausgegebenen String
1:1 als Repository-Secret GARMINTOKENS hinterlegen.

Aufruf:  python tools/export_token.py
"""
import os, sys, json, base64, glob

CANDIDATES = [
    os.environ.get("GARTH_HOME"),
    os.environ.get("GARMINTOKENS"),
    os.path.expanduser("~/.garminconnect"),
    os.path.expanduser("~/.garth"),
    os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "garth"),
]


def find_store():
    for c in CANDIDATES:
        if c and os.path.isdir(c) and glob.glob(os.path.join(c, "*token*")):
            return c
    return None


def main():
    store = find_store()
    if not store:
        sys.exit("Kein Garmin-Token-Store gefunden. Erst einmal über den Garmin MCP / "
                 "garminconnect einloggen, dann erneut versuchen. Geprüft: " +
                 ", ".join(str(c) for c in CANDIDATES if c))
    files = {}
    for path in glob.glob(os.path.join(store, "*")):
        if os.path.isfile(path):
            with open(path, encoding="utf-8") as fh:
                files[os.path.basename(path)] = fh.read()
    blob = base64.b64encode(json.dumps(files).encode("utf-8")).decode("ascii")
    print(f"# Token-Store: {store}  ({len(files)} Dateien)")
    print("# Folgenden String als GitHub-Secret GARMINTOKENS speichern:\n")
    print(blob)


if __name__ == "__main__":
    main()
