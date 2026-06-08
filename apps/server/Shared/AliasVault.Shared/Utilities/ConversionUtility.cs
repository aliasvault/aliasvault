//-----------------------------------------------------------------------
// <copyright file="ConversionUtility.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Utilities;

using AngleSharp.Dom;
using Ganss.Xss;

/// <summary>
/// Class which contains various helper methods for data conversion.
/// </summary>
public static class ConversionUtility
{
    /// <summary>
    /// Factory that creates and configures an <see cref="HtmlSanitizer"/> instance for safe email viewing.
    /// </summary>
    private static readonly Func<HtmlSanitizer> CreateEmailSanitizer = () =>
    {
        var sanitizer = new HtmlSanitizer();

        // Allow common email formatting elements
        sanitizer.AllowedTags.Add("div");
        sanitizer.AllowedTags.Add("span");
        sanitizer.AllowedTags.Add("p");
        sanitizer.AllowedTags.Add("br");
        sanitizer.AllowedTags.Add("hr");
        sanitizer.AllowedTags.Add("h1");
        sanitizer.AllowedTags.Add("h2");
        sanitizer.AllowedTags.Add("h3");
        sanitizer.AllowedTags.Add("h4");
        sanitizer.AllowedTags.Add("h5");
        sanitizer.AllowedTags.Add("h6");
        sanitizer.AllowedTags.Add("ul");
        sanitizer.AllowedTags.Add("ol");
        sanitizer.AllowedTags.Add("li");
        sanitizer.AllowedTags.Add("table");
        sanitizer.AllowedTags.Add("thead");
        sanitizer.AllowedTags.Add("tbody");
        sanitizer.AllowedTags.Add("tfoot");
        sanitizer.AllowedTags.Add("tr");
        sanitizer.AllowedTags.Add("th");
        sanitizer.AllowedTags.Add("td");
        sanitizer.AllowedTags.Add("a");
        sanitizer.AllowedTags.Add("img");
        sanitizer.AllowedTags.Add("b");
        sanitizer.AllowedTags.Add("i");
        sanitizer.AllowedTags.Add("u");
        sanitizer.AllowedTags.Add("s");
        sanitizer.AllowedTags.Add("strike");
        sanitizer.AllowedTags.Add("strong");
        sanitizer.AllowedTags.Add("em");
        sanitizer.AllowedTags.Add("small");
        sanitizer.AllowedTags.Add("sub");
        sanitizer.AllowedTags.Add("sup");
        sanitizer.AllowedTags.Add("blockquote");
        sanitizer.AllowedTags.Add("pre");
        sanitizer.AllowedTags.Add("code");
        sanitizer.AllowedTags.Add("font");
        sanitizer.AllowedTags.Add("center");

        // Allow common styling attributes
        sanitizer.AllowedAttributes.Add("style");
        sanitizer.AllowedAttributes.Add("class");
        sanitizer.AllowedAttributes.Add("id");
        sanitizer.AllowedAttributes.Add("width");
        sanitizer.AllowedAttributes.Add("height");
        sanitizer.AllowedAttributes.Add("align");
        sanitizer.AllowedAttributes.Add("valign");
        sanitizer.AllowedAttributes.Add("bgcolor");
        sanitizer.AllowedAttributes.Add("color");
        sanitizer.AllowedAttributes.Add("border");
        sanitizer.AllowedAttributes.Add("cellpadding");
        sanitizer.AllowedAttributes.Add("cellspacing");
        sanitizer.AllowedAttributes.Add("colspan");
        sanitizer.AllowedAttributes.Add("rowspan");
        sanitizer.AllowedAttributes.Add("face");
        sanitizer.AllowedAttributes.Add("size");

        // Allow href for links but sanitize URLs
        sanitizer.AllowedAttributes.Add("href");
        sanitizer.AllowedAttributes.Add("target");
        sanitizer.AllowedAttributes.Add("rel");

        // Allow src for images but sanitize URLs
        sanitizer.AllowedAttributes.Add("src");
        sanitizer.AllowedAttributes.Add("alt");
        sanitizer.AllowedAttributes.Add("title");

        // Explicitly remove dangerous elements (fallback)
        sanitizer.AllowedTags.Remove("script");
        sanitizer.AllowedTags.Remove("object");
        sanitizer.AllowedTags.Remove("embed");
        sanitizer.AllowedTags.Remove("iframe");
        sanitizer.AllowedTags.Remove("frame");
        sanitizer.AllowedTags.Remove("frameset");
        sanitizer.AllowedTags.Remove("form");
        sanitizer.AllowedTags.Remove("input");
        sanitizer.AllowedTags.Remove("button");
        sanitizer.AllowedTags.Remove("textarea");
        sanitizer.AllowedTags.Remove("select");
        sanitizer.AllowedTags.Remove("option");
        sanitizer.AllowedTags.Remove("link");
        sanitizer.AllowedTags.Remove("meta");
        sanitizer.AllowedTags.Remove("base");
        sanitizer.AllowedTags.Remove("applet");

        return sanitizer;
    };

