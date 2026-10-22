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
    /// The label of the vault name an invitation carries, signed by the inviter.
    /// </summary>
    public const string InvitationNameLabel = "aliasvault/v1/sig/invitation-name";

    /// <summary>
    /// The label of moving an email alias to another manifest, signed by the user who moves it.
    /// </summary>
    public const string EmailClaimTransferLabel = "aliasvault/v1/sig/email-claim-transfer";

    /// <summary>
    /// The label of a Login with Mobile approval, signed by the approving user.
    /// </summary>
    public const string MobileLoginApprovalLabel = "aliasvault/v1/sig/mobile-login-approval";

    /// <summary>
    /// The label of a key certification: one user vouching that a signing public key belongs to another user.
    /// </summary>
    public const string KeyCertificationLabel = "aliasvault/v1/sig/key-certification";

    /// <summary>
    /// The label under which a signing public key is hashed into its fingerprint, the user's account fingerprint.
    /// </summary>
    public const string FingerprintLabel = "aliasvault/v1/signing-key-fingerprint";

    /// <summary>
    /// The decimal digits in a fingerprint (the value is reduced modulo 10^20).
    /// </summary>
    public const int FingerprintDigits = 20;

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
    /// Builds the signed message of the vault name an invitation carries.
    /// </summary>
    /// <param name="manifestId">The manifest the invitation is for.</param>
    /// <param name="signerUserId">The inviter.</param>
    /// <param name="recipientPublicKey">The recipient public key (JWK) the name is encrypted for, as stored.</param>
    /// <param name="encryptedName">The encrypted name.</param>
    /// <returns>The message bytes.</returns>
    public static byte[] InvitationNameMessage(Guid manifestId, string signerUserId, string recipientPublicKey, string encryptedName)
    {
        return SignedMessage(InvitationNameLabel, Utf8(manifestId.ToString()), Utf8(signerUserId), Utf8(recipientPublicKey), Utf8(encryptedName));
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
    /// Builds the signed message of moving an email alias to another manifest, bound to the claim version so it cannot be replayed.
    /// </summary>
    /// <param name="address">The alias address, trimmed and lowercased.</param>
    /// <param name="sourceManifestId">The manifest that owns the alias before the move.</param>
    /// <param name="targetManifestId">The manifest that owns the alias after the move.</param>
    /// <param name="claimVersion">The claim version the client was served.</param>
    /// <returns>The message bytes.</returns>
    public static byte[] EmailClaimTransferMessage(string address, Guid sourceManifestId, Guid targetManifestId, long claimVersion)
    {
        return SignedMessage(EmailClaimTransferLabel, Utf8(address), Utf8(sourceManifestId.ToString()), Utf8(targetManifestId.ToString()), Utf8(claimVersion.ToString(System.Globalization.CultureInfo.InvariantCulture)));
    }

    /// <summary>
    /// Builds the signed message of a Login with Mobile approval: the Account Key encrypted for the requesting client.
    /// </summary>
    /// <param name="requestId">The Login with Mobile request.</param>
    /// <param name="algorithm">The algorithm of the encrypted Account Key.</param>
    /// <param name="encryptedAccountKey">The encrypted Account Key.</param>
    /// <returns>The message bytes.</returns>
    public static byte[] MobileLoginApprovalMessage(string requestId, string algorithm, string encryptedAccountKey)
    {
        return SignedMessage(MobileLoginApprovalLabel, Utf8(requestId), Utf8(algorithm), Utf8(encryptedAccountKey));
    }

    /// <summary>
    /// Builds the signed message of a key certification: the certifier vouches that a signing public key belongs to the subject.
    /// </summary>
    /// <param name="certifierUserId">The user vouching for the key.</param>
    /// <param name="subjectUserId">The user the key belongs to.</param>
    /// <param name="subjectSigningPublicKey">The certified signing public key (base64).</param>
    /// <returns>The message bytes.</returns>
    public static byte[] KeyCertificationMessage(string certifierUserId, string subjectUserId, string subjectSigningPublicKey)
    {
        return SignedMessage(KeyCertificationLabel, Utf8(certifierUserId), Utf8(subjectUserId), Utf8(subjectSigningPublicKey));
    }

    /// <summary>
    /// The fingerprint of a signing public key as <see cref="FingerprintDigits"/> digits without separators, the same digits the
    /// Rust core prints in groups of four. Null for a value that is not an Ed25519 public key.
    /// </summary>
    /// <param name="publicKeyBase64">The signing public key (base64).</param>
    /// <returns>The fingerprint digits, or null.</returns>
    public static string? Fingerprint(string? publicKeyBase64)
    {
        var publicKey = TryDecode(publicKeyBase64, Ed25519.PublicKeySize);
        if (publicKey == null)
        {
            return null;
        }

        var digest = System.Security.Cryptography.SHA256.HashData(SignedMessage(FingerprintLabel, publicKey));
        var value = BinaryPrimitives.ReadUInt128BigEndian(digest) % UInt128.Parse("100000000000000000000", System.Globalization.CultureInfo.InvariantCulture);
        return value.ToString("D" + FingerprintDigits, System.Globalization.CultureInfo.InvariantCulture);
    }

    /// <summary>
    /// The digits of a code a user typed, ignoring spaces and dashes.
    /// </summary>
    /// <param name="code">The typed code.</param>
    /// <returns>Only its digits.</returns>
    public static string NormalizeFingerprint(string? code)
    {
        return new string((code ?? string.Empty).Where(char.IsAsciiDigit).ToArray());
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
