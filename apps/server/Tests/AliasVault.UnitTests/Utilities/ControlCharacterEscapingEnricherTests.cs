//-----------------------------------------------------------------------
// <copyright file="ControlCharacterEscapingEnricherTests.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.UnitTests.Utilities;

using AliasVault.Logging;
using Serilog.Events;
using Serilog.Parsing;

/// <summary>
/// Tests that request-supplied log values cannot forge log lines.
/// </summary>
public class ControlCharacterEscapingEnricherTests
{
    /// <summary>
    /// CR/LF and other control characters in a string property are escaped; other values are left as-is.
    /// </summary>
    [Test]
    public void EscapesControlCharactersInStringProperties()
    {
        var logEvent = new LogEvent(
            DateTimeOffset.UtcNow,
            LogEventLevel.Warning,
            null,
            new MessageTemplateParser().Parse("{User} tried to claim invalid email: {Email}"),
            [
                new LogEventProperty("User", new ScalarValue("alice")),
                new LogEventProperty("Email", new ScalarValue("x\r\n[12:00:00 ERR] forged\u0007")),
                new LogEventProperty("Count", new ScalarValue(3)),
            ]);

        new ControlCharacterEscapingEnricher().Enrich(logEvent, null!);

        Assert.Multiple(() =>
        {
            Assert.That(logEvent.RenderMessage(), Is.EqualTo("\"alice\" tried to claim invalid email: \"x\\r\\n[12:00:00 ERR] forged\\u0007\""));
            Assert.That(((ScalarValue)logEvent.Properties["Count"]).Value, Is.EqualTo(3));
        });
    }
}
