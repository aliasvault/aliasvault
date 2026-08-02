//-----------------------------------------------------------------------
// <copyright file="FaviconExtractor.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.FaviconExtractor;

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using HtmlAgilityPack;
using SkiaSharp;

/// <summary>
/// Favicon service for extracting favicons from URLs.
/// </summary>
public static class FaviconExtractor
{
    private const int MaxSizeBytes = 20 * 1024; // 20KB max size; images above this are resized/re-encoded.
    private const int MaxResponseBytes = 5 * 1024 * 1024; // 5MB cap per response body, measured after decompression.
    private const int MaxDecodedPixels = 2048 * 2048; // Pixel budget per image; see IsWithinDecodePixelBudget.
    private const int MaxFaviconCandidates = 10; // Distinct favicon URLs fetched per page; see TryExtractFaviconFromNodes.
    private static readonly TimeSpan _extractionDeadline = TimeSpan.FromSeconds(5); // Wall-clock budget for one full extraction.
    private static readonly TimeSpan _requestTimeout = TimeSpan.FromSeconds(3); // Per-request budget, so one slow host still leaves room for another candidate.
    private static readonly int[] _resizeWidths = [96, 64, 48, 32];
    private static readonly int[] _jpegFallbackQualities = [80, 65, 50];
    private static readonly string[] _allowedSchemes = ["http", "https"];

    // Formats every AliasVault client (web, browser extension, mobile) can render safely.
    // Anything else is re-encoded to one of these or rejected.
    private static readonly ImageFormatSignature[] _clientSafeFormats =
    [
        ImageFormatSignature.Ico,
        ImageFormatSignature.Png,
        ImageFormatSignature.Jpeg,
        ImageFormatSignature.Gif,
        ImageFormatSignature.Webp,
        ImageFormatSignature.Svg,
    ];

    /// <summary>
    /// Image formats that can be identified from a file's leading magic bytes.
    /// </summary>
    internal enum ImageFormatSignature
    {
        /// <summary>Format could not be identified.</summary>
        Unknown,

        /// <summary>Windows icon (ICO).</summary>
        Ico,

        /// <summary>PNG.</summary>
        Png,

        /// <summary>JPEG.</summary>
        Jpeg,

        /// <summary>GIF.</summary>
        Gif,

        /// <summary>WebP.</summary>
        Webp,

        /// <summary>BMP (Windows bitmap).</summary>
        Bmp,

        /// <summary>TIFF.</summary>
        Tiff,

        /// <summary>HEIF/HEIC.</summary>
        Heif,

        /// <summary>AVIF.</summary>
        Avif,

        /// <summary>SVG (XML vector format).</summary>
        Svg,
    }

    /// <summary>
    /// Extracts the favicon from a URL with enhanced browser like behavior.
    /// </summary>
    /// <param name="url">The URL to extract the favicon for.</param>
    /// <returns>Byte array for favicon image.</returns>
    public static async Task<byte[]?> GetFaviconAsync(string url)
    {
        url = NormalizeUrl(url);
        Uri uri = new(url);

        if (!IsAllowedSchemeAndPort(uri))
        {
            return null;
        }

        using HttpClient client = CreateHttpClient();

        // Set a limit for how long the extraction can take.
        using var deadline = new CancellationTokenSource(_extractionDeadline);

        try
        {
            // Attempt the operation up to two times to handle common cookiewall redirects or transient issues.
            for (int attempt = 0; attempt < 2; attempt++)
            {
                var result = await TryGetFaviconAsync(client, uri, deadline.Token);
                if (result != null)
                {
                    return result;
                }
            }
        }
        catch (HttpRequestException)
        {
            // Abort on any request exception.
            return null;
        }
        catch (OperationCanceledException)
        {
            // Overall deadline hit: give up rather than letting the favicon extraction result in a too long client side hang.
            return null;
        }

        // Return null if the favicon extraction failed.
        return null;
    }

