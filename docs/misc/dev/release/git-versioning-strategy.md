---
layout: default
title: Git versioning strategy
parent: Release
grand_parent: Development
nav_order: 3
---

# Git versioning strategy

This document describes the **official release workflow** for AliasVault.

## Branch Semantics

### `main`
- Represents the **next version line**
- Contains **only pre-release versions**
- Example versions:
  - `0.26.0-alpha`
  - `0.26.0-beta`
- Never tagged for stable releases

---

### `XXXX-*` (GitHub issue branches)
- Branch from:
  - `main` for next-version development, or
  - a release tag for hotfixes
- Contains **only code fixes**
- No version changes
- No release notes
- May contain many commits

Landing rules:
- If branched from `main`: merge or rebase back into `main`
- If branched from a tag: **cherry-pick fixes into `main`**
- May be merged into a `release/*` branch for packaging

---

### `release/*`
- Used only to **package a stable release**
- Contains:
  - fixes (cherry-picked back into main)
  - release notes (cherry-picked back into main)
  - version bump
- Never merged into `main`
- Deleted after tagging

---

## Versioning Rules

### Development versions
- Live only on `main`
- Always pre-release (`-alpha`, `-beta`, etc.)

### Stable versions
- Live only on `release/*` branches
- Always tagged
- Never merged back into `main`
