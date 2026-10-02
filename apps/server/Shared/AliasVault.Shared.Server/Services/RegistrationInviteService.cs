//-----------------------------------------------------------------------
// <copyright file="RegistrationInviteService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Shared.Server.Services;

using System;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using AliasServerDb;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// Creates, checks and consumes registration invites.
/// </summary>
/// <param name="dbContextFactory">IDbContextFactory instance.</param>
/// <param name="timeProvider">TimeProvider instance.</param>
public class RegistrationInviteService(IAliasServerDbContextFactory dbContextFactory, TimeProvider timeProvider)
{
    /// <summary>
    /// Characters allowed in a code (skip ambiguous characters).
    /// </summary>
    private const string CodeAlphabet = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

    /// <summary>
    /// Number of code characters.
    /// </summary>
    private const int CodeLength = 20;

    /// <summary>
    /// Maximum accepted length of a code as entered by a user, before normalization.
    /// </summary>
    private const int MaxInputLength = 64;

    /// <summary>
    /// Normalize a code as entered by a user: uppercase, separators removed.
    /// </summary>
    /// <param name="code">The code as entered.</param>
    /// <returns>The normalized code.</returns>
    public static string NormalizeCode(string code)
    {
        var sb = new StringBuilder(code.Length);
        foreach (var c in code.ToUpperInvariant())
        {
            switch (c)
            {
                case '-' or ' ' or '\t':
                    continue;
                case 'O':
                    sb.Append('0');
                    break;
                case 'I' or 'L':
                    sb.Append('1');
                    break;
                default:
                    sb.Append(c);
                    break;
            }
        }

        return sb.ToString();
    }

    /// <summary>
    /// Format a code in groups of four for display.
    /// </summary>
    /// <param name="code">The normalized code.</param>
    /// <returns>The formatted code.</returns>
    public static string FormatCode(string code)
    {
        var sb = new StringBuilder();
        for (var i = 0; i < code.Length; i += 4)
        {
            if (i > 0)
            {
                sb.Append('-');
            }

            sb.Append(code.AsSpan(i, Math.Min(4, code.Length - i)));
        }

        return sb.ToString();
    }

    /// <summary>
    /// Create an invite and return its code.
    /// </summary>
    /// <param name="note">Optional admin note.</param>
    /// <param name="maxUses">Number of accounts that may register with the invite.</param>
    /// <param name="expiresAt">Expiry moment in UTC, or null for no expiry.</param>
    /// <param name="createdBy">The admin username creating the invite.</param>
    /// <returns>The invite code, formatted in groups of four.</returns>
    public async Task<string> CreateAsync(string? note, int maxUses, DateTime? expiresAt, string? createdBy)
    {
        var code = GenerateCode();

        await using var context = await dbContextFactory.CreateDbContextAsync();
        context.RegistrationInvites.Add(new RegistrationInvite
        {
            Id = Guid.NewGuid(),
            Code = code,
            Note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(),
            MaxUses = Math.Max(1, maxUses),
            ExpiresAt = expiresAt,
            CreatedBy = createdBy,
            CreatedAt = timeProvider.GetUtcNow().UtcDateTime,
        });
        await context.SaveChangesAsync();

        return FormatCode(code);
    }

    /// <summary>
    /// Whether the code belongs to an invite that is not expired and has uses left.
    /// </summary>
    /// <param name="code">The code as entered by the user.</param>
    /// <returns>True if the invite can be used.</returns>
    public async Task<bool> IsValidAsync(string? code)
    {
        var normalized = TryNormalizeInput(code);
        if (normalized is null)
        {
            return false;
        }

        var now = timeProvider.GetUtcNow().UtcDateTime;
        await using var context = await dbContextFactory.CreateDbContextAsync();
        return await context.RegistrationInvites.AnyAsync(x => x.Code == normalized && x.UseCount < x.MaxUses && (x.ExpiresAt == null || x.ExpiresAt > now));
    }

    /// <summary>
    /// Atomically take one use of the invite.
    /// </summary>
    /// <param name="code">The code as entered by the user.</param>
    /// <returns>The invite id when a use was taken, null when the invite is unknown, expired or used up.</returns>
    public async Task<Guid?> TryConsumeAsync(string? code)
    {
        var normalized = TryNormalizeInput(code);
        if (normalized is null)
        {
            return null;
        }

        var now = timeProvider.GetUtcNow().UtcDateTime;
        await using var context = await dbContextFactory.CreateDbContextAsync();
        var invite = await context.RegistrationInvites.Where(x => x.Code == normalized).Select(x => new { x.Id }).FirstOrDefaultAsync();
        if (invite is null)
        {
            return null;
        }

        // The conditional update makes two concurrent registrations unable to both take the last use.
        var updated = await context.RegistrationInvites
            .Where(x => x.Id == invite.Id && x.UseCount < x.MaxUses && (x.ExpiresAt == null || x.ExpiresAt > now))
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.UseCount, x => x.UseCount + 1).SetProperty(x => x.LastUsedAt, now));

        return updated == 1 ? invite.Id : null;
    }

    /// <summary>
    /// Give back a use taken by <see cref="TryConsumeAsync"/> when the registration did not complete.
    /// </summary>
    /// <param name="inviteId">The invite id.</param>
    /// <returns>Task.</returns>
    public async Task ReleaseAsync(Guid inviteId)
    {
        await using var context = await dbContextFactory.CreateDbContextAsync();
        await context.RegistrationInvites.Where(x => x.Id == inviteId && x.UseCount > 0).ExecuteUpdateAsync(s => s.SetProperty(x => x.UseCount, x => x.UseCount - 1));
    }

    private static string? TryNormalizeInput(string? code)
    {
        if (string.IsNullOrWhiteSpace(code) || code.Length > MaxInputLength)
        {
            return null;
        }

        return NormalizeCode(code);
    }

    private static string GenerateCode()
    {
        var chars = new char[CodeLength];
        for (var i = 0; i < CodeLength; i++)
        {
            chars[i] = CodeAlphabet[RandomNumberGenerator.GetInt32(CodeAlphabet.Length)];
        }

        return new string(chars);
    }
}
