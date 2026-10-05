//-----------------------------------------------------------------------
// <copyright file="RefreshTokenHasherTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Utilities;

using AliasVault.Auth;

/// <summary>
/// Tests for the stored form of refresh tokens.
/// </summary>
public class RefreshTokenHasherTests
{
    /// <summary>
    /// The hash must equal the Postgres expression of the HashRefreshTokens migration, encode(sha256(convert_to(v, 'UTF8')), 'hex'),
    /// so tokens issued before the migration keep working. The vector is SHA-256("abc"); the migration expression was run against it.
    /// </summary>
    [Test]
    public void HashMatchesMigrationExpression()
    {
        Assert.That(RefreshTokenHasher.Hash("abc"), Is.EqualTo("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
    }

    /// <summary>
    /// A hash always fits the column and differs per token.
    /// </summary>
    [Test]
    public void HashHasFixedLengthAndIsDistinct()
    {
        var first = RefreshTokenHasher.Hash(Convert.ToBase64String(new byte[32]));
        var second = RefreshTokenHasher.Hash(Convert.ToBase64String(Enumerable.Repeat((byte)1, 32).ToArray()));

        Assert.Multiple(() =>
        {
            Assert.That(first, Has.Length.EqualTo(RefreshTokenHasher.HashLength));
            Assert.That(second, Has.Length.EqualTo(RefreshTokenHasher.HashLength));
            Assert.That(first, Is.Not.EqualTo(second));
        });
    }
}
