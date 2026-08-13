//-----------------------------------------------------------------------
// <copyright file="AnonymizedSenderBucket.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Cryptography.Server;

using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

/// <summary>
/// Keep track of first senders to email aliases in a anonymized way for statistical abuse detection.
/// </summary>
public static class AnonymizedSenderBucket
{
    /// <summary>
    /// The number of buckets any possible sender host will be assigned to based on the hash function.
    /// </summary>
    public const int BucketCount = 64;

    /// <summary>
    /// Compute the bucket a sender host falls into.
    /// </summary>
    /// <param name="salt">The per-instance salt. This keeps buckets from being comparable across installations and
    /// forces an attacker to hold the salt before they can even begin narrowing a bucket down.</param>
    /// <param name="senderHost">The raw host part of the sender address, e.g. "mail.github.com".</param>
    /// <returns>A bucket index in the range [0, <see cref="BucketCount"/>).</returns>
    public static int Compute(string salt, string senderHost)
    {
        var normalized = NormalizeHost(senderHost);
        var hash = HMACSHA256.HashData(Encoding.UTF8.GetBytes(salt), Encoding.UTF8.GetBytes(normalized));
        return (int)(BinaryPrimitives.ReadUInt32BigEndian(hash) % BucketCount);
    }

    /// <summary>
    /// Normalize a host.
    /// </summary>
    /// <param name="host">The host part of an email address.</param>
    /// <returns>The host, lowercased and stripped of surrounding whitespace and any trailing dot.</returns>
    public static string NormalizeHost(string host)
    {
        return host.Trim().TrimEnd('.').ToLowerInvariant();
    }
}
