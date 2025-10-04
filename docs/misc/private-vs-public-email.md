---
layout: default
title: Private vs Public Email Domains
parent: Miscellaneous
nav_order: 3
---

# Private vs Public Email Domains
AliasVault offers two types of email domains: private and public.

## Private Email Domains
Private email domains come in two forms:

1. For the official cloud-hosted AliasVault service, users get access to the aliasvault.net domain, which is a private domain managed by AliasVault.

2. For self-hosted installations, private domains are domains that you control and configure yourself to connect to your AliasVault server instance.

In both cases, private domains are directly connected to the AliasVault server infrastructure. Any email aliases created using these domains benefit from full end-to-end encryption - emails are encrypted with the receiver's public/private key pair before they are stored on the AliasVault server. These emails can only be decrypted by the receiver's private key that is stored securely in the user's vault. This ensures that no one can read your emails except for you.

---

## Public Email Domains
For convenience, AliasVault also offers public email domains which are provided through an integration with [SpamOK.com](https://spamok.com), a free service operated by Lanedirt (the author of AliasVault). These domains are suitable for testing and non-critical email aliases and offer convenience for self-hosted users who cannot set up their own private domains.

## Available Domains
The following public email domains are currently available through SpamOK:
- spamok.com
- solarflarecorp.com
- spamok.nl
- 3060.nl
- landmail.nl
- asdasd.nl
- spamok.de
- spamok.com.ua
- spamok.es
- spamok.fr

## Important Disclaimers
Public email domains do have limitations, please be aware of them:

1. **Public Nature**: These are fully public domains - anyone can access any email address as long as they know the name of the alias. The benefit is that this makes these domains fully anonymous because there is no ownership that could be traced back to a specific user. But this also means that there is no privacy guarantee, as your emails can be read by anyone who knows the email address.

2. **No Service Level Agreement**: SpamOK is provided as a free service without any SLA or warranty. Email delivery and service availability are not guaranteed and can be interrupted at any time without notice.

### When to Use SpamOK Domains
SpamOK domains are suitable for:
- Testing AliasVault functionality
- Non-critical email aliases
- Temporary or disposable email needs

### When to Set Up Your Own Email Server
Consider setting up your own email server if you need:
- Complete control over your email domains
- Private email addresses where all incoming emails are encrypted before being stored on the AliasVault server. No one can read your emails except for you.
- Guaranteed service availability
- Professional or business use