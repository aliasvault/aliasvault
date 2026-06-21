# Contributing to AliasVault

Thanks for your interest in contributing to the AliasVault project! There are plenty of ways to help out.

## Table of Contents

1. [Help spread the word](#1-help-spread-the-word)
2. [Contributing to Translations](#2-contributing-to-translations)
3. [Contributing to the Documentation](#3-contributing-to-the-documentation)
4. [Contributing to the Main Codebase](#4-contributing-to-the-main-codebase)
   - [4.1 Pull requests](#41-pull-requests)
   - [4.2 Set up your local development environment](#42-set-up-your-local-development-environment)
   - [4.3 Supported versions](#43-supported-versions)
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

You can also get in contact via [Discord](https://discord.gg/DsaXMTEtpF) to chat, or via email at [support@aliasvault.com](mailto:support@aliasvault.com) to discuss the language(s) you are willing to contribute to, and so we can answer any technical questions you might have.

### Identity Generator Translations

In AliasVault, when creating a new credential AliasVault automatically generates realistic alias identities including: first names, last names and birthdates. For this AliasVault uses dictionaries of possible names per language. You can help to enable AliasVault to generate proper identities in your language too.

**How to help:**
- Create lists of common first names (male and female)
- Create a list of common last names (surnames)
- Optionally: Decade-specific names for more authentic generations

Read the specific instructions on how to contribute here: [Identity Generator Translations](https://docs.aliasvault.com/contributing/identity-generator.html).

## 3. Contributing to the Documentation

The docs are built using Jekyll and automatically deploy to GitHub Pages via GitHub Actions. You can build the docs locally by running `docker compose up` in the `./docs` folder.

The docs site is based on the open-source template called Just The Docs. Find more information about how this template works in the [official docs](https://just-the-docs.github.io/just-the-docs/).

To make changes to the AliasVault documentation please make a PR that directly edits the `docs` markdown files in this repository.

## 4. Contributing to the Main Codebase

AliasVault is open to outside contributions in the form of ideas, feature requests but also pull requests. Please read the guidelines below.

### 4.1 Pull requests

Pull requests generally fall into one of two categories:

#### 4.1.1 Technical improvements
Bug fixes, refactors, performance improvements, tests and documentation fixes are more than welcome. Before starting work, please do make sure a GitHub issue exists for what you're planning so we can briefly discuss the merit. We may already have other ideas about how to approach it, or be working on it already internally. Follow the existing patterns established in the codebase, and make sure your changes pass the linting style checks and tests. This will give your PR the best chance of being reviewed and merged.

> For security related issues: please **do not** open a public PR or issue for a suspected vulnerability. Report it privately as described in [SECURITY.md](SECURITY.md) so it can be handled reponsibly.

#### 4.1.2 Feature additions and UX changes
Anything that alters how AliasVault works and/or looks is something we handle carefully. Up front, please know that it's highly unlikely we'll accept pull requests for visual changes, new strings, new settings, or really anything that changes the user experience. Please talk to us first if you're planning something like this. There are cases where we may accept it, but in most situations we probably won’t.

We care strongly about how AliasVault looks and behaves across all platforms (web app, browser extension, mobile), and getting this right is genuinely hard. That's why UI and UX changes are most likely to be done internally by the core maintainers, and why a no on your PR isn't meant personally.

That said, we genuinely appreciate your ideas and proposals for UI/UX improvements. Please feel free to open a GitHub feature request issue (or reach out via [Discord](https://discord.gg/DsaXMTEtpF) or [email](mailto:support@aliasvault.com)) describing the problem you're trying to solve, ideally with mockups where applicable. Or, if there's already an issue for it, add your thoughts in the comments.

### 4.2 Set up your local development environment
You can find instructions on how to get your local development environment setup for the different parts of the AliasVault codebase here:

https://docs.aliasvault.com/misc/dev/

> Tip: if the URL above is not available, the raw doc pages can also be found in the `docs` folder in this repository.

If you run into any issues, feel free to join our [Discord](https://discord.gg/DsaXMTEtpF) to chat with the maintainers and author.

### 4.3 Supported versions

At this time during the public beta, we only support the **latest major and minor** release. Currently we are on **0.x**, so in practice that means the **latest minor** only. We do not accept pull requests and/or backports that target older release lines.

## 5. License and Contributions

AliasVault is licensed under the GNU Affero General Public License v3.0 (AGPLv3). By submitting code, documentation, or other contributions to this project, you agree that:

1. Your contribution will be licensed under the same AGPLv3 license as the project
2. You have the legal right to grant this license (e.g., you are the author, or have permission)
3. You understand that your contribution will be made public under the AGPLv3 terms
4. You are not expected to provide support or warranties for your contribution
5. We do not accept commits generated or authored by LLMs or agents. Every commit must be personally authored, reviewed, tested, fully understood, and signed off by the contributor submitting it.

✅ There is no Contributor License Agreement (CLA) required. We believe in a balanced open source model where all contributors are treated equally under the terms of the AGPLv3.

> By opening a pull request, you agree to these terms. Your contributions will be published under the AGPLv3 license.
