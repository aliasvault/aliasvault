//-----------------------------------------------------------------------
// <copyright file="ConversionUtilityTest.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Utilities;

using System.Text.RegularExpressions;
using AliasVault.Shared.Utilities;

/// <summary>
/// Tests for the ConversionUtility class.
/// </summary>
public class ConversionUtilityTest
{
    /// <summary>
    /// Tests the conversion of a simple anchor tag to open in a new tab.
    /// </summary>
    [Test]
    public void TestAnchorTabConversionSimple()
    {
        string anchorHtml = "<a href=\"https://dutchamzmasters.lt.acemlnb.com/Prod/link-tracker?redirectUrl=aHR0cHMlM0ElMkYlMkZ3d3cuZHV0Y2hhbXptYXN0ZXJzLmNvbSUyRnRoYW5rLXlvdTloN3poZ3Rp&amp;sig=CpED3rRPX48ddoWTUZURadAYPYgPppT312jUNnvUCPo5&amp;iat=1679512450&amp;a=%7C%7C25799960%7C%7C&amp;account=dutchamzmasters%2Eactivehosted%2Ecom&amp;email=DQeVbqE%2Fy2FD5V3I2cvSxXjJCI3Tg5qfUHKGneOhzjJYZ1kM3LVZcQ%3D%3D%3AvdAW7N7fs1pZlI1ib%2BNbsMYz5m4FssAR&amp;s=5241db963ffe25d6f4b762fc00038ee2&amp;i=163A299A10A816\"></a>";
        string convertedAnchorTags = ConversionUtility.SanitizeAndPrepareEmailHtml(anchorHtml);

        // Check that conversion works as expected.
        Assert.That(convertedAnchorTags, Does.Contain("target=\"_blank\""));
    }

    /// <summary>
    /// Tests the conversion of a complex anchor tag with multiple attributes to open in a new tab.
    /// </summary>
    [Test]
    public void TestAnchorTabConversionComplex1()
    {
        string anchorHtml = "<a\nhref=\"https://dutchamzmasters.lt.acemlnb.com/Prod/link-tracker?redirectUrl=aHR0cHMlM0ElMkYlMkZ3d3cuZHV0Y2hhbXptYXN0ZXJzLmNvbSUyRnRoYW5rLXlvdTloN3poZ3Rp&sig=CpED3rRPX48ddoWTUZURadAYPYgPppT312jUNnvUCPo5&iat=1679512450&a=%7C%7C25799960%7C%7C&account=dutchamzmasters%2Eactivehosted%2Ecom&email=DQeVbqE%2Fy2FD5V3I2cvSxXjJCI3Tg5qfUHKGneOhzjJYZ1kM3LVZcQ%3D%3D%3AvdAW7N7fs1pZlI1ib%2BNbsMYz5m4FssAR&s=5241db963ffe25d6f4b762fc00038ee2&i=163A299A10A816\" data-ac-default-color=\"1\" style=\"margin: 0; outline: none; padding: 0; color: #045FB4; text-decoration: underline; font-weight: bold;\"><span style=\"color: ; font-size: inherit; font-weight: inherit; line-height: inherit; text-decoration: inherit;\">Start hier met de training &gt;&gt;&gt;</span></a>";
        string convertedAnchorTags = ConversionUtility.SanitizeAndPrepareEmailHtml(anchorHtml);

        // Check that conversion works as expected.
        Assert.That(convertedAnchorTags, Does.Contain("target=\"_blank\""));
    }

    /// <summary>
    /// Tests the conversion of a complex anchor tag with nested elements to open in a new tab.
    /// </summary>
    [Test]
    public void TestAnchorTabConversionComplex2()
    {
        string anchorHtml = "<div class=\"btn btn--flat btn--large\" style=\"Margin-bottom: 20px;text-align: center;\">\n        <!--[if !mso]><!--><a style=\"border-radius: 4px;display: inline-block;font-size: 14px;font-weight: bold;line-height: 24px;padding: 12px 24px;text-align: center;text-decoration: none !important;transition: opacity 0.1s ease-in;color: #212529 !important;background-color: #ffdd55;font-family: Open Sans, sans-serif;\" href=\"https://eazegamesbv.cmail19.com/t/j-l-sktidll-ddhdthjhkj-j/\">Haal je beloning op</a><!--<![endif]-->\n      <!--[if mso]><p style=\"line-height:0;margin:0;\">&nbsp;</p><v:roundrect xmlns:v=\"urn:schemas-microsoft-com:vml\" href=\"https://eazegamesbv.cmail19.com/t/j-l-sktidll-ddhdthjhkj-j/\" style=\"width:136.5pt\" arcsize=\"9%\" fillcolor=\"#FFDD55\" stroke=\"f\"><v:textbox style=\"mso-fit-shape-to-text:t\" inset=\"0pt,8.25pt,0pt,8.25pt\"><center style=\"font-size:14px;line-height:24px;color:#212529;font-family:Open Sans,sans-serif;font-weight:bold;mso-line-height-rule:exactly;mso-text-raise:1.5px\">Haal je beloning op</center></v:textbox></v:roundrect><![endif]--></div>";
        string convertedAnchorTags = ConversionUtility.SanitizeAndPrepareEmailHtml(anchorHtml);

        // Check that conversion works as expected.
        Assert.That(convertedAnchorTags, Does.Contain("target=\"_blank\""));
    }

