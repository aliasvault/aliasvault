# Security Policy

Security is very important to us. We truly appreciate the security community and responsible researchers who report issues, your findings help us improve AliasVault for everyone.

We investigate all reported issues and work with researchers on responsible disclosure. Certain vulnerabilities, especially those impacting confidentiality, integrity, authentication, or core protection mechanisms, may qualify for a CVE (Common Vulnerabilities and Exposures) identifier. Others may still result in fixes or defense-in-depth improvements.

## 1. Reporting a Vulnerability

**Email:** security@support.aliasvault.net

Please include:

1. Description of the issue
2. Steps to reproduce
3. Affected component(s)
4. Security impact (what an attacker could achieve)
5. Prerequisites for exploitation
6. Suggested remediation (optional)

We acknowledge reports within **48 hours**. Please do not publicly disclose issues before coordinated resolution.

We value good-faith security research and review every report, even those that do not qualify for CVE assignment. Reports classified as Class 2 or Class 3 (see below) may still result in fixes or defense-in-depth improvements in future updates. We will credit reporters where applicable (with permission) when fixes are released.

---

# 2. Threat Model

AliasVault is a **zero-knowledge, end-to-end encrypted password and email alias manager**.

> Note: We only request CVEs for vulnerabilities that breach the encryption/access control boundary (defined in Section 2.1). Post-compromise scenarios — issues that assume an attacker has already compromised the user's device, runtime environment, or account through external means — are not considered CVE-worthy, though we may still address them as defense-in-depth improvements.

### 2.1 Primary Security Boundary

The **primary security boundary** (also referred to as the **encryption/access control boundary**) in AliasVault is the end-to-end encryption and access control layer that protects user secrets. Concretely, this boundary guarantees that only authorized users can decrypt or access their vault secrets.

- Vault data is encrypted client-side using keys derived from the user's master password.
- The server never has access to plaintext vault data.
- Network interception, server compromise, or API token leakage **must not** expose decrypted secrets.

A vulnerability is considered **critical** if it allows crossing this boundary.

---

### 2.2 Out-of-Scope: Compromised Devices

The following represent **device compromise scenarios** and are **outside AliasVault’s primary security boundary**:

- Rooted or jailbroken devices
- Kernel-level or runtime instrumentation (Frida, Xposed, debuggers)
- Malicious accessibility services
- Memory dumping of a running process
- Forensic extraction of device storage or backups
- Malware operating with equivalent privileges to the user

AliasVault implements defense-in-depth protections in these areas, but issues that **require these conditions** are classified as **local hardening**, not core security boundary failures.

---

# 3. Vulnerability Classification

This section defines how reported issues are categorized.

---

## 3.1 Critical Vulnerabilities (Class 1 - CVE-Eligible)

Class 1 issues are eligible for CVE assignment. These represent vulnerabilities that breach AliasVault's encryption/access control boundary (see Section 2.1).

A report must:

- Affect a **released version**
- Be **reproducible**
- Have a **concrete security impact**
- Not depend on full device compromise

### 3.1.1 Cryptographic Failures
- Recovery of plaintext vault data without the master password
- Key derivation or encryption flaws weakening confidentiality
- SRP (Secure Remote Password) implementation flaws enabling credential recovery or offline password attacks

### 3.1.2 Authentication & Access Failures
- Access to another user’s vault or metadata
- Privilege escalation
- Authentication bypass
- Flaws in client or session validation in authentication flows (e.g., passkey or token verification bypass)

### 3.1.3 Remote Exploitation
- Remote code execution from malicious input
- Injection leading to cross-user data access (e.g., XSS, SQL injection, or similar attacks that result in cross-tenant data exposure)
- Server-side request forgery (SSRF) reaching internal or restricted systems

### 3.1.4 Secret Exposure
- Decrypted secrets exposed via logs, APIs, or unintended channels
- Server-side plaintext exposure
- Backend returning sensitive internal resources to an attacker

---

## 3.2 Security Hardening Issues (Class 2)

These are security improvements but **not typically CVE-eligible**. Such issues may still be addressed in future updates as defense-in-depth improvements, even though they typically will not receive a CVE or security advisory.

### 3.2.1 Compromised Device Scenarios
Issues that only arise or can only be exploited after an attacker has fully compromised the user's device or runtime environment. For example, issues requiring:
- Root/jailbreak
- Runtime instrumentation
- Memory inspection of a live process
- OS-level data extraction

### 3.2.2 Local Data Handling
- Clipboard clearing
- Screen recording protections
- Autofill edge cases
- UI redaction improvements

### 3.2.3 Metadata & Session Observations
- Token leakage that does **not** allow vault decryption
- Metadata visibility inherent to system design

### 3.2.4 Theoretical or Non-Reproducible
- Speculative attack chains
- No working proof of concept
- Attacks requiring unrealistic assumptions

---

## 3.3 Out-of-Scope Reports (Class 3)
These are not treated as security vulnerabilities.

### 3.3.1 Non-Security Bugs
- UI inconsistencies
- Logic errors without security impact

### 3.3.2 External or Environmental
- Social engineering
- User misconfiguration
- Third-party service compromise outside AliasVault control

### 3.3.3 Low-Impact Web Findings
- Missing HTTP headers without exploit path
- Rate-limit suggestions
- Denial-of-service without data compromise

---

# 4. How CVE Decisions Are Made

We will assign a CVE ID only if an issue meets **all** of the following criteria:

1. The issue impacts **confidentiality, integrity, or authentication**
2. It crosses the **encryption/access control boundary** (as defined in Section 2.1)
3. It affects a **released version**
4. It is **reproducible**
5. It does **not rely on full device compromise**

Issues that do not meet these criteria will still be reviewed and may result in fixes, but they will be announced as regular updates rather than security advisories and are tracked as **hardening or quality improvements**. Every report is valued regardless of classification.

---

# 5. Scope

In scope:

- AliasVault server (API, Admin, SMTP)
- Web client
- Browser extensions (Chrome, Firefox, Edge, Safari)
- Mobile apps (iOS, Android)
- Core cryptographic libraries

Out of scope for CVE assignment by this project:

- Third-party dependency CVEs: the upstream maintainer or a central authority is responsible for issuing CVEs for their own code; AliasVault will promptly upgrade dependencies or apply patches when such issues arise
- Device OS vulnerabilities
- Hardware compromise
- Phishing, social engineering, or other attacks that rely on deceiving the user rather than exploiting the application

---

# 6. Disclosure Timeline

| Stage | Target |
|-------|--------|
| Acknowledgment | 48 hours |
| Initial assessment | 7 days |
| Fix & release goal | 30 days |

These are target timelines; complex issues may require adjustment in coordination with the reporter. We follow coordinated disclosure.
