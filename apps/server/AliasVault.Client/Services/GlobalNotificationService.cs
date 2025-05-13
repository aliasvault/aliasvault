//-----------------------------------------------------------------------
// <copyright file="GlobalNotificationService.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Client.Services;

/// <summary>
/// Handles global notifications that should be displayed to the user, such as success or error messages. These messages
/// are stored in this object which is scoped to the current session. This allows the messages to be cached until
/// they actually have been displayed. So they can survive redirects and page reloads.
/// </summary>
public sealed class GlobalNotificationService
{
    /// <summary>
    /// Allow other components to subscribe to changes in the event object.
    /// </summary>
    public event Action? OnChange;

    /// <summary>
    /// Gets success messages that should be displayed to the user.
    /// </summary>
    private List<string> SuccessMessages { get; } = [];

    /// <summary>
    /// Gets error messages that should be displayed to the user.
    /// </summary>
    private List<string> ErrorMessages { get; } = [];

    /// <summary>
    /// Adds a success message to the list of messages that should be displayed to the user.
    /// </summary>
    /// <param name="message">The message to add.</param>
    /// <param name="notifyStateChanged">Whether to notify state change to subscribers. Defaults to false.
    /// Set this to true if you want to show the added message instantly instead of waiting for the notification
    /// display to rerender (e.g. after navigation).</param>
    public void AddSuccessMessage(string message, bool notifyStateChanged = false)
    {
        SuccessMessages.Add(message);

        // Notify subscribers that a message has been added.
        if (notifyStateChanged)
        {
            NotifyStateChanged();
        }
    }

    /// <summary>
    /// Adds an error message to the list of messages that should be displayed to the user.
    /// </summary>
    /// <param name="message">The message to add.</param>
    /// <param name="notifyStateChanged">Whether to notify state change to subscribers. Defaults to false.
    /// Set this to true if you want to show the added message instantly instead of waiting for the notification
    /// display to rerender (e.g. after navigation).</param>
    public void AddErrorMessage(string message, bool notifyStateChanged = false)
    {
        ErrorMessages.Add(message);

        // Notify subscribers that a message has been added.
        if (notifyStateChanged)
        {
            NotifyStateChanged();
        }
    }

    /// <summary>
    /// Returns a dictionary with messages that should be displayed to the user. After this method is called,
    /// the messages are automatically cleared.
    /// </summary>
    /// <returns>Dictionary with messages that are ready to be displayed on the next page load.</returns>
    public List<KeyValuePair<string, string>> GetMessagesForDisplay()
    {
        var messages = new List<KeyValuePair<string, string>>();
        foreach (var message in SuccessMessages)
        {
            messages.Add(new KeyValuePair<string, string>("success", message));
        }

        foreach (var message in ErrorMessages)
        {
            messages.Add(new KeyValuePair<string, string>("error", message));
        }

        // Clear messages
        SuccessMessages.Clear();
        ErrorMessages.Clear();

        return messages;
    }

    /// <summary>
    /// Clear all messages.
    /// </summary>
    public void ClearMessages()
    {
        SuccessMessages.Clear();
        ErrorMessages.Clear();
        NotifyStateChanged();
    }

    private void NotifyStateChanged() => OnChange?.Invoke();
}