    /// <summary>
    /// Tests the conversion of a complex anchor tag within a table cell to open in a new tab.
    /// </summary>
    [Test]
    public void TestAnchorTabConversionComplex3()
    {
        string anchorHtml = "<td style=\"word-wrap: break-word; -webkit-hyphens: auto; -moz-hyphens: auto; hyphens: auto; vertical-align: top; font-family: Helvetica, Arial, sans-serif; font-weight: normal; margin: 0; Margin: 0; font-size: 16px; line-height: 1.3; text-align: center; color: #fefefe; background: #f17130; border-radius: 5px; border: 0 solid #f17130; width: 400px; padding: 5px; border-collapse: collapse;\"><a href=\"https://click.info.wijkopenautos.nl/f/a/chSbfTJZeP5dGZaVjOIUlw~~/AABMyAA~/RgRnzW26P0SwaHR0cHM6Ly93d3cud2lqa29wZW5hdXRvcy5ubC9pbnNwZWN0aW9uL2UwZTg0M2Y4NGEzZDRjYjc4MDYwMGU2NDEzNzc1NmEyLz9NSUQ9TkxfQ1JNXzFfM18wXzE5NjY3MF8yNDE5NTgwMTEyNDdfMSZ0bXM9MTcwOTg5Mzc4MyZ1dG1fc291cmNlPUNSTSZ1dG1fbWVkaXVtPWVtYWlsJnV0bV9jYW1wYWlnbj0zXzdXBXNwY2V1Qgpl6bro6mX9yH0mUhJidWxhYmVlckBhc2Rhc2QubmxYBAAAAAw~\" style=\"margin: 0; Margin: 0; line-height: 1.3; font-family: Helvetica, Arial, sans-serif; font-size: 16px; font-weight: bold; color: #fefefe; text-decoration: none; display: inline-block; background: #f17130; border: 0 solid #f17130; width: 400px; text-align: center; padding: 5px; border-radius: 5px;\">Ontvang nu jouw prijs&nbsp;&nbsp;<b>&gt;</b></a></td>";
        string convertedAnchorTags = ConversionUtility.SanitizeAndPrepareEmailHtml(anchorHtml);

        // Check that conversion works as expected.
        Assert.That(convertedAnchorTags, Does.Contain("target=\"_blank\""));
    }

    /// <summary>
    /// Tests the conversion of a complex anchor tag within a table cell to open in a new tab.
    /// </summary>
    [Test]
    public void TestAnchorTabConversionComplex4()
    {
        string anchorHtml = "<a href=\"https://www.maxmind.com/en/account/set-password?token=FEA9D6D78B624D6BB048687F4D0A2DD9\">https://www<span>.</span>maxmind<span>.</span>com/en/account/set-password?token=FEA9D6D78B624D6BB048687F4D0A2DD9</a>";
        string convertedAnchorTags = ConversionUtility.SanitizeAndPrepareEmailHtml(anchorHtml);

        // Check that conversion works as expected.
        Assert.That(convertedAnchorTags, Does.Contain("target=\"_blank\""));
    }

    /// <summary>
    /// Tests the conversion of a complex anchor tag with existing target="_blank" attribute to
    /// not get a second attribute after conversion.
    /// </summary>
    [Test]
    public void TestAnchorTabConversionComplex5()
    {
        string anchorHtml = "<a href=\"test.html\" target=\"_blank\">test anchor text</a>";
        string convertedAnchorTags = ConversionUtility.SanitizeAndPrepareEmailHtml(anchorHtml);

        int targetBlankCount = Regex.Matches(convertedAnchorTags, "target=\"_blank\"", RegexOptions.NonBacktracking).Count;

        Assert.Multiple(() =>
        {
            // Check that only one target="_blank" appears.
            Assert.That(targetBlankCount, Is.EqualTo(1), "There should be exactly one target=\"_blank\" attribute.");

            // Ensure other attributes are preserved
            Assert.That(convertedAnchorTags, Does.Contain("href=\"test.html\""), "The href attribute should be preserved.");

            // Check that the anchor text is preserved
            Assert.That(convertedAnchorTags, Does.Contain(">test anchor text</a>"), "The anchor text should be preserved.");
        });
    }

    /// <summary>
    /// Tests that the single-pass sanitize-and-prepare both rewrites anchors to open in a new tab
    /// (with security rel attributes) and strips dangerous content.
    /// </summary>
    [Test]
    public void TestSanitizeAndPrepareEmailHtml()
    {
        string html = "<div><script>alert('xss')</script><a href=\"https://example.com\">link</a></div>";
        string result = ConversionUtility.SanitizeAndPrepareEmailHtml(html);

        Assert.Multiple(() =>
        {
            // Anchors are rewritten to open in a new tab with security attributes.
            Assert.That(result, Does.Contain("target=\"_blank\""), "The anchor should open in a new tab.");
            Assert.That(result, Does.Contain("noopener"), "The anchor should have rel=noopener.");
            Assert.That(result, Does.Contain("noreferrer"), "The anchor should have rel=noreferrer.");

            // Dangerous content is removed.
            Assert.That(result, Does.Not.Contain("<script"), "Script tags should be stripped.");

            // Safe content is preserved.
            Assert.That(result, Does.Contain("href=\"https://example.com\""), "The href should be preserved.");
            Assert.That(result, Does.Contain(">link</a>"), "The anchor text should be preserved.");
        });
    }

    /// <summary>
    /// Tests that an existing target attribute is normalized to _blank without duplicating it.
    /// </summary>
    [Test]
    public void TestSanitizeAndPrepareEmailHtmlNormalizesExistingTarget()
    {
        string html = "<a href=\"https://example.com\" target=\"_self\">link</a>";
        string result = ConversionUtility.SanitizeAndPrepareEmailHtml(html);

        int targetCount = Regex.Matches(result, "target=", RegexOptions.NonBacktracking).Count;

        Assert.Multiple(() =>
        {
            Assert.That(targetCount, Is.EqualTo(1), "There should be exactly one target attribute.");
            Assert.That(result, Does.Contain("target=\"_blank\""), "The target should be normalized to _blank.");
        });
    }
}
