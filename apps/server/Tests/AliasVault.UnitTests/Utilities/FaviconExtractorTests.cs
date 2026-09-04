//-----------------------------------------------------------------------
// <copyright file="FaviconExtractorTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Utilities;

using System.Net;
using System.Text;

using SkiaSharp;

/// <summary>
/// Tests for the AliasVault.FaviconExtractor class. Tests that fetch real websites live in
/// <see cref="FaviconExtractorNetworkTests"/> and are excluded from CI.
/// </summary>
public class FaviconExtractorTests
{
    /// <summary>
    /// Check that a page opening with an XML declaration is not sniffed as an SVG. Icon responses are
    /// accepted on their magic bytes rather than their Content-Type, so an XHTML error page served in
    /// place of an icon must still be rejected.
    /// </summary>
    [Test]
    public void RejectsXmlPageAsSvg()
    {
        var xhtmlPage = Encoding.UTF8.GetBytes(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
            "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Strict//EN\" \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd\">\n" +
            "<html xmlns=\"http://www.w3.org/1999/xhtml\"><body>Not found</body></html>");

        // A real SVG icon can carry the same XML declaration and doctype before the <svg> tag.
        var svgIcon = Encoding.UTF8.GetBytes(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" +
            "<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd\">\n" +
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" />");

        Assert.Multiple(() =>
        {
            Assert.That(FaviconExtractor.FaviconExtractor.DetectImageFormat(xhtmlPage), Is.EqualTo(FaviconExtractor.FaviconExtractor.ImageFormatSignature.Unknown), "An XHTML page must not be treated as an image");
            Assert.That(FaviconExtractor.FaviconExtractor.DetectImageFormat(svgIcon), Is.EqualTo(FaviconExtractor.FaviconExtractor.ImageFormatSignature.Svg), "An SVG behind an XML declaration must still be recognized");
        });
    }

    /// <summary>
    /// Check that relative icon hrefs resolve against the page's base href rather than the page URL.
    /// Single-page apps (Blazor, Angular) declare base href="/" and reference "favicon.png" relative
    /// to it, so a page served under a sub-path such as /user/login must still resolve to the site root.
    /// </summary>
    [Test]
    public void ResolvesIconHrefsAgainstBaseHref()
    {
        var html = Encoding.UTF8.GetBytes(
            "<html><head><base href=\"/\" />" +
            "<link rel=\"icon\" type=\"image/png\" href=\"favicon.png\" />" +
            "</head></html>");

        var candidates = FaviconExtractor.FaviconExtractor.GetFaviconCandidateUrls(html, new Uri("https://example.com/user/login"));

        Assert.That(candidates, Is.EqualTo(new[] { "https://example.com/favicon.png", "https://example.com/favicon.ico" }));
    }

    /// <summary>
    /// Check that without a base href element relative hrefs resolve against the page URL, as a browser
    /// would, and that the conventional /favicon.ico at the origin is appended as the last candidate.
    /// </summary>
    [Test]
    public void ResolvesIconHrefsAgainstPageUrlWithoutBase()
    {
        var html = Encoding.UTF8.GetBytes("<html><head><link rel=\"icon\" href=\"icons/favicon.png\" /></head></html>");

        var candidates = FaviconExtractor.FaviconExtractor.GetFaviconCandidateUrls(html, new Uri("https://example.com/user/login"));

        Assert.That(candidates, Is.EqualTo(new[] { "https://example.com/user/icons/favicon.png", "https://example.com/favicon.ico" }));
    }

    /// <summary>
    /// Check that a base href pointing at another host is honored, while the default /favicon.ico
    /// still comes from the origin the page was served from.
    /// </summary>
    [Test]
    public void ResolvesIconHrefsAgainstCrossOriginBase()
    {
        var html = Encoding.UTF8.GetBytes(
            "<html><head><base href=\"https://cdn.example.net/assets/\" />" +
            "<link rel=\"icon\" href=\"favicon.png\" />" +
            "</head></html>");

        var candidates = FaviconExtractor.FaviconExtractor.GetFaviconCandidateUrls(html, new Uri("https://example.com/"));

        Assert.That(candidates, Is.EqualTo(new[] { "https://cdn.example.net/assets/favicon.png", "https://example.com/favicon.ico" }));
    }