    /// <summary>
    /// Extracts favicons for multiple URLs in parallel. Each URL is processed independently;
    /// individual failures are returned as null entries rather than throwing. The returned
    /// list lines up index-for-index with the input.
    /// </summary>
    /// <param name="urls">The URLs to extract favicons for.</param>
    /// <returns>A list of favicon byte arrays, in the same order as the input urls.</returns>
    public static async Task<IReadOnlyList<byte[]?>> GetFaviconsAsync(IReadOnlyList<string> urls)
    {
        if (urls.Count == 0)
        {
            return Array.Empty<byte[]?>();
        }

        var tasks = new Task<byte[]?>[urls.Count];
        for (int i = 0; i < urls.Count; i++)
        {
            // Wrap each call in a try/catch so one bad URL doesn't fail the whole batch.
            var url = urls[i];
            tasks[i] = SafeGetFaviconAsync(url);
        }

        return await Task.WhenAll(tasks);
    }

    /// <summary>
    /// Detects an image's format from its leading magic bytes.
    /// </summary>
    /// <param name="bytes">The raw image bytes.</param>
    /// <returns>The detected <see cref="ImageFormatSignature"/>, or <see cref="ImageFormatSignature.Unknown"/> if unrecognized.</returns>
    internal static ImageFormatSignature DetectImageFormat(byte[] bytes)
    {
        // ICO: 00 00 01 00
        if (bytes.Length >= 4 && bytes[0] == 0x00 && bytes[1] == 0x00 && bytes[2] == 0x01 && bytes[3] == 0x00)
        {
            return ImageFormatSignature.Ico;
        }

        // PNG: 89 50 4E 47
        if (bytes.Length >= 4 && bytes[0] == 0x89 && bytes[1] == 0x50 && bytes[2] == 0x4E && bytes[3] == 0x47)
        {
            return ImageFormatSignature.Png;
        }

        // JPEG: FF D8 FF
        if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
        {
            return ImageFormatSignature.Jpeg;
        }

        // GIF: "GIF"
        if (bytes.Length >= 3 && bytes[0] == 0x47 && bytes[1] == 0x49 && bytes[2] == 0x46)
        {
            return ImageFormatSignature.Gif;
        }

        // BMP: "BM"
        if (bytes.Length >= 2 && bytes[0] == 0x42 && bytes[1] == 0x4D)
        {
            return ImageFormatSignature.Bmp;
        }

        // TIFF: "II*\0" (little-endian) or "MM\0*" (big-endian)
        if (bytes.Length >= 4 &&
            ((bytes[0] == 0x49 && bytes[1] == 0x49 && bytes[2] == 0x2A && bytes[3] == 0x00) ||
             (bytes[0] == 0x4D && bytes[1] == 0x4D && bytes[2] == 0x00 && bytes[3] == 0x2A)))
        {
            return ImageFormatSignature.Tiff;
        }

        // WEBP: "RIFF" .... "WEBP"
        if (bytes.Length >= 12 &&
            bytes[0] == 0x52 && bytes[1] == 0x49 && bytes[2] == 0x46 && bytes[3] == 0x46 &&
            bytes[8] == 0x57 && bytes[9] == 0x45 && bytes[10] == 0x42 && bytes[11] == 0x50)
        {
            return ImageFormatSignature.Webp;
        }

        // ISO-BMFF container (HEIC/HEIF/AVIF): bytes 4-7 == "ftyp", brand at bytes 8-11.
        if (bytes.Length >= 12 && bytes[4] == 0x66 && bytes[5] == 0x74 && bytes[6] == 0x79 && bytes[7] == 0x70)
        {
            var brand = Encoding.ASCII.GetString(bytes, 8, 4);
            return brand.StartsWith("avif", StringComparison.Ordinal) || brand.StartsWith("avis", StringComparison.Ordinal)
                ? ImageFormatSignature.Avif
                : ImageFormatSignature.Heif;
        }

        // SVG: text-based vector format.
        if (LooksLikeSvg(bytes))
        {
            return ImageFormatSignature.Svg;
        }

        return ImageFormatSignature.Unknown;
    }

