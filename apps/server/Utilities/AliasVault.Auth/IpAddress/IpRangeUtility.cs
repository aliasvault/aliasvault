//-----------------------------------------------------------------------
// <copyright file="IpRangeUtility.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Auth.IpAddress;

using System.Net;
using System.Net.Sockets;

/// <summary>
/// Utility for parsing, validating, normalizing and matching IP address ranges.
/// Supports IPv4 and IPv6. A bare IP address (without a prefix) is treated as a single host.
/// </summary>
public static class IpRangeUtility
{
    /// <summary>
    /// Attempts to parse a CIDR range (or bare IP address) into a normalized <see cref="IPNetwork"/>.
    /// Host bits beyond the prefix length are masked off, so "1.2.3.4/24" is accepted and normalized to "1.2.3.0/24".
    /// </summary>
    /// <param name="input">The CIDR range or bare IP address to parse.</param>
    /// <param name="network">The resulting normalized network when parsing succeeds.</param>
    /// <returns>True if the input is a valid CIDR range or bare IP address, false otherwise.</returns>
    public static bool TryParse(string? input, out IPNetwork network)
    {
        network = default;

        if (string.IsNullOrWhiteSpace(input))
        {
            return false;
        }

        var trimmed = input.Trim();
        var parts = trimmed.Split('/');
        if (parts.Length > 2)
        {
            return false;
        }

        var addressPart = parts[0].Trim();
        if (!IPAddress.TryParse(addressPart, out var address))
        {
            return false;
        }

        // Validate the address part is a valid IP address.
        if (!addressPart.Contains(':') && addressPart.Split('.').Length != 4)
        {
            return false;
        }

        var maxPrefix = address.AddressFamily == AddressFamily.InterNetworkV6 ? 128 : 32;

        int prefixLength;
        if (parts.Length == 2)
        {
            if (!int.TryParse(parts[1].Trim(), out prefixLength) || prefixLength < 0 || prefixLength > maxPrefix)
            {
                return false;
            }
        }
        else
        {
            // Bare address: treat as a single host.
            prefixLength = maxPrefix;
        }

        var baseAddress = MaskAddress(address, prefixLength);

        try
        {
            network = new IPNetwork(baseAddress, prefixLength);
            return true;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    /// <summary>
    /// Determines whether the provided input is a valid CIDR range or bare IP address.
    /// </summary>
    /// <param name="input">The value to validate.</param>
    /// <returns>True if valid, false otherwise.</returns>
    public static bool IsValid(string? input) => TryParse(input, out _);

    /// <summary>
    /// Normalizes a CIDR range (or bare IP address) to its canonical "base/prefix" string representation.
    /// </summary>
    /// <param name="input">The value to normalize.</param>
    /// <returns>The normalized CIDR string, or null when the input is invalid.</returns>
    public static string? Normalize(string? input)
    {
        return TryParse(input, out var network) ? network.ToString() : null;
    }

    /// <summary>
    /// Determines whether the given IP address falls within the given network.
    /// </summary>
    /// <param name="network">The network to test against.</param>
    /// <param name="address">The IP address to test.</param>
    /// <returns>True if the address is contained in the network, false otherwise.</returns>
    public static bool Contains(IPNetwork network, IPAddress? address)
    {
        if (address is null)
        {
            return false;
        }

        var normalized = NormalizeAddress(address);
        return network.Contains(normalized);
    }

    /// <summary>
    /// Unwraps an IPv4-mapped IPv6 address into its native IPv4 form.
    /// </summary>
    /// <param name="address">The address to normalize.</param>
    /// <returns>The normalized IP address.</returns>
    public static IPAddress NormalizeAddress(IPAddress address)
    {
        return address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address;
    }

    /// <summary>
    /// Masks the address to the network base.
    /// </summary>
    /// <param name="address">The address to mask.</param>
    /// <param name="prefixLength">The network prefix length.</param>
    /// <returns>The masked (network base) address.</returns>
    private static IPAddress MaskAddress(IPAddress address, int prefixLength)
    {
        var bytes = address.GetAddressBytes();

        for (var i = 0; i < bytes.Length; i++)
        {
            var bitsForThisByte = prefixLength - (i * 8);
            if (bitsForThisByte >= 8)
            {
                // Fully within the network portion; keep the byte as-is.
                continue;
            }

            if (bitsForThisByte <= 0)
            {
                // Fully within the host portion; zero it out.
                bytes[i] = 0;
            }
            else
            {
                // Partial byte; keep the high 'bitsForThisByte' bits.
                var mask = (byte)(0xFF << (8 - bitsForThisByte));
                bytes[i] &= mask;
            }
        }

        return new IPAddress(bytes);
    }
}
