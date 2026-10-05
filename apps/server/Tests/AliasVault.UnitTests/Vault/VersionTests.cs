//-----------------------------------------------------------------------
// <copyright file="VersionTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Vault;

using AliasVault.Api.Helpers;

/// <summary>
/// Tests for the Vault version comparison methods.
/// </summary>
public class VersionTests
{
    /// <summary>
    /// Test the version comparison for lower versions.
    /// </summary>
    [Test]
    public void VersionLowerComparisonTrueTest()
    {
        var version1 = "1.0.0";
        var version2 = "1.0.1";
        Assert.That(VersionHelper.IsVersionOlder(version1, version2), Is.True);
    }

    /// <summary>
    /// Test the version comparison for higher versions.
    /// </summary>
    [Test]
    public void VersionLowerComparisonFalseTest()
    {
        var version1 = "1.2.0";
        var version2 = "1.0.1";
        Assert.That(VersionHelper.IsVersionOlder(version1, version2), Is.False);
    }

    /// <summary>
    /// Test the version comparison throws an exception for illegal version strings.
    /// </summary>
    [Test]
    public void VersionLowerComparisonExceptionTest()
    {
        var version1 = "1.2.0.5.1";
        var version2 = "1.0.1";
        Assert.Throws<ArgumentException>(() => VersionHelper.IsVersionOlder(version1, version2));
    }

    /// <summary>
    /// Test the version comparison throws an exception for illegal version strings.
    /// </summary>
    [Test]
    public void VersionEqualOrNewerComparisonExceptionTest()
    {
        var version1 = "1.2.0.5.1";
        var version2 = "1.0.1";
        Assert.Throws<ArgumentException>(() => VersionHelper.IsVersionOlder(version1, version2));
    }

    /// <summary>
    /// Test the version comparison returns true for equal versions.
    /// </summary>
    [Test]
    public void VersionEqualComparisonTest()
    {
        var version1 = "1.2.0";
        var version2 = "1.1.0";
        Assert.That(VersionHelper.IsVersionEqualOrNewer(version1, version2), Is.True);
    }

    /// <summary>
    /// Test that a version in the global blocked list is correctly identified as blocked.
    /// </summary>
    [Test]
    public void VersionBlockedReturnsTrueForGloballyBlockedVersion()
    {
        var blockedVersions = new Dictionary<string, HashSet<string>>
        {
            { "*", ["0.26.0", "0.27.0"] },
        };

        Assert.That(VersionHelper.IsVersionBlocked("chrome", "0.26.0", blockedVersions), Is.True);
        Assert.That(VersionHelper.IsVersionBlocked("ios", "0.27.0", blockedVersions), Is.True);
        Assert.That(VersionHelper.IsVersionBlocked("android", "0.26.0", blockedVersions), Is.True);
    }

    /// <summary>
    /// Test that a version in the platform-specific blocked list is correctly identified as blocked.
    /// </summary>
    [Test]
    public void VersionBlockedReturnsTrueForPlatformSpecificBlockedVersion()
    {
        var blockedVersions = new Dictionary<string, HashSet<string>>
        {
            { "chrome", ["0.25.0"] },
            { "ios", ["0.24.0"] },
        };

        // Platform-specific blocks should work
        Assert.That(VersionHelper.IsVersionBlocked("chrome", "0.25.0", blockedVersions), Is.True);
        Assert.That(VersionHelper.IsVersionBlocked("ios", "0.24.0", blockedVersions), Is.True);

        // Other platforms should not be blocked
        Assert.That(VersionHelper.IsVersionBlocked("firefox", "0.25.0", blockedVersions), Is.False);
        Assert.That(VersionHelper.IsVersionBlocked("android", "0.24.0", blockedVersions), Is.False);
    }

