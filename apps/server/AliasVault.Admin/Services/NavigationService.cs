//-----------------------------------------------------------------------
// <copyright file="NavigationService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Services;

using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Routing;

/// <summary>
/// Navigation helper service.
/// </summary>
public class NavigationService
{
    private readonly NavigationManager _navigationManager;

    /// <summary>
    /// Initializes a new instance of the <see cref="NavigationService"/> class.
    /// </summary>
    /// <param name="navigationManager">NavigationManager instance.</param>
    public NavigationService(NavigationManager navigationManager)
    {
        _navigationManager = navigationManager;
        _navigationManager.LocationChanged += (sender, args) => { LocationChanged?.Invoke(sender, args); };
    }

    /// <summary>
    /// Location changed event.
    /// </summary>
    public event EventHandler<LocationChangedEventArgs>? LocationChanged;

    /// <summary>
    /// Gets the Base URI.
    /// </summary>
    public string BaseUri => _navigationManager.BaseUri;

    /// <summary>
    /// Gets the URI.
    /// </summary>
    public string Uri => _navigationManager.Uri;

    /// <summary>
    /// Gets the current path.
    /// </summary>
    private string CurrentPath => _navigationManager.ToAbsoluteUri(_navigationManager.Uri).GetLeftPart(UriPartial.Path);

    /// <summary>
    /// Redirect to the current page.
    /// </summary>
    public void RedirectToCurrentPage() => RedirectTo(CurrentPath);

    /// <summary>
    /// Redirect to the specified URI.
    /// </summary>
    /// <param name="uri">The uri to redirect to.</param>
    /// <param name="forceLoad">Force load true/false.</param>
    public void RedirectTo(string? uri, bool forceLoad = false)
    {
        _navigationManager.NavigateTo(ToLocalPath(uri), forceLoad);
    }

    /// <summary>
    /// Redirect to the specified URI with query parameters.
    /// </summary>
    /// <param name="uri">URI to redirect to.</param>
    /// <param name="queryParameters">Optional querystring parameters to add to the URL.</param>
    /// <param name="forceLoad">Force load true/false.</param>
    public void RedirectTo(string uri, Dictionary<string, object?> queryParameters, bool forceLoad = false)
    {
        var uriWithoutQuery = _navigationManager.ToAbsoluteUri(uri).GetLeftPart(UriPartial.Path);
        var newUri = _navigationManager.GetUriWithQueryParameters(uriWithoutQuery, queryParameters);
        RedirectTo(newUri, forceLoad);
    }

    /// <summary>
    /// Returns a URI constructed from <paramref name="uri" /> except with multiple parameters
    /// added, updated, or removed.
    /// </summary>
    /// <param name="uri">The URI with the query to modify.</param>
    /// <param name="parameters">The values to add, update, or remove.</param>
    /// <returns>The URI with the query modified.</returns>
    public string GetUriWithQueryParameters(string uri, IReadOnlyDictionary<string, object?> parameters) => _navigationManager.GetUriWithQueryParameters(uri, parameters);

    /// <summary>
    /// Converts a relative URI into an absolute one (by resolving it
    /// relative to the current absolute URI).
    /// </summary>
    /// <param name="relativeUri">The relative URI.</param>
    /// <returns>The absolute URI.</returns>
    public Uri ToAbsoluteUri(string relativeUri) => _navigationManager.ToAbsoluteUri(relativeUri);

    /// <summary>
    /// Whether a path stays inside the app: a single leading slash at most, no backslash and no scheme.
    /// Scheme-relative targets (//host) and backslash variants (/\host) would be followed to another host by the browser.
    /// </summary>
    /// <param name="path">The path to check.</param>
    /// <returns>True when the path is local.</returns>
    private static bool IsLocalPath(string path)
    {
        if (path.Length == 0)
        {
            return true;
        }

        if (path.Contains('\\'))
        {
            return false;
        }

        if (path[0] == '/')
        {
            return path.Length == 1 || path[1] != '/';
        }

        // Without a leading slash the path is relative to the base URI, unless its first segment carries a scheme.
        var firstSegmentEnd = path.IndexOfAny(['/', '?', '#']);
        var firstSegment = firstSegmentEnd < 0 ? path : path[..firstSegmentEnd];
        return !firstSegment.Contains(':');
    }

    /// <summary>
    /// Reduce a redirect target (e.g. a ReturnUrl query parameter) to a path inside this app, so it can never leave it.
    /// </summary>
    /// <param name="uri">The requested target.</param>
    /// <returns>A path relative to the app's base URI, or the base URI itself when the target leaves the app.</returns>
    private string ToLocalPath(string? uri)
    {
        if (string.IsNullOrEmpty(uri))
        {
            return string.Empty;
        }

        // An absolute URI is only followed when it is inside this app.
        if (uri.StartsWith(_navigationManager.BaseUri, StringComparison.OrdinalIgnoreCase))
        {
            uri = _navigationManager.ToBaseRelativePath(uri);
        }

        return IsLocalPath(uri) ? uri : string.Empty;
    }
}
