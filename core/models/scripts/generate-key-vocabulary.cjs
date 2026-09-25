#!/usr/bin/env node
/**
 * Generates the vault key vocabulary for C#, TypeScript, Swift, and Kotlin.
 */

const fs = require('fs');
const path = require('path');

// Paths
const REPO_ROOT = path.join(__dirname, '../../..');
const CS_OUTPUT_DIR = path.join(REPO_ROOT, 'apps/server/Shared/AliasVault.Shared/Models/Enums');
const TS_OUTPUT_DIR = path.join(REPO_ROOT, 'core/models/src/webapi');
const SWIFT_OUTPUT_DIR = path.join(REPO_ROOT, 'apps/mobile-app/ios/VaultModels');
const KOTLIN_OUTPUT_DIR = path.join(REPO_ROOT, 'apps/mobile-app/android/app/src/main/java/net/aliasvault/app/vaultstore/models');

const CS_NAMESPACE = 'AliasVault.Shared.Models.Enums';
const KOTLIN_PACKAGE = 'net.aliasvault.app.vaultstore.models';

const AUTOGEN_NOTE = 'core/models/scripts/generate-key-vocabulary.cjs';
const REGEN_HINT = "Run 'core/models/build.sh' (or 'node core/models/scripts/generate-key-vocabulary.cjs') to regenerate.";

/**
 * The single source of truth for every key vocabulary.
 *
 * Per vocabulary:
 *   name       - the type name shared by all platforms.
 *   helperName - the C# static class holding the string-constant conversions and the per-member predicates.
 *   summary    - doc comment lines for the generated type.
 *   flags      - boolean properties that vary per member; each becomes a C# predicate on the helper class.
 *   members    - the closed set of members.
 */
const VOCABULARIES = [
  {
    name: 'UnlockMethodType',
    helperName: 'UnlockMethodTypes',
    summary: [
      'Unlock methods a user can enroll. Each enrolled method stores one copy of the user\'s Account Key,',
      'encrypted with a KEK derived from that method\'s secret.',
    ],
    flags: [],
    members: [
      {
        name: 'Password',
        token: 'password',
        summary: 'Master password: the KEK is derived from the password via Argon2.',
      },
    ],
  },
  {
    name: 'ManifestKeyType',
    helperName: 'ManifestKeyTypes',
    summary: [
      'How one user\'s access to one manifest\'s VEK is protected. Every (user, manifest) access path is',
      'exactly one of these, and the token decides where the client looks for the key that opens the manifest.',
    ],
    flags: [
      {
        name: 'VekTravelsWithManifest',
        summary: [
          'Whether this access path\'s encrypted VEK is delivered on the manifest itself.',
          'False does not mean the ciphertext is withheld, only that it reaches the client by another route:',
          'an account-key VEK travels in the unlock envelope served by GET /v2/VaultKey/{type}, because the',
          'client must already have derived its KEK before any manifest is worth fetching.',
        ],
      },
    ],
    members: [
      {
        name: 'AccountKey',
        token: 'accountkey',
        summary: 'The VEK is encrypted with the user\'s own Account Key, which their unlock chain produces.',
        flags: { VekTravelsWithManifest: false },
      },
      {
        name: 'GrantKey',
        token: 'grantkey',
        summary: 'A grant: the VEK is encrypted to a public key of the user, so only its holder\'s private half can open it.',
        flags: { VekTravelsWithManifest: true },
      },
    ],
  },
  {
    name: 'VaultKeyAlgorithm',
    helperName: 'VaultKeyAlgorithms',
    summary: [
      'The algorithms a piece of vault key ciphertext can be encrypted with. The token travels next to every',
      'ciphertext, so a reader always knows how to open it without inferring anything from context.',
    ],
    flags: [
      {
        name: 'IsAsymmetric',
        summary: [
          'Whether the algorithm encrypts to a public key, which is what a grant requires.',
        ],
      },
    ],
    members: [
      {
        name: 'Aes256Gcm',
        token: 'aes256-gcm',
        summary: 'AES-256-GCM: symmetric, used where the reader already holds the wrapping key.',
        flags: { IsAsymmetric: false },
      },
      {
        name: 'RsaOaepSha256',
        token: 'rsa-oaep-sha256',
        summary: 'RSA-OAEP with SHA-256: asymmetric, used to encrypt a VEK to a recipient\'s public key.',
        flags: { IsAsymmetric: true },
      },
    ],
  },
];

