//-----------------------------------------------------------------------
// <copyright file="MobileLoginException.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Utilities;

using System;

/// <summary>
/// Exception thrown during mobile login operations.
/// Contains a <see cref="MobileLoginErrorCode"/> for translation.
/// </summary>
public class MobileLoginException : Exception
{
    /// <summary>
    /// Initializes a new instance of the <see cref="MobileLoginException"/> class.
    /// </summary>
    /// <param name="errorCode">The error code.</param>
    public MobileLoginException(MobileLoginErrorCode errorCode)
        : base($"Mobile login failed with error code: {errorCode}")
    {
        ErrorCode = errorCode;
    }

    /// <summary>
    /// Gets the error code.
    /// </summary>
    public MobileLoginErrorCode ErrorCode { get; }
}