    /// <summary>
    /// Check candidate ordering, de-duplication, entity decoding, and that unusable hrefs are skipped
    /// rather than aborting the whole extraction.
    /// </summary>
    [Test]
    public void OrdersAndFiltersIconCandidates()
    {
        var html = Encoding.UTF8.GetBytes(
            "<html><head>" +
            "<link rel=\"shortcut icon\" href=\"/favicon.ico\" />" +
            "<link rel=\"apple-touch-icon\" href=\"https://cdn.example.com/touch.png?v=1&amp;s=2\" />" +
            "<link rel=\"icon\" sizes=\"32x32\" href=\"/icon-32.png\" />" +
            "<link rel=\"icon\" sizes=\"32x32\" href=\"/icon-32.png\" />" +
            "<link rel=\"icon\" href=\"http://[malformed\" />" +
            "<link rel=\"icon\" href=\"\" />" +
            "</head></html>");

        var candidates = FaviconExtractor.FaviconExtractor.GetFaviconCandidateUrls(html, new Uri("https://example.com/"));

        Assert.That(candidates, Is.EqualTo(new[]
        {
            "https://example.com/icon-32.png",
            "https://cdn.example.com/touch.png?v=1&s=2",
            "https://example.com/favicon.ico",
        }));
    }

    /// <summary>
    /// Check that SkiaSharp's native library actually loads. It is missing its dependencies on some
    /// runtime images, and because every decode failure is swallowed as "not a usable image" that
    /// shows up as favicon extraction silently failing for every non-SVG icon rather than as an error.
    /// </summary>
    [Test]
    public void SkiaSharpNativeLibraryLoads()
    {
        Assert.That(FaviconExtractor.FaviconExtractor.IsWithinDecodePixelBudget(EncodeSolidPng(16, 16)), Is.True, "SkiaSharp must be able to decode a PNG");
    }

    /// <summary>
    /// Test that localhost URLs are blocked (SSRF protection).
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task BlockLocalhostUrls()
    {
        var localhostUrls = new[]
        {
            "http://localhost/favicon.ico",
            "http://127.0.0.1/favicon.ico",
            "http://[::1]/favicon.ico",
            "http://localhost:8080/favicon.ico",
            "https://localhost/favicon.ico",
        };

        foreach (var url in localhostUrls)
        {
            var faviconBytes = await FaviconExtractor.FaviconExtractor.GetFaviconAsync(url);
            Assert.That(faviconBytes, Is.Null, $"Should block localhost URL: {url}");
        }
    }

    /// <summary>
    /// Test that private IP ranges are blocked (SSRF protection).
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task BlockPrivateIpRanges()
    {
        var privateIpUrls = new[]
        {
            "http://10.0.0.1/favicon.ico",
            "http://10.100.0.1/favicon.ico",
            "http://192.168.1.1/favicon.ico",
            "http://172.16.0.1/favicon.ico",
            "http://169.254.169.254/latest/meta-data/", // AWS metadata endpoint
            "http://[fc00::1]/favicon.ico", // IPv6 private
            "http://[fe80::1]/favicon.ico", // IPv6 link-local
        };

        foreach (var url in privateIpUrls)
        {
            var faviconBytes = await FaviconExtractor.FaviconExtractor.GetFaviconAsync(url);
            Assert.That(faviconBytes, Is.Null, $"Should block private IP URL: {url}");
        }
    }

    /// <summary>
    /// Test that non-standard ports are blocked.
    /// </summary>
    /// <returns>Task.</returns>
    [Test]
    public async Task BlockNonStandardPorts()
    {
        var nonStandardPortUrls = new[]
        {
            "http://example.com:8080/favicon.ico",
            "https://example.com:8443/favicon.ico",
            "http://example.com:3000/favicon.ico",
        };

        foreach (var url in nonStandardPortUrls)
        {
            var faviconBytes = await FaviconExtractor.FaviconExtractor.GetFaviconAsync(url);
            Assert.That(faviconBytes, Is.Null, $"Should block non-standard port URL: {url}");
        }
    }