/** Convert a PascalCase name to camelCase (Swift). */
function toCamelCase(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** Convert a PascalCase name to SCREAMING_SNAKE_CASE (Kotlin). */
function toScreamingSnakeCase(name) {
  return name.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
}

/** Render doc text as an array of lines, accepting either a string or an array. */
function toLines(summary) {
  return Array.isArray(summary) ? summary : [summary];
}

/**
 * Render doc text as lines with a terminating period on the last one (Kotlin detekt requires it).
 * Only the final line is touched, so a sentence wrapped across lines is not punctuated mid-way.
 */
function toTerminatedLines(summary) {
  const lines = toLines(summary);
  const last = lines[lines.length - 1];
  return [...lines.slice(0, -1), last.endsWith('.') ? last : `${last}.`];
}

/**
 * Generate the C# enum plus its token/predicate helper class.
 *
 * The helper is a set of switch expressions rather than a lookup table: because the enum and the
 * switches are emitted from the same list, every member is covered by construction, so there is no
 * need for the start-up "is any member undefined?" check a hand-written table would require.
 */
function generateCSharp(vocab) {
  const summaryBody = toLines(vocab.summary)
    .concat(['The token is the only persisted and transmitted identifier; the ordinals below are cosmetic.'])
    .map(line => `/// ${line}`)
    .join('\n');
  const summary = `/// <summary>\n${summaryBody}\n/// </summary>`;

  const members = vocab.members
    .map((member, index) => `    /// <summary>
    /// ${member.summary}
    /// </summary>
    ${member.name} = ${index},`)
    .join('\n\n');

  const toTokenArms = vocab.members.map(m => `        ${vocab.name}.${m.name} => "${m.token}",`).join('\n');
  const parseArms = vocab.members.map(m => `            case "${m.token}":\n                type = ${vocab.name}.${m.name};\n                return true;`).join('\n');

  const predicates = vocab.flags
    .map(flag => {
      const flagSummary = toLines(flag.summary).map(line => `    /// ${line}`).join('\n');
      const arms = vocab.members.map(m => `        ${vocab.name}.${m.name} => ${m.flags[flag.name] ? 'true' : 'false'},`).join('\n');
      return `
    /// <summary>
${flagSummary}
    /// </summary>
    /// <param name="type">The ${vocab.name} to check.</param>
    /// <returns>The flag value for that ${vocab.name}.</returns>
    public static bool ${flag.name}(${vocab.name} type) => type switch
    {
${arms}
        _ => throw new ArgumentOutOfRangeException(nameof(type), type, "Unknown ${vocab.name}."),
    };
`;
    })
    .join('');

  return `// <auto-generated />
// This file is auto-generated from ${AUTOGEN_NOTE}.
// Do not edit this file directly. ${REGEN_HINT}

#nullable enable

namespace ${CS_NAMESPACE};

${summary}
public enum ${vocab.name}
{
${members}
}

/// <summary>
/// Token conversions for <see cref="${vocab.name}"/>.
/// </summary>
public static class ${vocab.helperName}
{
    /// <summary>
    /// Returns the wire/storage token for a ${vocab.name}.
    /// </summary>
    /// <param name="type">The ${vocab.name} to convert.</param>
    /// <returns>The token.</returns>
    public static string ToToken(${vocab.name} type) => type switch
    {
${toTokenArms}
        _ => throw new ArgumentOutOfRangeException(nameof(type), type, "Unknown ${vocab.name}."),
    };

    /// <summary>
    /// Parses a token.
    /// </summary>
    /// <param name="token">The token to parse.</param>
    /// <param name="type">The parsed ${vocab.name}.</param>
    /// <returns>True when the token names a ${vocab.name} this build supports.</returns>
    public static bool TryParse(string? token, out ${vocab.name} type)
    {
        switch (token)
        {
${parseArms}
            default:
                type = default;
                return false;
        }
    }

    /// <summary>
    /// Parses a token and returns the ${vocab.name}.
    /// </summary>
    /// <param name="token">The token to parse.</param>
    /// <returns>The parsed ${vocab.name}.</returns>
    public static ${vocab.name} Parse(string? token)
    {
        if (!TryParse(token, out var type))
        {
            throw new ArgumentOutOfRangeException(nameof(token), token, "Unknown ${vocab.name} token.");
        }

        return type;
    }
${predicates}}
`;
}

/**
 * Generate the TypeScript const object (consumed as-is by the browser extension and mobile app).
 *
 * Tokens only: anything a client branches on it branches on by token, so the server-side flag table
 * has no client counterpart to drift from.
 */
function generateTypeScript(vocab) {
  const summary = toLines(vocab.summary).map(line => ` * ${line}`).join('\n');

  const members = vocab.members
    .map(member => `  /**
   * ${member.summary}
   */
  ${member.name}: '${member.token}',`)
    .join('\n\n');

  return `/**
 * <auto-generated />
 * This file is auto-generated from ${AUTOGEN_NOTE}.
 * Do not edit this file directly. ${REGEN_HINT}
 */

/**
${summary}
 */
export const ${vocab.name} = {
${members}
} as const;

/**
 * Type representing all valid ${vocab.name} tokens.
 */
export type ${vocab.name}Value = typeof ${vocab.name}[keyof typeof ${vocab.name}];
`;
}

/**
 * Generate the Swift string-constant struct (mirrors the VaultDataBucketCategory.swift convention).
 */
function generateSwift(vocab) {
  const summary = toLines(vocab.summary).map(line => `/// ${line}`).join('\n');

  const members = vocab.members
    .map(member => `    /// ${member.summary}
    public static let ${toCamelCase(member.name)} = "${member.token}"`)
    .join('\n\n');

  const all = vocab.members.map(m => toCamelCase(m.name)).join(', ');

  return `// <auto-generated />
// This file is auto-generated from ${AUTOGEN_NOTE}.
// Do not edit this file directly. ${REGEN_HINT}

import Foundation

${summary}
public struct ${vocab.name} {
${members}

    /// All known ${vocab.name} tokens.
    public static let all = [${all}]
}
`;
}

/**
 * Generate the Kotlin string-constant object (mirrors the VaultDataBucketCategory.kt convention).
 */
function generateKotlin(vocab) {
  const summary = toTerminatedLines(vocab.summary).map(line => ` * ${line}`).join('\n');

  const members = vocab.members
    .map(member => `    /**
     * ${toTerminatedLines(member.summary).join('\n     * ')}
     */
    const val ${toScreamingSnakeCase(member.name)} = "${member.token}"`)
    .join('\n\n');

  const all = vocab.members.map(m => toScreamingSnakeCase(m.name)).join(', ');

  return `// <auto-generated />
// This file is auto-generated from ${AUTOGEN_NOTE}.
// Do not edit this file directly. ${REGEN_HINT}

package ${KOTLIN_PACKAGE}

/**
${summary}
 */
object ${vocab.name} {
${members}

    /**
     * All known ${vocab.name} tokens.
     */
    val all = listOf(${all})
}
`;
}

/**
 * Ensure the directory for a file path exists.
 */
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Fail loudly on a definition that would emit ambiguous or colliding output.
 */
function validate() {
  const seenTokens = new Map();
  for (const vocab of VOCABULARIES) {
    if (vocab.members.length === 0) {
      throw new Error(`${vocab.name} declares no members.`);
    }

    const tokens = new Set();
    for (const member of vocab.members) {
      if (!/^[a-z0-9-]+$/.test(member.token)) {
        throw new Error(`${vocab.name}.${member.name} has token "${member.token}"; tokens must be lowercase, digits and dashes only.`);
      }

      if (tokens.has(member.token)) {
        throw new Error(`${vocab.name} declares token "${member.token}" twice.`);
      }

      tokens.add(member.token);

      for (const flag of vocab.flags) {
        if (typeof member.flags?.[flag.name] !== 'boolean') {
          throw new Error(`${vocab.name}.${member.name} is missing a boolean value for flag "${flag.name}".`);
        }
      }
    }

    // Distinct vocabularies may reuse a token, but sharing one across types makes wire traces ambiguous.
    for (const member of vocab.members) {
      const owner = seenTokens.get(member.token);
      if (owner && owner !== vocab.name) {
        throw new Error(`Token "${member.token}" is declared by both ${owner} and ${vocab.name}.`);
      }

      seenTokens.set(member.token, vocab.name);
    }
  }
}

/**
 * Main execution.
 */
function main() {
  validate();

  for (const vocab of VOCABULARIES) {
    const outputs = [
      [path.join(CS_OUTPUT_DIR, `${vocab.name}.cs`), generateCSharp(vocab)],
      [path.join(TS_OUTPUT_DIR, `${vocab.name}.ts`), generateTypeScript(vocab)],
      [path.join(SWIFT_OUTPUT_DIR, `${vocab.name}.swift`), generateSwift(vocab)],
      [path.join(KOTLIN_OUTPUT_DIR, `${vocab.name}.kt`), generateKotlin(vocab)],
    ];

    for (const [outputPath, content] of outputs) {
      ensureDir(outputPath);
      fs.writeFileSync(outputPath, content, 'utf8');
      console.log(`Generated: ${outputPath}`);
    }
  }

  const total = VOCABULARIES.reduce((sum, v) => sum + v.members.length, 0);
  console.log(`\nKey vocabulary generation complete (${VOCABULARIES.length} vocabularies, ${total} members).`);
}

main();
