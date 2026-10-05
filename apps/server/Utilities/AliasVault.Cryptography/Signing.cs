//-----------------------------------------------------------------------
// <copyright file="Signing.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Cryptography;

using System.Buffers.Binary;
using System.Text;
using Org.BouncyCastle.Math.EC.Rfc8032;

/// <summary>
/// Verifies Ed25519 signatures made by account signing keys. Clients sign in the Rust core
/// (<c>core/rust/src/crypto/signing.rs</c>); the message encoding and the labels here must match it byte for byte.
/// </summary>
public static class Signing
{
    /// <summary>
    /// The label of a user's signature over their own account encryption public key.
    /// </summary>
    public const string AccountPublicKeyLabel = "aliasvault/v1/sig/account-public-key";

    /// <summary>
    /// The label of a grant: a manifest's VEK encrypted for one recipient key, signed by whoever handed it out.
    /// </summary>
    public const string GrantLabel = "aliasvault/v1/sig/grant";

    /// <summary>
    /// The label of a manifest's mail delivery public key, signed by whoever published it.
    /// </summary>
    public const string DeliveryKeyLabel = "aliasvault/v1/sig/delivery-key";

    /// <summary>
    /// Builds the bytes a signature covers: the label and each field, each prefixed with its length as a big-endian uint.
    /// </summary>
    /// <param name="label">The purpose label.</param>
    /// <param name="fields">The signed fields.</param>
    /// <returns>The message bytes.</returns>
    public static byte[] SignedMessage(string label, params byte[][] fields)
    {
        var parts = new[] { Encoding.UTF8.GetBytes(label) }.Concat(fields).ToList();
        var message = new byte[parts.Sum(p => 4 + p.Length)];
        var offset = 0;
        foreach (var part in parts)
        {
            BinaryPrimitives.WriteUInt32BigEndian(message.AsSpan(offset), (uint)part.Length);
            part.CopyTo(message, offset + 4);
            offset += 4 + part.Length;
        }

        return message;
    }

    /// <summary>
    /// Builds the signed message of a grant.
    /// </summary>
    /// <param name="manifestId">The manifest the VEK belongs to.</param>
    /// <param name="keyVersion">The version of the manifest's VEK.</param>
    /// <param name="signerUserId">The user who hands out the grant.</param>
    /// <param name="recipientPublicKey">The recipient public key (JWK) the VEK is encrypted for, as stored.</param>
    /// <param name="algorithm">The algorithm token of the encryption.</param>
    /// <param name="encryptedVek">The encrypted VEK.</param>
    /// <returns>The message bytes.</returns>
    public static byte[] GrantMessage(Guid manifestId, int keyVersion, string signerUserId, string recipientPublicKey, string algorithm, string encryptedVek)
    {
        return SignedMessage(GrantLabel, Utf8(manifestId.ToString()), Utf8(keyVersion.ToString(System.Globalization.CultureInfo.InvariantCulture)), Utf8(signerUserId), Utf8(recipientPublicKey), Utf8(algorithm), Utf8(encryptedVek));
    }

    /// <summary>
    /// Builds the signed message of a delivery key publish, bound to the manifest revision the write is based on so it
    /// cannot be replayed in a later write.
    /// </summary>
    /// <param name="manifestId">The manifest the key delivers mail for.</param>
    /// <param name="publicKey">The delivery public key (JWK).</param>
    /// <param name="currentRevision">The revision the write is based on.</param>
    /// <returns>The message bytes.</returns>
    public static byte[] DeliveryKeyMessage(Guid manifestId, string publicKey, long currentRevision)
    {
        return SignedMessage(DeliveryKeyLabel, Utf8(manifestId.ToString()), Utf8(publicKey), Utf8(currentRevision.ToString(System.Globalization.CultureInfo.InvariantCulture)));
    }

    /// <summary>
    /// Whether a value is a base64 Ed25519 public key.
    /// </summary>
    /// <param name="publicKeyBase64">The value to check.</param>
    /// <returns>True when it decodes to a valid public key.</returns>
    public static bool IsValidPublicKey(string? publicKeyBase64)
    {
        var bytes = TryDecode(publicKeyBase64, Ed25519.PublicKeySize);
        return bytes != null && Ed25519.ValidatePublicKeyFull(bytes, 0);
    }

    /// <summary>
    /// Whether a base64 signature over a message verifies under a base64 Ed25519 public key.
    /// </summary>
    /// <param name="publicKeyBase64">The signer's public key.</param>
    /// <param name="message">The signed message, see <see cref="SignedMessage"/>.</param>
    /// <param name="signatureBase64">The signature.</param>
    /// <returns>True when the signature is valid.</returns>
    public static bool Verify(string? publicKeyBase64, byte[] message, string? signatureBase64)
    {
        var publicKey = TryDecode(publicKeyBase64, Ed25519.PublicKeySize);
        var signature = TryDecode(signatureBase64, Ed25519.SignatureSize);
        if (publicKey == null || signature == null || !Ed25519.ValidatePublicKeyFull(publicKey, 0))
        {
            return false;
        }

        return Ed25519.Verify(signature, 0, publicKey, 0, message, 0, message.Length);
    }

    /// <summary>
    /// Whether a signature is the signing key's signature over an account encryption public key.
    /// </summary>
    /// <param name="signingPublicKey">The signer's public key.</param>
    /// <param name="accountPublicKey">The signed account public key (JWK) as sent.</param>
    /// <param name="signature">The signature.</param>
    /// <returns>True when the signature is valid.</returns>
    public static bool VerifyAccountPublicKey(string? signingPublicKey, string? accountPublicKey, string? signature)
    {
        return accountPublicKey != null && Verify(signingPublicKey, SignedMessage(AccountPublicKeyLabel, Encoding.UTF8.GetBytes(accountPublicKey)), signature);
    }

    private static byte[] Utf8(string value) => Encoding.UTF8.GetBytes(value);

    private static byte[]? TryDecode(string? base64, int expectedLength)
    {
        if (string.IsNullOrEmpty(base64))
        {
            return null;
        }

        try
        {
            var bytes = Convert.FromBase64String(base64);
            return bytes.Length == expectedLength ? bytes : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }
}
