#!/usr/bin/env python3
"""
Builds the privileged apps list in res/raw/privileged_apps.json of the Android app: the browsers that AliasVault trusts to request credentials
on behalf of websites, for autofill and passkeys. Called by 02-refresh-external-dependencies.sh (task privileged-apps),
which downloads the input files.

Steps:
1. Pull the external lists: Google's privileged-apps list and the community lists of other trusted open-source
   projects.
2. Optionally add manually reviewed and trusted entries from MANUALLY_TRUSTED (currently empty).
3. Remove the keys in EXCLUDED_KEYS and every signature not marked "release".
"""

import argparse
import hashlib
import json

# Optional entries that can be added on top of the community lists. Currently empty on purpose.
# Key: (package, fingerprint). Value: how it was checked.
MANUALLY_TRUSTED = {
    # ("org.example.browser", "AA:BB:...:FF"): "apksigner on the v1.0.0 GitHub release, 2026-01-01",
}

# Keys removed from every pulled list. These are the test keys that ship with the Android source code
# (build/target/product/security), so their private keys are public: anyone can sign an app with them and pass as
# the browser they are listed for. Google's list includes one of them for Samsung Internet test builds.
EXCLUDED_KEYS = {
    "C8:A2:E9:BC:CF:59:7C:2F:B6:DC:66:BE:E2:93:FC:13:F2:FC:47:EC:77:BC:6B:2B:0D:52:C1:1F:51:19:2A:B8": "AOSP platform test key",
    "A4:0D:A8:0A:59:D1:70:CA:A9:50:CF:15:C1:8C:45:4D:47:A3:9B:26:98:9D:8B:64:0E:CD:74:5B:A7:1B:F5:DC": "AOSP testkey",
    "46:59:83:F7:79:1F:2A:BE:B4:3E:A2:CB:DC:7F:21:A8:26:0B:72:BC:08:A5:5C:83:9F:C1:A4:3B:C7:41:A8:1E": "AOSP media test key",
    "28:BB:FE:4A:7B:97:E7:46:81:DC:55:C2:FB:B6:CC:B8:D6:C7:49:63:73:3F:6A:F6:AE:74:D8:C3:A6:E8:79:FD": "AOSP shared test key",
}

def normalize(fingerprint):
    """Fingerprint as uppercase colon-separated hex, or None when it is not a SHA-256."""
    hex_only = fingerprint.replace(":", "").strip().upper()
    if len(hex_only) != 64 or any(c not in "0123456789ABCDEF" for c in hex_only):
        return None
    return ":".join(hex_only[i:i + 2] for i in range(0, 64, 2))


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def signatures(document):
    """(package, fingerprint, build) for every Android signature in a privileged-apps list."""
    for app in document.get("apps", []):
        package = app.get("info", {}).get("package_name")
        if app.get("type") != "android" or not package:
            continue
        for sig in app["info"].get("signatures", []):
            fingerprint = normalize(sig.get("cert_fingerprint_sha256", ""))
            if fingerprint:
                yield package, fingerprint, sig.get("build")


class Allowlist:
    """Package -> fingerprint -> (build, sources), in insertion order, plus a report of every change."""

    def __init__(self):
        self.entries = {}
        self.added = []
        self.removed = []

    def contains(self, package, fingerprint):
        return fingerprint in self.entries.get(package, {})

    def add(self, package, fingerprint, build, sources):
        entry = self.entries.setdefault(package, {}).setdefault(fingerprint, {"build": build, "sources": set()})
        if build == "release":
            entry["build"] = "release"
        entry["sources"].update(sources)

    def remove(self, package, fingerprint, reason):
        sources = "/".join(sorted(self.entries[package].pop(fingerprint)["sources"]))
        self.removed.append(f"{sources:<11} {package} {fingerprint[:23]}... ({reason})")
        if not self.entries[package]:
            del self.entries[package]


def pull_external(allowlist, google, communities):
    """Step 1: Google's list and the community lists."""
    for package, fingerprint, build in signatures(google):
        allowlist.add(package, fingerprint, build, {"Google"})
    for vendor, document in communities:
        for package, fingerprint, build in signatures(document):
            if not allowlist.contains(package, fingerprint):
                allowlist.added.append(f"{vendor:<11} {package} {fingerprint[:23]}...")
            allowlist.add(package, fingerprint, build, {vendor})


def add_manually_trusted(allowlist):
    """Step 2: manually reviewed and trusted entries."""
    for (package, fingerprint), note in MANUALLY_TRUSTED.items():
        if not allowlist.contains(package, fingerprint):
            allowlist.add(package, fingerprint, "release", {"manual"})
            allowlist.added.append(f"{'manual':<11} {package} {fingerprint[:23]}... ({note})")


def remove_excluded(allowlist):
    """Step 3: excluded keys and non-release signatures."""
    for package in list(allowlist.entries):
        for fingerprint, entry in list(allowlist.entries[package].items()):
            if fingerprint in EXCLUDED_KEYS:
                allowlist.remove(package, fingerprint, EXCLUDED_KEYS[fingerprint])
            elif entry["build"] != "release":
                allowlist.remove(package, fingerprint, f"build '{entry['build']}'")


def to_json(allowlist, sources, today):
    """The list in the privileged-apps format; the extra underscore fields are ignored by CallingAppInfo.getOrigin()."""
    output = {
        "_generated": f"Built by scripts/dependencies/02-refresh-external-dependencies.sh (task privileged-apps) on {today}; do not edit by hand.",
        "_sources": sources,
        "apps": [
            {"type": "android", "info": {"package_name": package, "signatures": [{"build": "release", "cert_fingerprint_sha256": fp} for fp in fps]}}
            for package, fps in allowlist.entries.items()
        ],
    }
    return json.dumps(output, indent=2) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--google", nargs=2, metavar=("URL", "FILE"), required=True, help="Google's privileged-apps list")
    parser.add_argument("--community", nargs=3, metavar=("VENDOR", "URL", "FILE"), action="append", default=[],
                        help="community list; URL should name the commit it was fetched at")
    parser.add_argument("--today", required=True, help="refresh date written into the header")
    parser.add_argument("--out", required=True, help="JSON file to write")
    args = parser.parse_args()

    google_url, google_path = args.google
    with open(google_path, "rb") as f:
        google_bytes = f.read()

    allowlist = Allowlist()
    pull_external(allowlist, json.loads(google_bytes), [(vendor, load_json(path)) for vendor, _, path in args.community])
    add_manually_trusted(allowlist)
    remove_excluded(allowlist)

    # Google's list has no commit to point at, so the content hash stands in for it.
    sources = [f"{google_url} (sha256 {hashlib.sha256(google_bytes).hexdigest()[:16]})"] + [url for _, url, _ in args.community]
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(to_json(allowlist, sources, args.today))

    print(f"  {len(allowlist.entries)} packages, {sum(len(v) for v in allowlist.entries.values())} fingerprints")
    print("  Added on top of Google's list:")
    for line in allowlist.added:
        print("    + " + line)
    print("  Left out:")
    for line in allowlist.removed:
        print("    - " + line)


if __name__ == "__main__":
    main()
