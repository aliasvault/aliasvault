//-----------------------------------------------------------------------
// <copyright file="TotpHelper.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.TotpGenerator;

/// <summary>
/// Helper class to verify and sanitize TOTP codes.
/// </summary>
public static class TotpHelper
{
    /// <summary>
    /// Sanitizes a TOTP secret if its provided as a URI. Any algorithm/digits/period parameters carried by
    /// the URI are returned alongside the secret so they can be stored rather than silently defaulted.
    /// </summary>
    /// <param name="secretKey">The secret key in Base32 encoding.</param>
    /// <param name="name">The name of the TOTP code.</param>
    /// <returns>The sanitized secret key, name and TOTP parameters.</returns>
    public static (string SecretKey, string? Name, TotpParameters Parameters) SanitizeSecretKey(string secretKey, string? name = null)
    {
        var parameters = TotpParameters.Default;

        // Check if the input is a TOTP URI
        if (secretKey.StartsWith("otpauth://totp/"))
        {
            try
            {
                var uri = new Uri(secretKey);
                var queryParams = System.Web.HttpUtility.ParseQueryString(uri.Query);

                // Extract the secret from query parameters
                secretKey = queryParams["secret"] ?? throw new ArgumentException("Secret not found in URI");

                // Keep the URI's TOTP parameters; without them an imported code that uses e.g. SHA256
                // or an 8-digit length would silently generate codes the service rejects.
                parameters = new TotpParameters(
                    TotpParameters.NormalizeAlgorithm(queryParams["algorithm"]),
                    TotpParameters.NormalizeDigits(queryParams["digits"]),
                    TotpParameters.NormalizePeriod(queryParams["period"]));

                // If no name was provided, try to get it from the URI
                if (string.IsNullOrWhiteSpace(name))
                {
                    // The label is everything after 'totp/' and before '?'
                    var label = System.Web.HttpUtility.UrlDecode(uri.AbsolutePath.TrimStart('/'));

                    // Check if there's an issuer in the query params
                    var issuer = queryParams["issuer"];

                    // If the label contains ':', it might be in the format "issuer:account"
                    // Only split if there's no issuer in query params (to avoid splitting account names with colons)
                    if (label.Contains(':') && string.IsNullOrWhiteSpace(issuer))
                    {
                        // Split on the first colon only
                        var colonIndex = label.IndexOf(':');
                        name = label.Substring(colonIndex + 1);
                    }
                    else
                    {
                        name = label;
                    }

                    // If there's an issuer in the query params, use it as a prefix
                    if (!string.IsNullOrWhiteSpace(issuer))
                    {
                        name = $"{issuer}: {name}";
                    }
                }
            }
            catch (Exception)
            {
                throw new ArgumentException("Invalid TOTP URI format. Please check and try again.");
            }
        }

        try
        {
            // Validate the secret key by trying to generate a code
            TotpGenerator.GenerateTotpCode(secretKey, parameters.Digits, parameters.Period, parameters.Algorithm);
        }
        catch (Exception)
        {
            throw new ArgumentException("Invalid secret key. Please check and try again.");
        }

        return (secretKey, name, parameters);
    }
}
