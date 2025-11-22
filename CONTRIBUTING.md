# Contributing to AliasVault

Thanks for your interest in contributing to the AliasVault project! There are a lot of ways to help out.

## Table of Contents

1. [Help spread the word](#1-help-spread-the-word)
2. [Contributing to Translations](#2-contributing-to-translations)
3. [Contributing to the Documentation](#3-contributing-to-the-documentation)
4. [Contributing to the Main Codebase](#4-contributing-to-the-main-codebase)
   - [4.1 Get in contact](#41-get-in-contact)
   - [4.2 Set up your local development environment](#42-set-up-your-local-development-environment)
5. [License and Contributions](#5-license-and-contributions)

---

## 1. Help spread the word

Help grow the AliasVault community by:

- Answering questions and helping users in our [Discord](https://discord.gg/DsaXMTEtpF)
- Reporting bugs and suggesting improvements
- Sharing on social media and writing about your experience
- Creating tutorials and documentation
- Spreading the word about privacy and self-hosting

## 2. Contributing to Translations

Help make AliasVault accessible to users worldwide by contributing translations! AliasVault is currently available in English and Dutch, but we're looking for volunteers to help translate it into other languages such as German, French, Spanish, Ukrainian, Italian, and more.

### UI Translations

AliasVault UI translations are managed through [Crowdin](https://crowdin.com/), an online translation platform. If you'd like to help translate AliasVault into your native language, please [request access to the Crowdin project](https://crowdin.com/project/aliasvault).

You can also get in contact via [Discord](https://discord.gg/DsaXMTEtpF) to chat, or via email at [contact@support.aliasvault.net](mailto:contact@support.aliasvault.net) to discuss the language(s) you are willing to contribute to, and so we can answer any technical questions you might have.

### Identity Generator Translations

In AliasVault, when creating a new credential AliasVault automatically generates realistic alias identities including: first names, last names and birthdates. For this AliasVault uses dictionaries of possible names per language. You can help to enable AliasVault to generate proper identities in your language too.

**How to help:**
- Create lists of common first names (male and female)
- Create a list of common last names (surnames)
- Optionally: Decade-specific names for more authentic generations

Read the specific instructions on how to contribute here: [Identity Generator Translations](https://docs.aliasvault.net/contributing/identity-generator.html).

## 3. Contributing to the Documentation

The docs are built using Jekyll and automatically deploy to GitHub Pages via GitHub Actions. You can build the docs locally by running `docker compose up` in the `./docs` folder.

The docs site is based on the open-source template called Just The Docs. Find more information about how this template works in the [official docs](https://just-the-docs.github.io/just-the-docs/).

To make changes to the AliasVault documentation please make a PR that directly edits the `docs` markdown files in this repository.

## 4. Contributing to the Main Codebase

### 4.1 Get in contact
If you're planning to work on a new feature or improvement for AliasVault, we strongly encourage you to get in touch with us first. This ensures that your proposed changes align with the project's direction and increases the likelihood of your work being accepted into the official repository. You can reach us through:

- Opening an issue on GitHub to discuss your proposed changes
- Reaching out via Discord or email
- Contacting the maintainers directly

### 4.2 Set up your local development environment
You can find instructions on how to get your local development environment setup for the different parts of the AliasVault codebase here:

https://docs.aliasvault.net/misc/dev/

> Tip: if the URL above is not available, the raw doc pages can also be found in the `docs` folder in this repository.

If you run into any issues, feel free to join our [Discord](https://discord.gg/DsaXMTEtpF) to chat with the maintainers and author.

## 5. License and Contributions

AliasVault is licensed under the GNU Affero General Public License v3.0 (AGPLv3). By submitting code, documentation, or other contributions to this project, you agree that:

1. Your contribution will be licensed under the same AGPLv3 license as the project
2. You have the legal right to grant this license (e.g., you are the author, or have permission)
3. You understand that your contribution will be made public under the AGPLv3 terms
4. You are not expected to provide support or warranties for your contribution

✅ There is no Contributor License Agreement (CLA) required. We believe in a balanced open source model where all contributors are treated equally under the terms of the AGPLv3.

> By opening a pull request, you agree to these terms. Your contributions will be published under the AGPLv3 license.
