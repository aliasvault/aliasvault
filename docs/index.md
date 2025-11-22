---
layout: home
title: Home
nav_order: 1
description: "AliasVault Documentation - Open-source password and identity manager"
permalink: /
---

# AliasVault Documentation
{: .fs-9 }

A privacy-first password manager with built-in email aliasing. Fully encrypted and self-hostable.

{: .fs-6 .fw-300 }

[Self-host Install](./installation){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/aliasvault/aliasvault){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## What is AliasVault?

AliasVault is a self-hosted password and (email) alias manager that helps you:

- 🔐 **Secure Passwords** - Store and manage passwords with zero-knowledge encryption
- 📧 **Email Aliases** - Generate unique email addresses for each service
- 🎭 **Identity Management** - Create and manage separate online identities
- 🏠 **Self-Hosted** - Run on your own infrastructure using Docker
- 🔓 **Open Source** - Transparent, auditable, and free to use

## Key Features

### Zero-Knowledge Encryption
Your entire vault (usernames, passwords, notes, passkeys etc.) is fully encrypted client-side before being sent to the server. Your master password never leaves your device, and the server cannot decrypt any vault contents. When emails are received by the server, they are immediately encrypted with your public key before being saved, ensuring only you can read them. Email aliases themselves are registered on the server as "claims" linked to your account for routing purposes, but no personally identifiable information is required.

### Built-in Email Server
Generate virtual email addresses for each identity. Emails sent to these addresses are instantly visible in the AliasVault app.

### Virtual Identities
Create separate identities for different purposes, each with its own email aliases.

---

## Getting Started

Ready to get started with AliasVault? Check out the [server installation guide](./installation).

---

## Want to Contribute?

Help make AliasVault better for everyone:

- 🌍 **[Translate the UI](./contributing/ui-translations.md)** - Help translate AliasVault into your language
- 👤 **[Add Name Dictionaries](./contributing/identity-generator.md)** - Provide names for the identity generator

See all ways to contribute: [Contributing Guide](./contributing/)
