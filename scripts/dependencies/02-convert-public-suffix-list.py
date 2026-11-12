#!/usr/bin/env python3
"""
Rewrite the upstream Public Suffix List into the rules-only form the Rust core embeds. Called by
02-refresh-external-dependencies.sh (task public-suffix-list), which downloads the input.
"""

import argparse
import re
import sys

MIN_RULES = 5000

LICENSE_NOTICE = [
    "// This Source Code Form is subject to the terms of the Mozilla Public",
    "// License, v. 2.0. If a copy of the MPL was not distributed with this",
    "// file, You can obtain one at https://mozilla.org/MPL/2.0/.",
]

def to_ascii(rule):
    """Rule with every label except '*' converted to its ASCII form."""
    prefix = "!" if rule.startswith("!") else ""
    labels = [label if label == "*" else label.encode("idna").decode("ascii") for label in rule[len(prefix):].split(".")]
    return prefix + ".".join(labels)


def convert(lines):
    """Upstream version plus the converted lines (section markers and rules)."""
    version = next((l[len("// VERSION:"):].strip() for l in lines if l.startswith("// VERSION:")), None)
    if version is None or "// ===BEGIN ICANN DOMAINS===" not in lines or "// ===END PRIVATE DOMAINS===" not in lines:
        sys.exit("ERROR: downloaded content does not look like the Public Suffix List")

    out = []
    for line in lines:
        if line.startswith("// ===") and line.endswith("==="):
            out.append(line)
            continue
        rule = line.split()[0] if line.strip() else ""
        if not rule or rule.startswith("//"):
            continue
        if not re.fullmatch(r"!?(\*|[^\s.!*]+)(\.[^\s.!*]+)*", rule):
            sys.exit(f"ERROR: unexpected rule syntax: {line}")
        out.append(to_ascii(rule.lower()))
    return version, out


def main():
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--url", required=True, help="where the list was downloaded from")
    parser.add_argument("--today", required=True, help="refresh date written into the header")
    parser.add_argument("raw", help="downloaded public_suffix_list.dat")
    parser.add_argument("target", help="file to write the converted list to")
    args = parser.parse_args()

    with open(args.raw, encoding="utf-8") as f:
        version, out = convert(f.read().splitlines())

    rule_count = sum(1 for line in out if not line.startswith("//"))
    if rule_count < MIN_RULES:
        sys.exit(f"ERROR: only {rule_count} rules parsed, refusing to write a truncated list")

    header = [
        "// Mozilla Public Suffix List, rules only: comments and blank lines stripped, non-ASCII rules in ASCII form.",
        f"// Source: {args.url}",
        f"// Upstream version: {version}",
        f"// Last refreshed: {args.today} by scripts/dependencies/02-refresh-external-dependencies.sh (task public-suffix-list)",
        "//",
    ] + LICENSE_NOTICE

    with open(args.target, "w", encoding="utf-8") as f:
        f.write("\n".join(header + out) + "\n")

    print(f"  {rule_count} rules, upstream version {version}")


if __name__ == "__main__":
    main()