    /// <summary>
    /// Test that global and platform-specific blocks work together.
    /// </summary>
    [Test]
    public void VersionBlockedCombinesGlobalAndPlatformSpecific()
    {
        var blockedVersions = new Dictionary<string, HashSet<string>>
        {
            { "*", ["0.26.0"] },
            { "chrome", ["0.25.0"] },
        };

        // Global block applies to all platforms for exact version
        Assert.That(VersionHelper.IsVersionBlocked("chrome", "0.26.0", blockedVersions), Is.True);
        Assert.That(VersionHelper.IsVersionBlocked("ios", "0.26.0", blockedVersions), Is.True);
        Assert.That(VersionHelper.IsVersionBlocked("ios", "0.26.1", blockedVersions), Is.False);

        // Platform-specific block only applies to that platform
        Assert.That(VersionHelper.IsVersionBlocked("chrome", "0.25.0", blockedVersions), Is.True);
        Assert.That(VersionHelper.IsVersionBlocked("firefox", "0.25.0", blockedVersions), Is.False);
    }

    /// <summary>
    /// Test that a version not in the blocked list is correctly identified as not blocked.
    /// </summary>
    [Test]
    public void VersionBlockedReturnsFalseForNonBlockedVersion()
    {
        var blockedVersions = new Dictionary<string, HashSet<string>>
        {
            { "*", ["0.26.0"] },
        };

        Assert.That(VersionHelper.IsVersionBlocked("chrome", "0.25.3", blockedVersions), Is.False);
        Assert.That(VersionHelper.IsVersionBlocked("chrome", "0.26.1", blockedVersions), Is.False);
        Assert.That(VersionHelper.IsVersionBlocked("chrome", "0.27.0", blockedVersions), Is.False);
    }

    /// <summary>
    /// Test that empty or null inputs are handled correctly.
    /// </summary>
    [Test]
    public void VersionBlockedHandlesEmptyInputs()
    {
        var blockedVersions = new Dictionary<string, HashSet<string>>
        {
            { "*", ["0.26.0"] },
        };

        var emptyBlockedVersions = new Dictionary<string, HashSet<string>>();

        Assert.That(VersionHelper.IsVersionBlocked("chrome", string.Empty, blockedVersions), Is.False);
        Assert.That(VersionHelper.IsVersionBlocked("chrome", "0.26.0", emptyBlockedVersions), Is.False);
    }

    /// <summary>
    /// Test that a client name without an override is checked against the default minimum instead of being rejected.
    /// </summary>
    [Test]
    public void ClientVersionSupportedFallsBackToDefaultMinimumForUnknownClient()
    {
        var minimumVersions = new Dictionary<string, string> { { "chrome", "0.30.0" } };
        var blockedVersions = new Dictionary<string, HashSet<string>> { { "*", ["0.27.0"] } };

        Assert.That(VersionHelper.IsClientVersionSupported("cli", "0.26.3", minimumVersions, "0.26.3", blockedVersions), Is.True);
        Assert.That(VersionHelper.IsClientVersionSupported("cli", "0.26.2", minimumVersions, "0.26.3", blockedVersions), Is.False);
        Assert.That(VersionHelper.IsClientVersionSupported("cli", "0.27.0", minimumVersions, "0.26.3", blockedVersions), Is.False);
        Assert.That(VersionHelper.IsClientVersionSupported("chrome", "0.29.0", minimumVersions, "0.26.3", blockedVersions), Is.False);
        Assert.That(VersionHelper.IsClientVersionSupported("chrome", "0.30.0", minimumVersions, "0.26.3", blockedVersions), Is.True);
    }

    /// <summary>
    /// Test that a missing or unparseable client version is reported as unsupported instead of throwing.
    /// </summary>
    [Test]
    public void ClientVersionSupportedReturnsFalseForInvalidVersion()
    {
        var minimumVersions = new Dictionary<string, string>();
        var blockedVersions = new Dictionary<string, HashSet<string>>();

        Assert.That(VersionHelper.IsClientVersionSupported("chrome", null, minimumVersions, "0.26.3", blockedVersions), Is.False);
        Assert.That(VersionHelper.IsClientVersionSupported("chrome", string.Empty, minimumVersions, "0.26.3", blockedVersions), Is.False);
        Assert.That(VersionHelper.IsClientVersionSupported("chrome", "abc", minimumVersions, "0.26.3", blockedVersions), Is.False);
        Assert.That(VersionHelper.IsClientVersionSupported("cli", "v1", minimumVersions, "0.26.3", blockedVersions), Is.False);
    }
}
