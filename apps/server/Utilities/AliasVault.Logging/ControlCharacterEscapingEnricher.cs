//-----------------------------------------------------------------------
// <copyright file="ControlCharacterEscapingEnricher.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Logging;

using System.Globalization;
using System.Text;
using Serilog.Core;
using Serilog.Events;

/// <summary>
/// Escapes control characters in string properties.
/// </summary>
public sealed class ControlCharacterEscapingEnricher : ILogEventEnricher
{
    /// <inheritdoc />
    public void Enrich(LogEvent logEvent, ILogEventPropertyFactory propertyFactory)
    {
        List<LogEventProperty>? updates = null;
        foreach (var (name, value) in logEvent.Properties)
        {
            if (value is ScalarValue { Value: string text } && text.Any(char.IsControl))
            {
                (updates ??= []).Add(new LogEventProperty(name, new ScalarValue(Escape(text))));
            }
        }

        updates?.ForEach(logEvent.AddOrUpdateProperty);
    }

    /// <summary>
    /// Replaces control characters with their escaped form (<c>\r</c>, <c>\n</c>, <c>\t</c> or <c>\uXXXX</c>).
    /// </summary>
    /// <param name="text">The value to escape.</param>
    /// <returns>The escaped value.</returns>
    internal static string Escape(string text)
    {
        var builder = new StringBuilder(text.Length + 8);
        foreach (var c in text)
        {
            builder.Append(c switch
            {
                '\r' => "\\r",
                '\n' => "\\n",
                '\t' => "\\t",
                _ when char.IsControl(c) => "\\u" + ((int)c).ToString("x4", CultureInfo.InvariantCulture),
                _ => c.ToString(),
            });
        }

        return builder.ToString();
    }
}
