//-----------------------------------------------------------------------
// <copyright file="TotpGeneratorTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Utilities;

/// <summary>
/// Tests for the TotpGeneratorTests class.
/// </summary>
public class TotpGeneratorTests
{
    private const string TestSecretKey = "JBSWY3DPEHPK3PXP";

    /// <summary>
    /// Tests if the GenerateTotpCode method returns a valid code.
    /// </summary>
    [Test]
    public void GenerateTotpCode_ReturnsValidCode()
    {
        string code = TotpGenerator.TotpGenerator.GenerateTotpCode(TestSecretKey);
        Assert.That(code, Has.Length.EqualTo(6));
        Assert.That(code, Does.Match(@"^\d{6}$"));
    }

    /// <summary>
    /// Tests if the GenerateTotpCode method returns a code with the correct length.
    /// </summary>
    [Test]
    public void GenerateTotpCode_WithCustomDigits_ReturnsCodeWithCorrectLength()
    {
        string code = TotpGenerator.TotpGenerator.GenerateTotpCode(TestSecretKey, digits: 8);
        Assert.That(code, Has.Length.EqualTo(8));
        Assert.That(code, Does.Match(@"^\d{8}$"));
    }

    /// <summary>
    /// Tests if the GenerateTotpCode method returns a code when the secret key contains spaces and hyphens.
    /// </summary>
    [Test]
    public void GenerateTotpCode_WithSpacesAndHyphens_ReturnsValidCode()
    {
        string secretWithSpacesAndHyphens = "JBSW Y3DP-EHPK 3PXP";
        string code = TotpGenerator.TotpGenerator.GenerateTotpCode(secretWithSpacesAndHyphens);
        Assert.That(code, Has.Length.EqualTo(6));
        Assert.That(code, Does.Match(@"^\d{6}$"));
    }

    /// <summary>
    /// Tests if the VerifyTotpCode method returns true for a valid code.
    /// </summary>
    [Test]
    public void VerifyTotpCode_WithValidCode_ReturnsTrue()
    {
        string code = TotpGenerator.TotpGenerator.GenerateTotpCode(TestSecretKey);
        bool isValid = TotpGenerator.TotpGenerator.VerifyTotpCode(TestSecretKey, code);
        Assert.That(isValid, Is.True);
    }

    /// <summary>
    /// Tests if the VerifyTotpCode method returns false for an invalid code.
    /// </summary>
    [Test]
    public void VerifyTotpCode_WithInvalidCode_ReturnsFalse()
    {
        string invalidCode = "000000";
        bool isValid = TotpGenerator.TotpGenerator.VerifyTotpCode(TestSecretKey, invalidCode);
        Assert.That(isValid, Is.False);
    }

    /// <summary>
    /// Tests if the VerifyTotpCode method throws an exception for an invalid secret key.
    /// </summary>
    [Test]
    public void GenerateTotpCode_WithInvalidSecretKey_ThrowsException()
    {
        string invalidSecret = "INVALID!@#";
        Assert.Throws<ArgumentException>(() => TotpGenerator.TotpGenerator.GenerateTotpCode(invalidSecret));
    }

    /// <summary>
    /// Tests that each supported algorithm produces a well-formed code and that SHA256/SHA512 do not
    /// silently fall back to SHA1 (which would generate codes the service rejects).
    /// </summary>
    /// <param name="algorithm">The HMAC algorithm to generate with.</param>
    [Test]
    [TestCase("SHA1")]
    [TestCase("SHA256")]
    [TestCase("SHA512")]
    public void GenerateTotpCode_WithAlgorithm_ReturnsValidCode(string algorithm)
    {
        string code = TotpGenerator.TotpGenerator.GenerateTotpCode(TestSecretKey, algorithm: algorithm);
        Assert.That(code, Does.Match(@"^\d{6}$"));
        Assert.That(TotpGenerator.TotpGenerator.VerifyTotpCode(TestSecretKey, code, algorithm: algorithm), Is.True);
    }

    /// <summary>
    /// Tests that a code generated with SHA256 does not verify as SHA1, proving the algorithm actually
    /// reaches the HMAC rather than being accepted and ignored.
    /// </summary>
    [Test]
    public void GenerateTotpCode_WithSha256_DoesNotVerifyAsSha1()
    {
        string code = TotpGenerator.TotpGenerator.GenerateTotpCode(TestSecretKey, algorithm: "SHA256");
        Assert.That(TotpGenerator.TotpGenerator.VerifyTotpCode(TestSecretKey, code, algorithm: "SHA1"), Is.False);
    }

    /// <summary>
    /// Tests that an unrecognized algorithm degrades to SHA1 instead of throwing, so one bad imported
    /// value cannot make an item unreadable.
    /// </summary>
    [Test]
    public void GenerateTotpCode_WithUnknownAlgorithm_FallsBackToSha1()
    {
        string code = TotpGenerator.TotpGenerator.GenerateTotpCode(TestSecretKey, algorithm: "MD5");
        Assert.That(code, Is.EqualTo(TotpGenerator.TotpGenerator.GenerateTotpCode(TestSecretKey, algorithm: "SHA1")));
    }

    /// <summary>
    /// Tests that an otpauth:// URI's algorithm, digits and period are preserved rather than discarded.
    /// </summary>
    [Test]
    public void SanitizeSecretKey_WithParameters_PreservesThem()
    {
        var (secretKey, _, parameters) = TotpGenerator.TotpHelper.SanitizeSecretKey($"otpauth://totp/Example:user@example.com?secret={TestSecretKey}&issuer=Example&algorithm=SHA512&digits=8&period=60");

        Assert.Multiple(() =>
        {
            Assert.That(secretKey, Is.EqualTo(TestSecretKey));
            Assert.That(parameters.Algorithm, Is.EqualTo("SHA512"));
            Assert.That(parameters.Digits, Is.EqualTo(8));
            Assert.That(parameters.Period, Is.EqualTo(60));
        });
    }

    /// <summary>
    /// Tests that an otpauth:// URI without parameters yields the RFC 6238 defaults.
    /// </summary>
    [Test]
    public void SanitizeSecretKey_WithoutParameters_ReturnsDefaults()
    {
        var (_, _, parameters) = TotpGenerator.TotpHelper.SanitizeSecretKey($"otpauth://totp/Example:user@example.com?secret={TestSecretKey}&issuer=Example");
        Assert.That(parameters, Is.EqualTo(TotpGenerator.TotpParameters.Default));
    }

    /// <summary>
    /// Tests that out-of-range or nonsense parameters are normalized to the defaults instead of being
    /// stored verbatim and breaking code generation later.
    /// </summary>
    [Test]
    public void SanitizeSecretKey_WithInvalidParameters_NormalizesToDefaults()
    {
        var (_, _, parameters) = TotpGenerator.TotpHelper.SanitizeSecretKey($"otpauth://totp/Example?secret={TestSecretKey}&algorithm=ROT13&digits=99&period=0");
        Assert.That(parameters, Is.EqualTo(TotpGenerator.TotpParameters.Default));
    }
}
