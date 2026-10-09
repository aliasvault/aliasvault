//-----------------------------------------------------------------------
// <copyright file="VersionedContentService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Services;

using System.Collections.Concurrent;
using System.Security.Cryptography;

/// <summary>
/// Service to provide versioned content paths for cache busting of static files.
/// </summary>
public class VersionedContentService
{
    private readonly ConcurrentDictionary<string, string> _hashCache = new();
    private readonly string _webRootPath;

    /// <summary>
    /// Initializes a new instance of the <see cref="VersionedContentService"/> class.
    /// </summary>
    /// <param name="webRootPath">Web root path.</param>
    /// <exception cref="ArgumentNullException">Thrown if webRootPath is not provided.</exception>
    public VersionedContentService(string webRootPath)
    {
        _webRootPath = webRootPath ?? throw new ArgumentNullException(nameof(webRootPath));
    }

    /// <summary>
    /// Get the versioned path for a content file.
    /// </summary>
    /// <param name="contentPath">Content path to the file.</param>
    /// <returns>Path with version suffix added.</returns>
    public string GetVersionedPath(string contentPath)
    {
        var version = _hashCache.GetOrAdd(contentPath, path => GetVersionHashFrom(Path.Combine(_webRootPath, path.TrimStart('/'))));
        return $"{contentPath}?v={version}";
    }

    /// <summary>
    /// Calculate the version hash for a file.
    /// </summary>
    /// <param name="serverPath">Path to the file on the server.</param>
    /// <returns>MD5 hash.</returns>
    private static string GetVersionHashFrom(string serverPath)
    {
        using var md5 = MD5.Create();
        using var stream = File.OpenRead(serverPath);
        byte[] hash = md5.ComputeHash(stream);
        return BitConverter.ToString(hash).Replace("-", string.Empty).ToLowerInvariant();
    }
}
