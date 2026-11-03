package net.aliasvault.app.utils

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.view.WindowManager

/**
 * Screen capture protection: sets FLAG_SECURE on the app's windows, which blocks screenshots and screen recordings
 * and hides the app content in the recent apps screen.
 *
 * Other platform implementations: ScreenCaptureProtection.swift (iOS).
 */
object ScreenCaptureProtection {
    private const val PREFS_NAME = "AliasVaultPrefs"
    private const val KEY_ENABLED = "screen_capture_protection"

    /**
     * Whether screen capture protection is enabled. Defaults to true.
     * @param context The context to read the preference with.
     * @return Whether the protection is enabled.
     */
    fun isEnabled(context: Context): Boolean {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, true)
    }

    /**
     * Store the preference and apply it to the given activity right away.
     * @param context The context to store the preference with.
     * @param enabled Whether the protection is enabled.
     * @param activity The activity currently shown, if any.
     */
    fun setEnabled(context: Context, enabled: Boolean, activity: Activity?) {
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, enabled).apply()
        activity?.runOnUiThread { applyToWindow(activity, enabled) }
    }

    /**
     * Apply the stored preference to the activity's window, again after a theme change so the recent apps color follows it.
     * @param activity The activity to apply the preference to.
     */
    fun apply(activity: Activity) {
        applyToWindow(activity, isEnabled(activity))
    }

    private fun applyToWindow(activity: Activity, enabled: Boolean) {
        if (enabled) {
            activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                val isDarkMode = (activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
                val background = if (isDarkMode) Color.BLACK else Color.WHITE
                val description = ActivityManager.TaskDescription.Builder()
                    .setBackgroundColor(background)
                    .setStatusBarColor(background)
                    .setNavigationBarColor(background)
                    .build()
                activity.setTaskDescription(description)
            }
        } else {
            activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
}