    /// <summary>
    /// Check that a mixed set of public and private IP addresses is rejected as only fully public sets are allowed.
    /// </summary>
    [Test]
    public void RejectsAddressSetMixingPublicAndPrivate()
    {
        Assert.Multiple(() =>
        {
            Assert.That(FaviconExtractor.FaviconExtractor.AreIpAddressesPublic([IPAddress.Parse("8.8.8.8"), IPAddress.Parse("10.0.0.1")]), Is.False, "A mixed set must be rejected");
            Assert.That(FaviconExtractor.FaviconExtractor.AreIpAddressesPublic([IPAddress.Parse("8.8.8.8"), IPAddress.Parse("1.1.1.1")]), Is.True, "An all-public set must be allowed");
        });
    }

    /// <summary>
    /// Check that an empty address set is rejected. Nothing has been validated in that case, so treating
    /// it as public would hand the connect path a free pass.
    /// </summary>
    [Test]
    public void RejectsEmptyAddressSet()
    {
        Assert.That(FaviconExtractor.FaviconExtractor.AreIpAddressesPublic([]), Is.False, "An empty set must be rejected");
    }

    /// <summary>
    /// Check that IPv4 transition and tunnel prefixes are rejected.
    /// </summary>
    [Test]
    public void RejectsIpV6TransitionAddresses()
    {
        string[] tunnelAddresses =
        [
            "::127.0.0.1",        // IPv4-compatible (deprecated) carrying loopback
            "::ffff:127.0.0.1",   // IPv4-mapped carrying loopback
            "2002:7f00:0001::",   // 6to4 carrying 127.0.0.1
            "2002:0a00:0001::",   // 6to4 carrying 10.0.0.1
            "64:ff9b::7f00:1",    // NAT64 well-known prefix carrying 127.0.0.1
            "2001::1",            // Teredo
            "::",                 // unspecified
        ];

        Assert.Multiple(() =>
        {
            foreach (var address in tunnelAddresses)
            {
                Assert.That(FaviconExtractor.FaviconExtractor.AreIpAddressesPublic([IPAddress.Parse(address)]), Is.False, $"Should reject {address}");
            }

            Assert.That(FaviconExtractor.FaviconExtractor.AreIpAddressesPublic([IPAddress.Parse("2606:4700:4700::1111")]), Is.True, "A genuinely public IPv6 address must still be allowed");
        });
    }

    /// <summary>
    /// Check that an image declaring huge pixel dimensions is rejected.
    /// </summary>
    [Test]
    public void RejectsImageExceedingPixelBudget()
    {
        // 3000x3000 = 9 megapixels, comfortably over the 4 megapixel budget, yet tiny once PNG-compressed.
        var oversized = EncodeSolidPng(3000, 3000);
        var acceptable = EncodeSolidPng(64, 64);

        Assert.Multiple(() =>
        {
            Assert.That(oversized.Length, Is.LessThan(100 * 1024), "The oversized image should still be small on the wire");
            Assert.That(FaviconExtractor.FaviconExtractor.IsWithinDecodePixelBudget(oversized), Is.False, "An image over the pixel budget must be rejected");
            Assert.That(FaviconExtractor.FaviconExtractor.IsWithinDecodePixelBudget(acceptable), Is.True, "A normally sized favicon must be accepted");
            Assert.That(FaviconExtractor.FaviconExtractor.IsWithinDecodePixelBudget([0x00, 0x01, 0x02, 0x03]), Is.False, "Bytes that are not a decodable image must be rejected");
        });
    }

    /// <summary>
    /// Encodes a solid-colour PNG of the given dimensions.
    /// </summary>
    /// <param name="width">Image width in pixels.</param>
    /// <param name="height">Image height in pixels.</param>
    /// <returns>The encoded PNG bytes.</returns>
    private static byte[] EncodeSolidPng(int width, int height)
    {
        using var bitmap = new SKBitmap(width, height);
        using (var canvas = new SKCanvas(bitmap))
        {
            canvas.Clear(SKColors.CornflowerBlue);
        }

        using var image = SKImage.FromBitmap(bitmap);
        using var data = image.Encode(SKEncodedImageFormat.Png, 100);
        return data.ToArray();
    }
}
