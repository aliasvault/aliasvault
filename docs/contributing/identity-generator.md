---
layout: default
title: Identity Generator
parent: Contributing
nav_order: 2
---

# Identity Generator Translations

In AliasVault, when creating a new credential, AliasVault automatically generates realistic alias identities including:
- First names (male and female)
- Last names (surnames)
- Email addresses
- Birthdate

The AliasVault identity generator uses lists (dictionaries) of possible names. Currently, AliasVault has name lists for the following languages:

- 🇬🇧 **English** (en)
- 🇳🇱 **Dutch** (nl)
- 🇩🇪 **German** (de)

**Your language not listed?** Help us add it!

---

## How to Contribute

We need **lists of common first and last names** used in your language/region. Technical skills are not required. For each language that AliasVault supports, we need a text file with one name per line:

### Basic name lists
1. **Male** first names (100+ names)
2. **Female** first names (100+ names)
2. Common last names/**surnames** (100+ names)

### History specific name lists
AliasVault also supports history specific first names (per decade). In many countries and regions, name popularity has changed throughout the years. Names that used to be popular for people born in the 1950's are barely given to people born in the 1990's and vice versa.

## How to Submit Your Names

1. **Create simple text files** with one name per line:
   - `firstnames_male.txt`
      - optionally: `firstnames_male_1950_1960.txt`, `firstnames_male_1960_1970.txt` etc.
   - `firstnames_female.txt`
      - optionally: `firstnames_female_1950_1960.txt`, `firstnames_female_1960_1970.txt` etc.
   - `lastnames.txt`

2. **Send the files to us:**
   - **Discord**: Join our [community server](https://discord.gg/DsaXMTEtpF) and share in #translations or via private message
   - **Email**: [contact@support.aliasvault.net](mailto:contact@support.aliasvault.net)
   - **Crowdin**: If you're already a member of the AliasVault Crowdin project, send a PM with an attachment

After we have received the files, we'll take care of the technical formatting and making it available in the AliasVault apps.

## Tips

### Name Selection
- ✅ **Use common, popular names** - Names you'd actually encounter in daily life
- ✅ **Modern and traditional** - Include a mix of classic and contemporary names
- ✅ **Diverse styles** - Represent different regional variations within your language

The more names = the more variety and more realistic identities!

---

## Examples from Existing Languages

Want to see what the actual dictionaries look like that AliasVault uses right now? Check out these examples. We also welcome any additions to existing languages, e.g. adding more names.

### English (Simple Implementation)
- [View female names](https://github.com/aliasvault/aliasvault/blob/main/shared/identity-generator/src/dictionaries/en/firstnames_female.ts)
- [View male names](https://github.com/aliasvault/aliasvault/blob/main/shared/identity-generator/src/dictionaries/en/firstnames_male.ts)
- [View last names](https://github.com/aliasvault/aliasvault/blob/main/shared/identity-generator/src/dictionaries/en/lastnames.ts)

### German (Decade-Based Implementation)
- [View 1950s female names](https://github.com/aliasvault/aliasvault/blob/main/shared/identity-generator/src/dictionaries/de/firstnames_female_1950_1959.ts)
- [View 2020s female names](https://github.com/aliasvault/aliasvault/blob/main/shared/identity-generator/src/dictionaries/de/firstnames_female_2020_2029.ts)
- [Browse all German files](https://github.com/aliasvault/aliasvault/tree/main/shared/identity-generator/src/dictionaries/de)

---

## Questions?
If you have any questions, feel free to contact us and get in touch:

- Join our [Discord](https://discord.gg/DsaXMTEtpF) - Ask questions in #translations
- Email us: [contact@support.aliasvault.net](mailto:contact@support.aliasvault.net)