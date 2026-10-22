//-----------------------------------------------------------------------
// <copyright file="SigningTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Utilities;

using AliasVault.Cryptography;

/// <summary>
/// Known-answer tests shared with the Rust core's signing.rs; a changed output means server and clients disagree.
/// </summary>
public class SigningTests
{
    /// <summary>
    /// The public key of the private seed 0x00..0x1f, as in signing.rs.
    /// </summary>
    private const string PublicKeyVector = "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=";

    /// <summary>
    /// The fingerprint equals the Rust core's FINGERPRINT_VECTOR without its dashes.
    /// </summary>
    [Test]
    public void FingerprintKnownAnswer()
    {
        Assert.That(Signing.Fingerprint(PublicKeyVector), Is.EqualTo("09196981526592105908"));
        Assert.That(Signing.Fingerprint("not base64!"), Is.Null);
        Assert.That(Signing.NormalizeFingerprint(" 0919-6981 5265-9210 5908 "), Is.EqualTo("09196981526592105908"));
    }

    /// <summary>
    /// The key certification message equals the Rust core's KEY_CERTIFICATION_MESSAGE_VECTOR.
    /// </summary>
    [Test]
    public void KeyCertificationMessageKnownAnswer()
    {
        var message = Signing.KeyCertificationMessage("user-1", "user-2", PublicKeyVector);
        Assert.That(Convert.ToHexStringLower(message), Is.EqualTo("00000023616c6961737661756c742f76312f7369672f6b65792d63657274696669636174696f6e00000006757365722d3100000006757365722d320000002c41364548762f504f454c3464634e3059353076416d57666b316a436270513166486479475a424a564d62673d"));
    }

    /// <summary>
    /// The email claim transfer message equals the Rust core's EMAIL_CLAIM_TRANSFER_MESSAGE_VECTOR.
    /// </summary>
    [Test]
    public void EmailClaimTransferMessageKnownAnswer()
    {
        var message = Signing.EmailClaimTransferMessage("alias@example.com", Guid.Parse("0A1B2C3D-0000-0000-0000-000000000001"), Guid.Parse("0A1B2C3D-0000-0000-0000-000000000002"), 1767225600000);
        Assert.That(Convert.ToHexStringLower(message), Is.EqualTo("00000026616c6961737661756c742f76312f7369672f656d61696c2d636c61696d2d7472616e7366657200000011616c696173406578616d706c652e636f6d0000002430613162326333642d303030302d303030302d303030302d3030303030303030303030310000002430613162326333642d303030302d303030302d303030302d3030303030303030303030320000000d31373637323235363030303030"));
    }
}
