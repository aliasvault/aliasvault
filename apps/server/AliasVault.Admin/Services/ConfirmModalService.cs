//-----------------------------------------------------------------------
// <copyright file="ConfirmModalService.cs" company="aliasvault">
// Copyright (c) aliasvault. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Services;

using System;
using System.Threading.Tasks;

/// <summary>
/// Service for managing confirmation modals.
/// </summary>
public class ConfirmModalService
{
    private TaskCompletionSource<bool> _modalTaskCompletionSource = default!;

    /// <summary>
    /// Event triggered when the modal state changes.
    /// </summary>
    public event Action OnChange = default!;

    /// <summary>
    /// Gets the title of the modal.
    /// </summary>
    public string Title { get; private set; } = "Are you sure?";

    /// <summary>
    /// Gets the message of the modal.
    /// </summary>
    public string Message { get; private set; } = "Are you sure you want to do this?";

    /// <summary>
    /// Gets the confirm button text.
    /// </summary>
    public string ConfirmButtonText { get; private set; } = "Confirm";

    /// <summary>
    /// Gets the cancel button text.
    /// </summary>
    public string CancelButtonText { get; private set; } = "Cancel";

    /// <summary>
    /// Gets a value indicating whether the modal is visible.
    /// </summary>
    public bool IsVisible { get; private set; }

    /// <summary>
    /// Shows the confirmation modal and waits for user response.
    /// </summary>
    /// <param name="title">The title of the modal.</param>
    /// <param name="message">The message to display in the modal.</param>
    /// <returns>A task that completes when the user responds, returning true if confirmed, false if cancelled.</returns>
    public Task<bool> ShowConfirmation(string title, string message)
    {
        return ShowConfirmation(title, message, "Confirm", "Cancel");
    }

    /// <summary>
    /// Shows the confirmation modal and waits for user response.
    /// </summary>
    /// <param name="title">The title of the modal.</param>
    /// <param name="message">The message to display in the modal.</param>
    /// <param name="confirmButtonText">The text for the confirm button.</param>
    /// <param name="cancelButtonText">The text for the cancel button.</param>
    /// <returns>A task that completes when the user responds, returning true if confirmed, false if cancelled.</returns>
    public Task<bool> ShowConfirmation(string title, string message, string confirmButtonText, string cancelButtonText)
    {
        Title = title;
        Message = message;
        ConfirmButtonText = confirmButtonText;
        CancelButtonText = cancelButtonText;
        IsVisible = true;
        _modalTaskCompletionSource = new TaskCompletionSource<bool>();
        NotifyStateChanged();
        return _modalTaskCompletionSource.Task;
    }

    /// <summary>
    /// Closes the modal with the specified result.
    /// </summary>
    /// <param name="result">The result of the confirmation.</param>
    public void CloseModal(bool result)
    {
        IsVisible = false;
        _modalTaskCompletionSource.TrySetResult(result);
        NotifyStateChanged();
    }

    private void NotifyStateChanged() => OnChange?.Invoke();
}
