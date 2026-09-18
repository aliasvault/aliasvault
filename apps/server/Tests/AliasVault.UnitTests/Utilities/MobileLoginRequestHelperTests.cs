//-----------------------------------------------------------------------
// <copyright file="MobileLoginRequestHelperTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Utilities;

using AliasServerDb;
using AliasVault.Api.Helpers;

/// <summary>
/// Tests for the rules of the mobile login handshake.
/// </summary>
public class MobileLoginRequestHelperTests
{
    private static readonly DateTime Now = new(2026, 9, 17, 12, 0, 0, DateTimeKind.Utc);

    /// <summary>
    /// Only the poll secret that was hashed into the request opens it.
    /// </summary>
    [Test]
    public void PollSecretMustMatchStoredHash()
    {
        var request = new MobileLoginRequest { PollSecretHash = MobileLoginRequestHelper.HashPollSecret("secret-of-the-initiating-client") };

        Assert.Multiple(() =>
        {
            Assert.That(MobileLoginRequestHelper.IsPollSecretValid(request, "secret-of-the-initiating-client"), Is.True);
            Assert.That(MobileLoginRequestHelper.IsPollSecretValid(request, "another-secret"), Is.False);
            Assert.That(MobileLoginRequestHelper.IsPollSecretValid(request, string.Empty), Is.False);
            Assert.That(MobileLoginRequestHelper.IsPollSecretValid(request, null), Is.False);
        });
    }

    /// <summary>
    /// A request created before the poll secret existed has no hash and can never be polled.
    /// </summary>
    [Test]
    public void RequestWithoutPollSecretHashIsNeverPollable()
    {
        var request = new MobileLoginRequest { PollSecretHash = string.Empty };

        Assert.That(MobileLoginRequestHelper.IsPollSecretValid(request, string.Empty), Is.False);
    }

    /// <summary>
    /// A request waits for the mobile app until it is answered or the approval window closes.
    /// </summary>
    [Test]
    public void RequestAwaitsApprovalOnlyWhileUnansweredAndFresh()
    {
        Assert.Multiple(() =>
        {
            Assert.That(MobileLoginRequestHelper.IsAwaitingApproval(new MobileLoginRequest { CreatedAt = Now.AddMinutes(-1) }, Now), Is.True);
            Assert.That(MobileLoginRequestHelper.IsAwaitingApproval(new MobileLoginRequest { CreatedAt = Now.Add(-MobileLoginRequestHelper.ApprovalWindow).AddSeconds(-1) }, Now), Is.False);
            Assert.That(MobileLoginRequestHelper.IsAwaitingApproval(new MobileLoginRequest { CreatedAt = Now.AddMinutes(-1), FulfilledAt = Now }, Now), Is.False);
            Assert.That(MobileLoginRequestHelper.IsAwaitingApproval(new MobileLoginRequest { CreatedAt = Now.AddMinutes(-1), DeclinedAt = Now }, Now), Is.False);
        });
    }

    /// <summary>
    /// An approval can only be collected shortly after it was given.
    /// </summary>
    [Test]
    public void ApprovalCanOnlyBeCollectedWithinRetrievalWindow()
    {
        Assert.Multiple(() =>
        {
            Assert.That(MobileLoginRequestHelper.IsRetrievalWindowClosed(new MobileLoginRequest { FulfilledAt = Now.AddSeconds(-30) }, Now), Is.False);
            Assert.That(MobileLoginRequestHelper.IsRetrievalWindowClosed(new MobileLoginRequest { FulfilledAt = Now.Add(-MobileLoginRequestHelper.RetrievalWindow).AddSeconds(-1) }, Now), Is.True);
            Assert.That(MobileLoginRequestHelper.IsRetrievalWindowClosed(new MobileLoginRequest(), Now), Is.True);
        });
    }

    /// <summary>
    /// The client header is shown on the approval screen, so anything but the expected shape is dropped.
    /// </summary>
    /// <param name="header">The raw header value.</param>
    /// <param name="expected">The expected sanitized value.</param>
    [TestCase("chrome-0.31.0", "chrome-0.31.0")]
    [TestCase("web-0.31.0-beta", "web-0.31.0-beta")]
    [TestCase("Your bank, approve now", null)]
    [TestCase("chrome-0.31.0\nIP Address: 127.0.0.1", null)]
    [TestCase("", null)]
    [TestCase(null, null)]
    public void ClientNameIsSanitized(string? header, string? expected)
    {
        Assert.That(MobileLoginRequestHelper.SanitizeClientName(header), Is.EqualTo(expected));
    }

    /// <summary>
    /// An overlong client header is dropped instead of truncated.
    /// </summary>
    [Test]
    public void OverlongClientNameIsDropped()
    {
        Assert.That(MobileLoginRequestHelper.SanitizeClientName(new string('a', 51)), Is.Null);
    }
}
