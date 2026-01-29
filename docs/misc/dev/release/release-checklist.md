---
layout: default
title: Release Checklist
parent: Release
grand_parent: Development
nav_order: 4
---

# Release Checklist

Step-by-step guide for creating a new AliasVault release.

## 1. Create release branch

- **Feature release**: Branch from `main`

```bash
# Feature release
git checkout main && git checkout -b release/X.Y.Z
```

- **Bug/hotfix release**: Branch from previous tag (e.g., `0.25.2`)

```bash
# Hotfix release
git checkout 0.25.2 && git checkout -b release/0.25.3
```

## 2. Bump version and write release notes

Run the version bump script which automatically bumps all versions and creates Fastlane changelog files:

```bash
./scripts/bump-version.sh
```

- Commit the release notes in its own commit first
- **Cherry-pick the release notes commit to `main`**
- Commit the version bump changes in a separate commit
- The version bump commit stays only in the release branch
    - ***Not cherry-picked***, as the `main` branch is always targeting the next feature (pre)release

## 3. Additional changes (optional)

- If additional fixes are needed after testing, add them to the release branch
- **Cherry-pick all fix commits back to `main`**

## 4. Publish release

- Create the release from GitHub Releases based on the release branch
- Tag is created automatically

## 5. Verify cherry-picks

After release, verify all relevant changes were cherry-picked to `main`:

```bash
git range-diff <previous-tag>..release/<version> <previous-tag>..main
# Example:
git range-diff 0.25.2..release/0.25.3 0.25.2..main
```

**Expected output:**
- Only the version bump commit should show as `<` (only in release branch)
- All other commits should show as `=` (in both branches)
