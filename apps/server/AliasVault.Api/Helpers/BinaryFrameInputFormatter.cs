//-----------------------------------------------------------------------
// <copyright file="BinaryFrameInputFormatter.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Api.Helpers;

using System.Buffers.Binary;
using System.Text.Json;
using AliasVault.Shared.Models.WebApi.V2.Vault;
using Microsoft.AspNetCore.Mvc.Formatters;

/// <summary>
/// Reads an <see cref="IFrameBody"/> request sent as a <see cref="BinaryFrame"/>, so it binds and validates like a JSON body.
/// </summary>
public class BinaryFrameInputFormatter : InputFormatter
{
    /// <summary>
    /// Initializes a new instance of the <see cref="BinaryFrameInputFormatter"/> class.
    /// </summary>
    public BinaryFrameInputFormatter()
    {
        SupportedMediaTypes.Add(BinaryFrame.ContentType);
    }

    /// <inheritdoc/>
    public override async Task<InputFormatterResult> ReadRequestBodyAsync(InputFormatterContext context)
    {
        using var buffer = new MemoryStream();
        await context.HttpContext.Request.Body.CopyToAsync(buffer, context.HttpContext.RequestAborted);
        var body = buffer.GetBuffer().AsMemory(0, (int)buffer.Length);

        var headerLength = body.Length < 4 ? uint.MaxValue : BinaryPrimitives.ReadUInt32BigEndian(body.Span);
        if (headerLength > body.Length - 4)
        {
            return Malformed(context, "The frame header length exceeds the body.");
        }

        IFrameBody? model;
        try
        {
            model = JsonSerializer.Deserialize(body.Span.Slice(4, (int)headerLength), context.ModelType, JsonSerializerOptions.Web) as IFrameBody;
        }
        catch (JsonException ex)
        {
            return Malformed(context, ex.Message);
        }

        if (model == null)
        {
            return Malformed(context, "The frame header is empty.");
        }

        // Bytes no known part points at are ignored, as unknown JSON fields are.
        var data = body[(4 + (int)headerLength)..];
        foreach (var part in model.FrameParts)
        {
            if (part.Offset < 0 || part.Size < 0 || (long)part.Offset + part.Size > data.Length)
            {
                return Malformed(context, "A ciphertext exceeds the body.");
            }

            part.Data = data.Slice(part.Offset, part.Size).ToArray();
        }

        return await InputFormatterResult.SuccessAsync(model);
    }

    /// <inheritdoc/>
    protected override bool CanReadType(Type type)
    {
        return typeof(IFrameBody).IsAssignableFrom(type);
    }

    /// <summary>
    /// Records why the frame was refused, which turns the request into a 400.
    /// </summary>
    /// <param name="context">The formatter context.</param>
    /// <param name="reason">Why the frame was refused.</param>
    /// <returns>The failure result.</returns>
    private static InputFormatterResult Malformed(InputFormatterContext context, string reason)
    {
        context.ModelState.TryAddModelError(context.ModelName, reason);
        return InputFormatterResult.Failure();
    }
}
