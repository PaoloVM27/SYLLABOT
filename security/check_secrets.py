"""Scan tracked/current files and Git history; report locations, never secret values."""
import json
from pathlib import Path
import re
import subprocess
import sys

PATTERNS = {
    "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "github_token": re.compile(rb"\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"),
    "credential_literal": re.compile(rb"(?im)(?:GEMINI_API_KEY|GOOGLE_API_KEY|AWS_SECRET_ACCESS_KEY|VERCEL_TOKEN|RENDER_API_KEY)\s*[:=]\s*[\"']?[A-Za-z0-9_./+=-]{20,}"),
}
TEXT_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".json", ".yaml", ".yml", ".md", ".txt", ".mjs", ".env"}


def main():
    findings = []

    def scan(data, location):
        for name, pattern in PATTERNS.items():
            if pattern.search(data):
                findings.append({"location": location, "kind": name})

    files = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard"], text=True).splitlines()
    for filename in files:
        path = Path(filename)
        if path.is_file() and path.suffix.lower() in TEXT_EXTENSIONS:
            scan(path.read_bytes(), filename)
    objects = subprocess.check_output(["git", "rev-list", "--objects", "--all"], text=True).splitlines()
    scanned = 0
    for obj in objects:
        parts = obj.split(" ", 1)
        if len(parts) != 2 or Path(parts[1]).suffix.lower() not in TEXT_EXTENSIONS:
            continue
        oid, path = parts
        data = subprocess.check_output(["git", "cat-file", "blob", oid], stderr=subprocess.DEVNULL)
        scan(data, "git:" + oid[:12] + ":" + path)
        scanned += 1
    report = {"history_blobs_scanned": scanned, "findings": findings,
              "scope": "Pattern-based scan; locations only, no credential values. Firebase public configuration is not a server secret."}
    print(json.dumps(report, indent=2))
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
