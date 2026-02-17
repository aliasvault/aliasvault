# <img src="https://github.com/user-attachments/assets/933c8b45-a190-4df6-913e-b7c64ad9938b" width="35" alt="AliasVault"> AliasVault
AliasVault is a privacy-first password and email alias manager. Create unique identities, strong passwords, and random email aliases for every website you use. Fully end-to-end encrypted, with a built-in email server and zero third-party dependencies.

[<img src="https://img.shields.io/github/v/release/aliasvault/aliasvault?include_prereleases&logo=github&label=Release">](https://github.com/aliasvault/aliasvault/releases)
[![E2E Tests](https://github.com/aliasvault/aliasvault/actions/workflows/e2e-tests-server.yml/badge.svg)](https://github.com/aliasvault/aliasvault/actions/workflows/e2e-tests-server.yml)
[![.NET E2E Tests (with Sharding)](https://github.com/aliasvault/aliasvault/actions/workflows/e2e-tests-browser-extension.yml/badge.svg)](https://github.com/aliasvault/aliasvault/actions/workflows/e2e-browser-extension.yml)
[<img src="https://badges.crowdin.net/aliasvault/localized.svg">](https://crowdin.com/project/aliasvault)
[<img alt="Discord" src="https://img.shields.io/discord/1309300619026235422?logo=discord&logoColor=%237289da&label=Discord&color=%237289da">](https://discord.gg/DsaXMTEtpF)
[<img src="https://opencollective.com/aliasvault/tiers/badge.svg">](https://opencollective.com/aliasvault)

<a href="https://app.aliasvault.net">Try the cloud version 🔥</a> | <a href="https://aliasvault.net?utm_source=gh-readme">Website </a> | <a href="https://docs.aliasvault.net?utm_source=gh-readme">Documentation </a> | <a href="#self-hosting">Self-host instructions</a>

**⭐ Star us on GitHub, it motivates us a lot!**

If you enjoy using AliasVault, please also consider leaving a review on our apps or browser extensions, and share it with your friends or colleagues. Your support helps others discover a privacy-first alternative to traditional & closed-source password managers.

## About
Built on 15 years of experience, AliasVault is independent, open-source, self-hostable and community-driven. It’s the response to a web that tracks everything: a way to take back control of your digital privacy and help you stay secure online.

– Leendert de Borst ([@lanedirt](https://github.com/lanedirt)), Creator of AliasVault

## Screenshots

<table>
    <tr>
        <th align="center">Responsive web app</th>
        <th align="center">Browser extensions</th>
    </tr>
    <tr>
        <td align="center">
            <img src="https://github.com/user-attachments/assets/fa5bf64a-704d-4f09-b4e0-0310ab662204" alt="Responsive web app" />
        </td>
        <td align="center">
            <img src="https://github.com/user-attachments/assets/b5218609-217b-4c8d-8d5d-8c71e19bf057"alt="Browser extensions" />
		</td>
    </tr>
    <tr>
        <th align="center">Native iOS & Android apps</th>
        <th align="center">& much more</th>
    </tr>
    <tr>
		<td align="center">
            <img src="https://github.com/user-attachments/assets/5d09ad78-d145-48a1-b8da-c5a1dc708886" alt="Native iOS & Android Apps" />
		</td>
		<td align="center">
           <img src="https://github.com/user-attachments/assets/34fe650d-f08d-4c92-92e0-4e750b7a662a" alt="Lots of features" />
        </td>
	</tr>
</table>

## Cloud-hosted
Use the official cloud version of AliasVault at [app.aliasvault.net](https://app.aliasvault.net). This fully supported platform is always up to date with our latest release.

AliasVault is available on:
- [Web (universal)](https://app.aliasvault.net)
- [Chrome](https://chromewebstore.google.com/detail/aliasvault/bmoggiinmnodjphdjnmpcnlleamkfedj)
- [Firefox](https://addons.mozilla.org/en-US/firefox/addon/aliasvault/)
- [Edge](https://microsoftedge.microsoft.com/addons/detail/aliasvault/kabaanafahnjkfkplbnllebdmppdemfo)
- [Safari](https://apps.apple.com/app/id6743163173)

<p>
  <a href="https://apps.apple.com/app/id6745490915" style="display: inline-block; margin-right: 20px;"><img src="https://github.com/user-attachments/assets/bad09b85-2635-4e3e-b154-9f348b88f6d6" style="height: 40px;margin-right:10px;"  alt="Download on the App Store"></a>
  <a href="https://play.google.com/store/apps/details?id=net.aliasvault.app" style="display: inline-block;"><img src="https://github.com/user-attachments/assets/b28979c9-f4b8-4090-8735-e384a7fdaa47" style="height: 40px;" alt="Get it on Google Play"></a>
  <a href="https://f-droid.org/packages/net.aliasvault.app" style="display: inline-block;"><img src="https://github.com/user-attachments/assets/0fb25df1-0ea2-46a6-bfee-a9d70f22a02a" style="height: 40px;" alt="Get it on F-Droid"></a>
  <a href="https://apps.obtainium.imranr.dev/redirect?r=obtainium://app/{%22id%22:%22net.aliasvault.app%22,%22url%22:%22https://github.com/aliasvault/aliasvault%22,%22author%22:%22AliasVault%22,%22name%22:%22AliasVault%22,%22additionalSettings%22:%22{\%22about\%22:\%22Privacy-first%20Password%20Manager%20with%20Built-in%20Email%20Aliasing.\%22}%22}" style="display: inline-block;"><img src="https://github.com/user-attachments/assets/0e8c7cc6-533b-4fc4-bbc0-ce974d72de4b" style="height: 40px;" alt="Get it on F-Droid"></a>
</p>

[<img width="700" alt="Screenshot of AliasVault" src="docs/assets/img/screenshot.png">](https://app.aliasvault.net)

## Self-hosting
> [!NOTE]
> **Requirements:** 1 vCPU, 1GB RAM, 16GB disk, Docker ≥ 20.10, 64-bit Linux

AliasVault can be self-hosted on your own servers using two different installation methods. Both use Docker, but they differ in how much is automated versus how much you manage yourself.

- **Option 1: Install Script** - Managed solution with automatic SSL (recommended for VPS/cloud)

- **Option 2: Docker Compose** - Single container with manual setup for use with existing SSL infrastructure (NAS, homelab)

### Quick Start (Install Script)
```bash
# Download and run install script
curl -L -o install.sh https://github.com/aliasvault/aliasvault/releases/latest/download/install.sh

# Make install script executable and run it. This will create the .env file, pull the Docker images, and start the AliasVault containers.
chmod +x install.sh

./install.sh install
```

For other installation methods and more detailed steps, please read the [full installation guide](https://docs.aliasvault.net/installation) in the official docs.

## Documentation
For more information about the installation process, manual setup instructions and other topics, please see the official documentation website:

- [Documentation website (docs.aliasvault.net) 📚](https://docs.aliasvault.net)

## Security Architecture
<a href="https://docs.aliasvault.net/architecture"><img alt="AliasVault Security Architecture Diagram" src="docs/assets/diagrams/security-architecture/aliasvault-security-architecture-thumb.jpg" width="343"></a>

AliasVault takes security seriously and implements various measures to protect your data:

- All sensitive user data is encrypted end-to-end using industry-standard encryption algorithms. This includes the complete vault contents and all received emails.
- Your master password never leaves your device.
- Zero-knowledge architecture ensures the server never has access to your unencrypted data

For detailed information about our encryption implementation and security architecture, see the following documents:
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [Security Architecture Diagram](https://docs.aliasvault.net/architecture)

## Features & Roadmap

AliasVault is under active development, with a strong focus on usability, security, and cross-platform support.
The main focus is on ensuring robust usability for everyday tasks, including comprehensive autofill capabilities across all platforms.

🛠️ Incremental releases are published every 2–3 weeks, with a strong emphasis on real-world testing and user feedback.
During this phase, AliasVault can safely be used in production as it maintains strict data integrity and automatic migration guarantees.

Core features that are being worked on:

- [x] Core password & alias management
- [x] Full end-to-end encryption
- [x] Built-in email server for aliases
- [x] Easy self-hosted installer
- [x] Browser extensions with autofill feature (Chrome, Firefox, Edge, Safari, Brave)
- [x] Built-in TOTP authenticator
- [x] Import passwords from traditional password managers
- [x] iOS native app
- [x] Android native app
- [x] Editing in browser extension
- [x] Multi-language support across all client applications
- [x] Passkeys
- [x] Data model improvements (more flexible aliases and credential types, folder support, offline mode etc.)
- [ ] Usability improvements (save credentials when browsing, more credential types, mobile app feature-parity with web app)
- [ ] Support for FIDO2/WebAuthn hardware keys
- [ ] Adding support for family/team sharing (organization features)

👉 [View the full AliasVault roadmap here](https://github.com/aliasvault/aliasvault/issues/731)

### Got feedback or ideas?
Feel free to open an issue or discussion on GitHub. We warmly welcome all contributions: whether it’s translating, testing, helping to build features, sharing feedback - or helping spread the word about AliasVault. Every bit of support helps the project grow, so don’t hesitate to jump in and [say hi to us on Discord](https://discord.gg/DsaXMTEtpF)!

### Support the mission
AliasVault is open-source and community-driven. If you like what we’re building, consider supporting us through [Open Collective](https://opencollective.com/aliasvault) or through:

<a href="https://www.buymeacoffee.com/lanedirt" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 50px !important;" ></a>
