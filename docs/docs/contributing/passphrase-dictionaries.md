---
sidebar_position: 4
sidebar_label: "Passphrase Generator"
---
# Passphrase Generator

AliasVault can generate memorable and secure passphrases (instead of random character passwords) using the [Diceware](https://en.wikipedia.org/wiki/Diceware) method. Each passphrase is built by picking random words from a language-specific word list, for example `correct-horse-battery-staple`.

The word lists (dictionaries) are available in the following languages:

- 🇬🇧 **English** (en)
- 🇳🇱 **Dutch** (nl)
- 🇩🇪 **German** (de)
- 🇫🇷 **French** (fr)
- 🇪🇸 **Spanish** (es)
- 🇮🇹 **Italian** (it)

**Your language not listed?** Help us add it! And if your language *is* listed, you can still help by improving the existing word list.

---

## How Diceware works

Diceware maps every word in a list to a unique sequence of five dice rolls. Because each die has 6 sides, a complete list contains exactly **7776 words** (6⁵ = 7776), one word per line, in dice order. Rolling five dice (or generating an equivalent random number) selects one word, and chaining several words together produces a passphrase.

The 7776-word size is what gives each word a known, uniform amount of entropy (about 12.9 bits per word), which is the whole point of Diceware. For this reason every dictionary **must contain exactly 7776 words**. Not more, not less.

---

## Adding a New Language

If you’d like to help add a new language to the passphrase generator, you can do so by providing a new Diceware word list:

A good word list:
- ✅ Contains exactly **7776 unique words**, one per line
- ✅ Uses **common, easy-to-spell, easy-to-type** words from everyday language
- ✅ Avoids profanity, slurs, and otherwise offensive or upsetting words
- ✅ Avoids very long words and confusing near-duplicates where possible

### How to submit

- **GitHub**: Open a pull request adding a `<code>.diceware` file (see [existing dictionaries](#existing-dictionaries) below for the exact format)
- **Discord**: Join our [community server](https://discord.gg/DsaXMTEtpF) and share in #translations (a maintainer will collaborate with you)
- **Email**: [support@aliasvault.com](mailto:support@aliasvault.com) and attach the wordlist to the email.

After we receive the list, we'll take care of the technical formatting, attribution, and wiring it into the AliasVault apps.

---

## Improving an Existing Dictionary

The current dictionaries were collected from a variety of upstream sources (see the [attribution file](https://github.com/aliasvault/aliasvault/blob/main/core/rust/src/password_generator/wordlists/ATTRIBUTION.md)). They are a great starting point, but they are not perfect and improvements are very welcome. 

Common reasons to improve a list include:

- **Uncommon or obscure words**: words most native speakers wouldn't recognize or use
- **Hard-to-spell or hard-to-type words**: these make passphrases harder to type and remember
- **Replacing profanity or offensive words**: eliminating words that could be upsetting or inappropriate
- **Inconsistencies**: duplicates, accents, or formatting that doesn't fit the rest of the list

### How to edit a dictionary

You can edit an existing word list directly on GitHub.

1. Open the dictionary for your language:
   - [🇬🇧 English (`en.diceware`)](https://github.com/aliasvault/aliasvault/blob/main/core/rust/src/password_generator/wordlists/en.diceware)
   - [🇳🇱 Dutch (`nl.diceware`)](https://github.com/aliasvault/aliasvault/blob/main/core/rust/src/password_generator/wordlists/nl.diceware)
   - [🇩🇪 German (`de.diceware`)](https://github.com/aliasvault/aliasvault/blob/main/core/rust/src/password_generator/wordlists/de.diceware)
   - [🇫🇷 French (`fr.diceware`)](https://github.com/aliasvault/aliasvault/blob/main/core/rust/src/password_generator/wordlists/fr.diceware)
   - [🇪🇸 Spanish (`es.diceware`)](https://github.com/aliasvault/aliasvault/blob/main/core/rust/src/password_generator/wordlists/es.diceware)
   - [🇮🇹 Italian (`it.diceware`)](https://github.com/aliasvault/aliasvault/blob/main/core/rust/src/password_generator/wordlists/it.diceware)
2. Click the ✏️ "Edit this file" button in the top-right of the file view. GitHub will ask you to create your own copy (fork) of the project. Click to confirm.
3. Make your changes.
4. Click **Commit changes** and choose **Create a new branch and start a pull request**.
5. Submit the pull request. A maintainer will review it and merge it in.

If you'd rather not use GitHub, you can also reach us on [Discord](https://discord.gg/DsaXMTEtpF) or by [email](mailto:support@aliasvault.com), and send us your improved list there.

:::warning Keep exactly 7776 words
A Diceware list must always contain **exactly 7776 words**, since removing a word breaks the entropy math (and the validation tests). So **replace or edit words in place, don't add or remove lines**. To fix a bad word, swap it for a better one on the same line.
:::

---

## Example dictionaries

Here are some example wordlists you can view for reference:

- [All wordlists (GitHub directory)](https://github.com/aliasvault/aliasvault/tree/main/core/rust/src/password_generator/wordlists)
- [English example (`en.diceware`)](https://github.com/aliasvault/aliasvault/blob/main/core/rust/src/password_generator/wordlists/en.diceware)
- [Attribution & sources](https://github.com/aliasvault/aliasvault/blob/main/core/rust/src/password_generator/wordlists/ATTRIBUTION.md)

These files are plain text, with one word per line, in dice (random) order. Each contains exactly 7776 lines.

---

## Questions?
If you have any questions, feel free to get in touch:

- Join our [Discord](https://discord.gg/DsaXMTEtpF) - Ask questions in #translations
- Email us: [support@aliasvault.com](mailto:support@aliasvault.com)
