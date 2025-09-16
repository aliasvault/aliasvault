//-----------------------------------------------------------------------
// <copyright file="IPAddressValidator.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.FaviconExtractor;

using System;
using System.Net;
using System.Net.Sockets;

/// <summary>
/// Validates IP addresses for public accessibility to prevent SSRF attacks.
/// </summary>
internal static class IPAddressValidator
{
    /// <summary>
    /// Private IPv4 blocks.
    /// </summary>
    private static readonly (byte[] Net, int Prefix)[] PrivateV4Blocks = new[]
    {
        (new byte[] { 10, 0, 0, 0 }, 8),         // private
        (new byte[] { 172, 16, 0, 0 }, 12),      // private
        (new byte[] { 192, 168, 0, 0 }, 16),     // private
        (new byte[] { 169, 254, 0, 0 }, 16),     // link-local
        (new byte[] { 100, 64, 0, 0 }, 10),      // CGNAT
        (new byte[] { 192, 0, 0, 0 }, 24),       // IETF Protocol Assignments
        (new byte[] { 192, 0, 2, 0 }, 24),       // TEST-NET-1
        (new byte[] { 198, 18, 0, 0 }, 15),      // benchmarking
        (new byte[] { 198, 51, 100, 0 }, 24),    // TEST-NET-2
        (new byte[] { 203, 0, 113, 0 }, 24),     // TEST-NET-3
        (new byte[] { 224, 0, 0, 0 }, 4),        // multicast
        (new byte[] { 240, 0, 0, 0 }, 4),        // reserved
        (new byte[] { 0, 0, 0, 0 }, 8),          // local
    };

    /// <summary>
    /// Private IPv6 blocks.
    /// </summary>
    private static readonly (byte[] Net, int Prefix)[] PrivateV6Blocks = new[]
    {
        (new byte[] { 0xfc, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }, 7),         // ULA
        (new byte[] { 0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }, 32), // documentation
    };

    /// <summary>
    /// Checks if an IP address is public (routable on the internet).
    /// </summary>
    /// <param name="address">The IP address to check.</param>
    /// <returns>True if the IP is publicly routable, false otherwise.</returns>
    public static bool IsPublicIPAddress(IPAddress address)
    {
        if (address is null)
        {
            throw new ArgumentNullException(nameof(address));
        }

        // Normalize IPv4-mapped IPv6 addresses to IPv4 for simpler handling.
        if (address.AddressFamily == AddressFamily.InterNetworkV6 && address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        // Loopback / unspecified (0.0.0.0 or ::) are not public.
        if (IPAddress.IsLoopback(address) || address.Equals(IPAddress.None) || address.Equals(IPAddress.IPv6None))
        {
            return false;
        }

        // IPv4 checks.
        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            return IsPublicIPv4Address(address);
        }

        // IPv6 checks.
        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            return IsPublicIPv6Address(address);
        }

        // Unknown family -> treat as non-public.
        return false;
    }

    /// <summary>
    /// Checks if an IPv4 address is public.
    /// </summary>
    /// <param name="address">The IPv4 address to check.</param>
    /// <returns>True if the IP is publicly routable, false otherwise.</returns>
    private static bool IsPublicIPv4Address(IPAddress address)
    {
        var bytes = address.GetAddressBytes();

        // Broadcast 255.255.255.255
        if (bytes[0] == 255 && bytes[1] == 255 && bytes[2] == 255 && bytes[3] == 255)
        {
            return false;
        }

        // Check if the IP address is in any of the private IPv4 block.
        foreach (var (net, prefix) in PrivateV4Blocks)
        {
            if (IsInPrefix(bytes, net, prefix))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Checks if an IPv6 address is public.
    /// </summary>
    /// <param name="address">The IPv6 address to check.</param>
    /// <returns>True if the IP is publicly routable, false otherwise.</returns>
    private static bool IsPublicIPv6Address(IPAddress address)
    {
        // Built-in flags for common non-routable addresses
        if (address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || address.IsIPv6Multicast)
        {
            return false;
        }

        var bytes = address.GetAddressBytes();

        // Check if the IP address is in any of the private IPv6 block.
        foreach (var (net, prefix) in PrivateV6Blocks)
        {
            if (IsInPrefix(bytes, net, prefix))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Checks if an address is within a CIDR prefix.
    /// </summary>
    /// <param name="address">The address bytes to check.</param>
    /// <param name="network">The network prefix bytes.</param>
    /// <param name="prefixLength">The prefix length in bits.</param>
    /// <returns>True if the address is within the prefix, false otherwise.</returns>
    private static bool IsInPrefix(byte[] address, byte[] network, int prefixLength)
    {
        int fullBytes = prefixLength / 8;
        int remainingBits = prefixLength % 8;

        for (int i = 0; i < fullBytes; i++)
        {
            if (address[i] != network[i])
            {
                return false;
            }
        }

        if (remainingBits == 0)
        {
            return true;
        }

        int mask = 0xFF << (8 - remainingBits) & 0xFF;
        return (address[fullBytes] & mask) == (network[fullBytes] & mask);
    }
}
