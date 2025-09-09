---
layout: default
title: Update
parent: Install Script
redirect_from:
  - /installation/update
  - /installation/update.html
nav_order: 3
---

# Updating AliasVault
{: .no_toc }

<details open markdown="block">
  <summary>
    Table of contents
  </summary>
  {: .text-delta }
1. TOC
{:toc}
</details>

## Before You Begin
You can see the latest available version of AliasVault on [GitHub](https://github.com/aliasvault/aliasvault/releases).

{: .warning }
Before updating, it's recommended to backup your database and other important data. You can do this by making
a copy of the `database` and `certificates` directories.

## Standard Update Process
For most version updates, you can use the standard update process:

```bash
./install.sh update
```

> Tip: to skip the confirmation prompts and automatically proceed with the update, use the `-y` flag: `./install.sh update -y`

## Version-Specific Upgrade Guides
Upgrading from certain earlier versions require additional steps during upgrade. If you are upgrading from an older version, please check the relevant articles below if it applies to your server:

- [Updating to 0.22.0](v0.22.0.html) - Move secrets from .env to file based secrets

## Additional Update Options

### Updating the installer script
The installer script can check for and apply updates to itself. This is done as part of the `update` command. However you can also update the installer script separately with the `update-installer` command. This is useful if you want to update the installer script without updating AliasVault itself, e.g. as a separate step during CI/CD pipeline.

```bash
./install.sh update-installer
```

> Tip: to skip the confirmation prompts and automatically proceed with the update, use the `-y` flag: `./install.sh update-installer -y`

### Installing a specific version
To install a specific version and skip the automatic version checks, run the install script with the `install` option and specify the version you want to install. Note that downgrading is not supported officially and may lead to unexpected issues.

```bash
./install.sh install <version>

# Example:
./install.sh install 0.22.0
```
