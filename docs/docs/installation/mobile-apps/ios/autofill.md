---
sidebar_position: 1
sidebar_label: "Autofill"
---
# iOS Autofill

This page explains how autofill works in the AliasVault iOS app.

## Known Limitations

### Keyboard suggestions ignore subdomains
The suggestions shown above the keyboard are chosen by iOS itself, not by AliasVault, and iOS matches them on the main domain only. An entry for `test.example.com` is therefore also suggested on `test2.example.com`, without showing that they differ.

If a keyboard suggestion is wrong, open the full AliasVault list from the AutoFill options instead. That list uses AliasVault's own matching, which prefers an entry for the exact subdomain over entries for other subdomains.