    /// <summary>
    /// Lazy-initialized HTML sanitizer instance configured for safe email viewing.
    /// Removes all script tags, event handlers, and other XSS vectors while preserving
    /// safe HTML for email display.
    /// </summary>
    private static readonly Lazy<HtmlSanitizer> EmailSanitizer = new(CreateEmailSanitizer);

    /// <summary>
    /// Lazy-initialized HTML sanitizer that, in addition to sanitizing, rewrites anchor tags to
    /// open in a new tab. This is done as part of the single sanitize pass (via <see cref="HtmlSanitizer.PostProcessNode"/>)
    /// so that displaying an email only requires parsing the (potentially large) HTML once instead of twice.
    /// </summary>
    private static readonly Lazy<HtmlSanitizer> EmailViewSanitizer = new(() =>
    {
        var sanitizer = CreateEmailSanitizer();
        sanitizer.PostProcessNode += (_, e) =>
        {
            if (e.Node is IElement element && element.NodeName.Equals("A", StringComparison.OrdinalIgnoreCase) && element.HasAttribute("href"))
            {
                element.SetAttribute("target", "_blank");

                var relValues = new HashSet<string>((element.GetAttribute("rel") ?? string.Empty).Split(' ', StringSplitOptions.RemoveEmptyEntries), StringComparer.OrdinalIgnoreCase);
                relValues.Add("noopener");
                relValues.Add("noreferrer");
                element.SetAttribute("rel", string.Join(" ", relValues));
            }
        };
        return sanitizer;
    });

    /// <summary>
    /// Sanitizes HTML content for safe display in email viewers.
    /// Removes all script tags, event handlers, and other XSS attack vectors.
    /// </summary>
    /// <param name="html">The HTML content to sanitize.</param>
    /// <returns>Sanitized HTML safe for display.</returns>
    /// <remarks>
    /// This method should be called before displaying any untrusted HTML content
    /// (e.g., received emails) to prevent Cross-Site Scripting (XSS) attacks.
    /// </remarks>
    public static string SanitizeHtmlForEmailViewing(string html)
    {
        if (string.IsNullOrWhiteSpace(html))
        {
            return html;
        }

        try
        {
            return EmailSanitizer.Value.Sanitize(html);
        }
        catch (Exception ex)
        {
            // Log the exception
            Console.WriteLine($"Error in SanitizeHtmlForEmailViewing: {ex.Message}");

            // Return empty string on error to prevent potential XSS
            // This is safer than returning the original HTML
            return string.Empty;
        }
    }

    /// <summary>
    /// Sanitizes HTML content and converts anchor tags to open in a new tab.
    /// This is a convenience method that combines sanitization with anchor tag conversion.
    /// </summary>
    /// <param name="html">The HTML content to process.</param>
    /// <returns>Sanitized HTML with anchor tags configured to open in new tabs.</returns>
    public static string SanitizeAndPrepareEmailHtml(string html)
    {
        if (string.IsNullOrWhiteSpace(html))
        {
            return html;
        }

        try
        {
            // Sanitize and rewrite anchor tags to open in a new tab in a single parse pass.
            return EmailViewSanitizer.Value.Sanitize(html);
        }
        catch (Exception ex)
        {
            // Log the exception and return empty string to prevent potential XSS.
            Console.WriteLine($"Error in SanitizeAndPrepareEmailHtml: {ex.Message}");
            return string.Empty;
        }
    }
}