    /// <summary>
    /// Checks whether a set of IP addresses are all publicly routable.
    /// </summary>
    /// <param name="addresses">The addresses returned by one DNS resolution.</param>
    /// <returns>True if all addresses are publicly routable, false otherwise.</returns>
    internal static bool AreIpAddressesPublic(IPAddress[] addresses)
    {
        // An empty set has nothing to vouch for, so it must never be treated as validated.
        if (addresses.Length == 0)
        {
            return false;
        }

        foreach (var address in addresses)
        {
            if (!IPAddressValidator.IsPublicIPAddress(address))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Checks that an image's declared pixel dimensions fit within the decode budget to prevent
    /// potential memory exhaustion for very large images.
    /// </summary>
    /// <param name="imageBytes">The raw image bytes.</param>
    /// <returns>True if the image is a decodable raster image within the pixel budget, false otherwise.</returns>
    internal static bool IsWithinDecodePixelBudget(byte[] imageBytes)
    {
        using var data = SKData.CreateCopy(imageBytes);
        using var codec = SKCodec.Create(data);

        // Not a decodable raster image at all; nothing downstream can render it either.
        if (codec is null)
        {
            return false;
        }

        var info = codec.Info;
        if (info.Width <= 0 || info.Height <= 0)
        {
            return false;
        }

        return (long)info.Width * info.Height <= MaxDecodedPixels;
    }

    /// <summary>
    /// Opens the TCP connection for an outgoing request and resolve a hostname only once.
    /// </summary>
    /// <param name="context">Connection context supplied by the HTTP stack.</param>
    /// <param name="cancellationToken">Token to cancel the connection attempt.</param>
    /// <returns>A stream over the established connection.</returns>
    private static async ValueTask<Stream> ConnectToValidatedAddressAsync(SocketsHttpConnectionContext context, CancellationToken cancellationToken)
    {
        var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, cancellationToken);
        if (!AreIpAddressesPublic(addresses))
        {
            throw new HttpRequestException("Blocked connection to a non-public address.");
        }

        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(addresses, context.DnsEndPoint.Port, cancellationToken);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }

    private static async Task<byte[]?> SafeGetFaviconAsync(string url)
    {
        try
        {
            return await GetFaviconAsync(url);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Tries to get the favicon from the URL.
    /// </summary>
    /// <param name="client">The HTTP client.</param>
    /// <param name="uri">The URI to get the favicon from.</param>
    /// <param name="cancellationToken">Token maxing the overall extraction.</param>
    /// <returns>The favicon bytes.</returns>
    private static async Task<byte[]?> TryGetFaviconAsync(HttpClient client, Uri uri, CancellationToken cancellationToken)
    {
        var response = await FollowRedirectsAsync(client, uri, cancellationToken);

        if (response == null || !response.IsSuccessStatusCode)
        {
            return null;
        }

        var faviconNodes = await GetFaviconNodesFromHtml(response, uri, cancellationToken);
        return await TryExtractFaviconFromNodes(faviconNodes, client, uri, cancellationToken);
    }

    /// <summary>
    /// Gets the favicon nodes from the HTML.
    /// </summary>
    /// <param name="response">The response to get the favicon nodes from.</param>
    /// <param name="uri">The URI to get the favicon nodes from.</param>
    /// <param name="cancellationToken">Token maxing the overall extraction.</param>
    /// <returns>The favicon nodes.</returns>
    private static async Task<HtmlNodeCollection[]> GetFaviconNodesFromHtml(HttpResponseMessage response, Uri uri, CancellationToken cancellationToken)
    {
        string htmlContent = await response.Content.ReadAsStringAsync(cancellationToken);
        HtmlDocument htmlDoc = new();
        htmlDoc.LoadHtml(htmlContent);

        var defaultFavicon = new HtmlNode(HtmlNodeType.Element, htmlDoc, 0);
        defaultFavicon.Attributes.Add("href", $"{uri.GetLeftPart(UriPartial.Authority)}/favicon.ico");

        // Get the favicon nodes from the HTML, in order of preference.
        HtmlNodeCollection?[] nodeArray =
        [
            htmlDoc.DocumentNode.SelectNodes("//link[@rel='icon' and @type='image/svg+xml']"),
            htmlDoc.DocumentNode.SelectNodes("//link[@rel='icon' and @sizes='96x96']"),
            htmlDoc.DocumentNode.SelectNodes("//link[@rel='icon' and @sizes='128x128']"),
            htmlDoc.DocumentNode.SelectNodes("//link[@rel='icon' and @sizes='48x48']"),
            htmlDoc.DocumentNode.SelectNodes("//link[@rel='icon' and @sizes='32x32']"),
            htmlDoc.DocumentNode.SelectNodes("//link[@rel='icon' and @sizes='192x192']"),
            htmlDoc.DocumentNode.SelectNodes("//link[@rel='apple-touch-icon' or @rel='apple-touch-icon-precomposed']"),
            htmlDoc.DocumentNode.SelectNodes("//link[@rel='icon' or @rel='shortcut icon']"),
            new HtmlNodeCollection(htmlDoc.DocumentNode) { defaultFavicon },
        ];

        // Filter node array to only return non-null values and cast to non-nullable array
        return nodeArray.Where(x => x != null).Cast<HtmlNodeCollection>().ToArray();
    }

    /// <summary>
    /// Tries to extract the favicon from the nodes.
    /// </summary>
    /// <param name="faviconNodes">The favicon nodes.</param>
    /// <param name="client">The HTTP client.</param>
    /// <param name="baseUri">The base URI.</param>
    /// <param name="cancellationToken">Token maxing the overall extraction.</param>
    /// <returns>The favicon bytes.</returns>
    private static async Task<byte[]?> TryExtractFaviconFromNodes(HtmlNodeCollection[] faviconNodes, HttpClient client, Uri baseUri, CancellationToken cancellationToken)
    {
        var seenUrls = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var nodeCollection in faviconNodes)
        {
            if (nodeCollection == null || nodeCollection.Count == 0)
            {
                continue;
            }

            foreach (var node in nodeCollection)
            {
                var faviconUrl = node.GetAttributeValue("href", string.Empty);
                if (string.IsNullOrEmpty(faviconUrl))
                {
                    continue;
                }

                if (!Uri.IsWellFormedUriString(faviconUrl, UriKind.Absolute))
                {
                    faviconUrl = new Uri(baseUri, faviconUrl).ToString();
                }

                if (!seenUrls.Add(faviconUrl))
                {
                    continue;
                }

                if (seenUrls.Count > MaxFaviconCandidates)
                {
                    return null;
                }

                var faviconBytes = await FetchAndProcessFaviconAsync(client, faviconUrl, cancellationToken);
                if (faviconBytes != null)
                {
                    return faviconBytes;
                }
            }
        }

        return null;
    }

    /// <summary>
    /// Fetches and processes the favicon.
    /// </summary>
    /// <param name="client">The HTTP client.</param>
    /// <param name="url">The URL to fetch the favicon from.</param>
    /// <param name="cancellationToken">Token maxing the overall extraction.</param>
    /// <returns>The favicon bytes.</returns>
    private static async Task<byte[]?> FetchAndProcessFaviconAsync(HttpClient client, string url, CancellationToken cancellationToken)
    {
        try
        {
            // Validate the favicon URL before fetching
            if (!Uri.TryCreate(url, UriKind.Absolute, out var faviconUri) || !IsAllowedSchemeAndPort(faviconUri))
            {
                return null;
            }

            // Follow redirects with validation
            var response = await FollowRedirectsAsync(client, faviconUri, cancellationToken);

            if (response == null || !response.IsSuccessStatusCode)
            {
                return null;
            }

            var contentType = response.Content.Headers.ContentType?.MediaType;
            if (string.IsNullOrEmpty(contentType) || !contentType.StartsWith("image/"))
            {
                return null;
            }

            var imageBytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
            if (imageBytes.Length == 0)
            {
                return null;
            }

            // Don't rely on the HTTP Content-Type header: sniff the real format from the file's
            // magic bytes. Servers frequently mislabel favicons and some serve formats clients can't safely render.
            var format = DetectImageFormat(imageBytes);

            // Reject oversized images.
            if (format != ImageFormatSignature.Svg && !IsWithinDecodePixelBudget(imageBytes))
            {
                return null;
            }

            if (_clientSafeFormats.Contains(format))
            {
                // Recognized, client-safe format: keep as-is, only shrinking if it exceeds the cap.
                return imageBytes.Length > MaxSizeBytes ? ResizeImage(imageBytes, format) : imageBytes;
            }

            // Recognized-but-unsafe (HEIC/HEIF/AVIF/BMP/TIFF) or unknown: normalize to PNG/JPEG via
            // SkiaSharp so clients only ever receive a safe format. If it can't be decoded server-side
            // (e.g. no HEIC codec available) or isn't a real image, reject it rather than store
            // something a client might fail to render.
            return ReencodeWithinCap(imageBytes);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // The overall deadline expired: abort the extraction.
            throw;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Creates a new HTTP client with enhanced browser-like configuration to handle bot protection.
    /// </summary>
    /// <returns>The HTTP client.</returns>
    private static HttpClient CreateHttpClient()
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false, // Handle redirects manually
            UseCookies = true,         // Enable cookie handling for session management
            CookieContainer = new System.Net.CookieContainer(),
            AutomaticDecompression = System.Net.DecompressionMethods.GZip | System.Net.DecompressionMethods.Deflate | System.Net.DecompressionMethods.Brotli,
            ConnectCallback = ConnectToValidatedAddressAsync,
        };

        var client = new HttpClient(handler)
        {
            Timeout = _requestTimeout,
            MaxResponseContentBufferSize = MaxResponseBytes,
        };

        var random = new Random();
        var userAgents = new[]
        {
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
        };

        // Use random User-Agent
        client.DefaultRequestHeaders.Add("User-Agent", userAgents[random.Next(userAgents.Length)]);

        // More comprehensive Accept header with image types prioritized
        client.DefaultRequestHeaders.Add(
            "Accept",
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7");

        // Additional browser-like headers
        client.DefaultRequestHeaders.Add("Accept-Language", "en-US,en;q=0.9");
        client.DefaultRequestHeaders.Add("Accept-Encoding", "gzip, deflate, br");
        client.DefaultRequestHeaders.Add("DNT", "1");
        client.DefaultRequestHeaders.Add("Upgrade-Insecure-Requests", "1");
        client.DefaultRequestHeaders.Add("Cache-Control", "max-age=0");

        // Add Sec-Fetch headers to mimic modern browsers
        if (random.Next(2) == 0)
        {
            client.DefaultRequestHeaders.Add("Sec-Fetch-Dest", "document");
            client.DefaultRequestHeaders.Add("Sec-Fetch-Mode", "navigate");
            client.DefaultRequestHeaders.Add("Sec-Fetch-Site", "none");
            client.DefaultRequestHeaders.Add("Sec-Fetch-User", "?1");
        }

        // Add Chrome-specific headers randomly
        if (random.Next(3) == 0)
        {
            client.DefaultRequestHeaders.Add("Sec-CH-UA", "\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"120\", \"Google Chrome\";v=\"120\"");
            client.DefaultRequestHeaders.Add("Sec-CH-UA-Mobile", "?0");
            client.DefaultRequestHeaders.Add("Sec-CH-UA-Platform", "\"Windows\"");
        }

        return client;
    }

    /// <summary>
    /// Normalizes the URL by adding a scheme if it is missing.
    /// </summary>
    /// <param name="url">The URL to normalize.</param>
    /// <returns>The normalized URL.</returns>
    private static string NormalizeUrl(string url)
    {
        if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            return "https://" + url;
        }

        return url;
    }

    /// <summary>
    /// Checks the URI scheme and port.
    /// </summary>
    /// <param name="uri">The URI to check.</param>
    /// <returns>True if the scheme and port are both allowed, false otherwise.</returns>
    private static bool IsAllowedSchemeAndPort(Uri uri)
    {
        return _allowedSchemes.Contains(uri.Scheme) && uri.IsDefaultPort;
    }

    /// <summary>
    /// Handles HTTP redirects with validation to prevent SSRF attacks.
    /// </summary>
    /// <param name="client">The HTTP client.</param>
    /// <param name="uri">The initial URI to request.</param>
    /// <param name="cancellationToken">Token maxing the overall extraction.</param>
    /// <returns>The final HTTP response after following redirects, or null if blocked/failed.</returns>
    private static async Task<HttpResponseMessage?> FollowRedirectsAsync(HttpClient client, Uri uri, CancellationToken cancellationToken)
    {
        var currentUri = uri;
        int redirectCount = 0;
        const int maxRedirects = 5;

        while (redirectCount < maxRedirects)
        {
            // Create request with referer header to appear more browser-like
            var request = new HttpRequestMessage(HttpMethod.Get, currentUri);
            if (redirectCount == 0)
            {
                // First request: add Google referer to appear like navigation
                request.Headers.Add("Referer", "https://www.google.com/");
            }
            else
            {
                // Subsequent redirects: use original URL as referer
                request.Headers.Add("Referer", uri.ToString());
            }

            var response = await client.SendAsync(request, cancellationToken);

            if ((int)response.StatusCode >= 300 && (int)response.StatusCode < 400)
            {
                var location = response.Headers.Location;
                if (location == null)
                {
                    return null;
                }

                // Resolve relative URLs
                if (!location.IsAbsoluteUri)
                {
                    location = new Uri(currentUri, location);
                }

                // Validate the target URL scheme and port.
                if (!IsAllowedSchemeAndPort(location))
                {
                    return null;
                }

                currentUri = location;
                redirectCount++;
            }
            else
            {
                return response;
            }
        }

        return null; // Too many redirects
    }

    /// <summary>
    /// Checks whether the bytes look like an SVG by inspecting a short text prefix for an XML or
    /// SVG opening tag.
    /// </summary>
    /// <param name="bytes">The raw image bytes.</param>
    /// <returns>True if the content appears to be SVG/XML.</returns>
    private static bool LooksLikeSvg(byte[] bytes)
    {
        var prefixLength = Math.Min(bytes.Length, 256);
        if (prefixLength == 0)
        {
            return false;
        }

        var prefix = Encoding.UTF8.GetString(bytes, 0, prefixLength).TrimStart('\uFEFF', ' ', '\t', '\r', '\n').ToLowerInvariant();
        return prefix.Contains("<svg") || prefix.StartsWith("<?xml", StringComparison.Ordinal);
    }

    /// <summary>
    /// Resizes a recognized, client-safe image down under the size cap. SVG is a vector/text format
    /// that can't be usefully raster-resized here, so oversized SVGs are rejected.
    /// </summary>
    /// <param name="imageBytes">The image bytes to resize.</param>
    /// <param name="format">The sniffed image format.</param>
    /// <returns>The resized image bytes, or null if it could not be brought under the size cap.</returns>
    private static byte[]? ResizeImage(byte[] imageBytes, ImageFormatSignature format)
    {
        if (format == ImageFormatSignature.Svg)
        {
            return null;
        }

        return ReencodeWithinCap(imageBytes);
    }

    /// <summary>
    /// Decodes arbitrary image bytes and re-encodes them to a client-safe raster format (PNG, with
    /// a JPEG fallback) that fits under the size cap. Used both to shrink oversized images and to
    /// normalize formats clients can't render. Returns null if the bytes can't be decoded
    /// server-side (e.g. no HEIC codec) or can't be brought under the cap.
    /// </summary>
    /// <param name="imageBytes">The raw image bytes to decode and re-encode.</param>
    /// <returns>The re-encoded image bytes, or null on failure.</returns>
    private static byte[]? ReencodeWithinCap(byte[] imageBytes)
    {
        try
        {
            using var original = SKBitmap.Decode(imageBytes);
            if (original == null)
            {
                return null;
            }

            // Pass 1: PNG at progressively smaller widths. Preserves transparency.
            foreach (var width in _resizeWidths)
            {
                var encoded = EncodeAtWidth(original, width, SKEncodedImageFormat.Png, 100);
                if (encoded != null && encoded.Length <= MaxSizeBytes)
                {
                    return encoded;
                }
            }

            // Pass 2: JPEG at the smallest width with decreasing quality. Loses transparency but
            // gives much smaller files for photographic favicons that resist PNG compression.
            var fallbackWidth = _resizeWidths[^1];
            foreach (var quality in _jpegFallbackQualities)
            {
                var encoded = EncodeAtWidth(original, fallbackWidth, SKEncodedImageFormat.Jpeg, quality);
                if (encoded != null && encoded.Length <= MaxSizeBytes)
                {
                    return encoded;
                }
            }

            return null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Resizes the bitmap to the target width (preserving aspect ratio, never upscaling) and
    /// encodes it in the given format.
    /// </summary>
    /// <param name="original">The decoded source bitmap.</param>
    /// <param name="targetWidth">Desired output width in pixels.</param>
    /// <param name="format">Encode format.</param>
    /// <param name="quality">Encoder quality (only meaningful for lossy formats).</param>
    /// <returns>Encoded bytes, or null if encoding failed.</returns>
    private static byte[]? EncodeAtWidth(SKBitmap original, int targetWidth, SKEncodedImageFormat format, int quality)
    {
        var width = Math.Min(targetWidth, original.Width);
        var scale = (float)width / original.Width;
        var height = Math.Max(1, (int)(original.Height * scale));

        using var resized = original.Resize(new SKImageInfo(width, height), new SKSamplingOptions(SKFilterMode.Linear));
        if (resized == null)
        {
            return null;
        }

        using var image = SKImage.FromBitmap(resized);
        using var data = image.Encode(format, quality);
        return data?.ToArray();
    }
}
