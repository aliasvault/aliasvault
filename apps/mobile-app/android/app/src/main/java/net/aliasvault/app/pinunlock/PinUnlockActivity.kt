package net.aliasvault.app.pinunlock

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ObjectAnimator
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.View
import android.view.WindowManager
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.Button
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import net.aliasvault.app.R
import net.aliasvault.app.vaultstore.VaultStore

/**
 * Native PIN unlock and setup activity.
 * This activity presents a numpad UI for PIN entry and handles both vault unlocking and PIN setup.
 *
 * Modes:
 * - UNLOCK: Unlock vault with existing PIN
 * - SETUP: Setup new PIN (two-step: enter → confirm)
 *
 * Usage:
 * ```
 * // Unlock mode
 * val intent = Intent(context, PinUnlockActivity::class.java)
 * intent.putExtra(PinUnlockActivity.EXTRA_MODE, PinUnlockActivity.MODE_UNLOCK)
 * startActivityForResult(intent, REQUEST_CODE)
 *
 * // Setup mode
 * val intent = Intent(context, PinUnlockActivity::class.java)
 * intent.putExtra(PinUnlockActivity.EXTRA_MODE, PinUnlockActivity.MODE_SETUP)
 * intent.putExtra(PinUnlockActivity.EXTRA_SETUP_ENCRYPTION_KEY, encryptionKey)
 * startActivityForResult(intent, REQUEST_CODE)
 * ```
 */
class PinUnlockActivity : AppCompatActivity() {

    companion object {
        /** Result code for successful PIN unlock or setup. */
        const val RESULT_SUCCESS = Activity.RESULT_OK

        /** Result code for cancelled PIN unlock or setup. */
        const val RESULT_CANCELLED = Activity.RESULT_CANCELED

        /** Result code when PIN was disabled due to max attempts. */
        const val RESULT_PIN_DISABLED = 100

        /** Intent extra key for the encryption key (returned in unlock mode). */
        const val EXTRA_ENCRYPTION_KEY = "encryption_key"

        /** Intent extra key for the mode (unlock or setup). */
        const val EXTRA_MODE = "mode"

        /** Intent extra key for the encryption key to use during setup. */
        const val EXTRA_SETUP_ENCRYPTION_KEY = "setup_encryption_key"

        /** Intent extra key for custom title (optional). */
        const val EXTRA_CUSTOM_TITLE = "custom_title"

        /** Intent extra key for custom subtitle (optional). */
        const val EXTRA_CUSTOM_SUBTITLE = "custom_subtitle"

        /** Mode: Unlock vault with existing PIN. */
        const val MODE_UNLOCK = "unlock"

        /** Mode: Setup new PIN. */
        const val MODE_SETUP = "setup"
    }

    private lateinit var viewModel: PinViewModel
    private lateinit var vaultStore: VaultStore

    // UI components
    private lateinit var titleTextView: TextView
    private lateinit var subtitleTextView: TextView
    private lateinit var pinDotsContainer: LinearLayout
    private lateinit var pinTextView: TextView
    private lateinit var errorTextView: TextView
    private lateinit var continueButton: Button
    private lateinit var loadingOverlay: View
    private lateinit var progressBar: ProgressBar

    // State
    private var configuration: PinConfiguration? = null
    private var setupEncryptionKey: String? = null
    private var currentPin: String = ""
    private var isProcessing: Boolean = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_pin_unlock)

        // Keep screen on during PIN entry
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Apply window insets for safe area
        applyWindowInsets()

        // Initialize VaultStore and ViewModel
        vaultStore = VaultStore.getInstance(
            net.aliasvault.app.vaultstore.keystoreprovider.AndroidKeystoreProvider(this) { null },
            net.aliasvault.app.vaultstore.storageprovider.AndroidStorageProvider(this),
        )
        viewModel = PinViewModel(this, vaultStore)

        // Get mode and encryption key from intent
        val mode = when (intent.getStringExtra(EXTRA_MODE)) {
            MODE_SETUP -> PinMode.SETUP
            else -> PinMode.UNLOCK
        }
        setupEncryptionKey = intent.getStringExtra(EXTRA_SETUP_ENCRYPTION_KEY)
        val customTitle = intent.getStringExtra(EXTRA_CUSTOM_TITLE)
        val customSubtitle = intent.getStringExtra(EXTRA_CUSTOM_SUBTITLE)

        // Initialize configuration
        configuration = viewModel.initializeConfiguration(mode, customTitle, customSubtitle)

        // Initialize views
        initializeViews()
        setupNumpad()
        updateUI()
    }

    private fun applyWindowInsets() {
        findViewById<View>(android.R.id.content).setOnApplyWindowInsetsListener { _, insets ->
            val cancelButton = findViewById<ImageButton>(R.id.cancelButton)
            val systemBarsInsets = insets.systemWindowInsets

            // Apply top inset to cancel button's parent FrameLayout margin
            val cancelButtonParent = cancelButton.parent as View
            val layoutParams = cancelButtonParent.layoutParams as androidx.constraintlayout.widget.ConstraintLayout.LayoutParams
            layoutParams.topMargin = systemBarsInsets.top + 8 // 8dp base margin
            cancelButtonParent.layoutParams = layoutParams

            insets
        }
    }

    private fun initializeViews() {
        titleTextView = findViewById(R.id.titleTextView)
        subtitleTextView = findViewById(R.id.subtitleTextView)
        pinDotsContainer = findViewById(R.id.pinDotsContainer)
        pinTextView = findViewById(R.id.pinTextView)
        errorTextView = findViewById(R.id.errorTextView)
        continueButton = findViewById(R.id.continueButton)
        loadingOverlay = findViewById(R.id.loadingOverlay)
        progressBar = findViewById(R.id.progressBar)

        // Cancel button
        findViewById<ImageButton>(R.id.cancelButton).setOnClickListener {
            setResult(RESULT_CANCELLED)
            finish()
        }

        // Continue button (for PIN setup)
        continueButton.setOnClickListener {
            submitPin()
        }

        // Animate views in on appear
        animateViewsIn()
    }

    private fun animateViewsIn() {
        // Fade in and translate title
        titleTextView.alpha = 0f
        titleTextView.translationY = -20f
        titleTextView.animate()
            .alpha(1f)
            .translationY(0f)
            .setDuration(400)
            .setStartDelay(100)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .start()

        // Fade in subtitle
        subtitleTextView.alpha = 0f
        subtitleTextView.animate()
            .alpha(1f)
            .setDuration(400)
            .setStartDelay(200)
            .start()

        // Fade in and scale PIN display (dots or text)
        pinDotsContainer.alpha = 0f
        pinDotsContainer.scaleX = 0.95f
        pinDotsContainer.scaleY = 0.95f
        pinDotsContainer.animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .setDuration(400)
            .setStartDelay(300)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .start()

        pinTextView.alpha = 0f
        pinTextView.scaleX = 0.95f
        pinTextView.scaleY = 0.95f
        pinTextView.animate()
            .alpha(1f)
            .scaleX(1f)
            .scaleY(1f)
            .setDuration(400)
            .setStartDelay(300)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .start()

        // Fade in numpad buttons with staggered delay
        val numpadContainer = findViewById<View>(R.id.numpadContainer)
        numpadContainer.alpha = 0f
        numpadContainer.animate()
            .alpha(1f)
            .setDuration(400)
            .setStartDelay(400)
            .start()

        // Fade in continue button (if visible)
        continueButton.alpha = 0f
        continueButton.animate()
            .alpha(1f)
            .setDuration(400)
            .setStartDelay(500)
            .start()
    }

    private fun setupNumpad() {
        // Number buttons
        findViewById<Button>(R.id.btn1).setOnClickListener { addDigit("1") }
        findViewById<Button>(R.id.btn2).setOnClickListener { addDigit("2") }
        findViewById<Button>(R.id.btn3).setOnClickListener { addDigit("3") }
        findViewById<Button>(R.id.btn4).setOnClickListener { addDigit("4") }
        findViewById<Button>(R.id.btn5).setOnClickListener { addDigit("5") }
        findViewById<Button>(R.id.btn6).setOnClickListener { addDigit("6") }
        findViewById<Button>(R.id.btn7).setOnClickListener { addDigit("7") }
        findViewById<Button>(R.id.btn8).setOnClickListener { addDigit("8") }
        findViewById<Button>(R.id.btn9).setOnClickListener { addDigit("9") }
        findViewById<Button>(R.id.btn0).setOnClickListener { addDigit("0") }

        // Backspace button
        findViewById<Button>(R.id.btnBackspace).setOnClickListener { removeDigit() }
    }

    private fun updateUI() {
        val config = configuration ?: return

        // Update title and subtitle
        titleTextView.text = config.title
        subtitleTextView.text = config.subtitle

        // Show Continue button only for setup mode on first step (variable length)
        val showContinueButton = config.mode == PinMode.SETUP &&
            config.setupStep == PinSetupStep.ENTER_NEW &&
            config.pinLength == null
        continueButton.visibility = if (showContinueButton) View.VISIBLE else View.GONE

        // Update button text based on current step
        if (showContinueButton) {
            continueButton.text = getString(R.string.common_next)
        }

        // Setup PIN display based on whether we have a fixed length
        if (config.pinLength != null) {
            // Show dots for fixed length PIN
            pinDotsContainer.visibility = View.VISIBLE
            pinTextView.visibility = View.GONE
            createPinDots(config.pinLength)
        } else {
            // Show text for variable length PIN
            pinDotsContainer.visibility = View.GONE
            pinTextView.visibility = View.VISIBLE
            updatePinText()
        }

        // Update continue button enabled state
        updateContinueButtonState()
    }

    private fun createPinDots(count: Int) {
        pinDotsContainer.removeAllViews()
        for (i in 0 until count) {
            val dot = ImageView(this).apply {
                layoutParams = LinearLayout.LayoutParams(
                    resources.getDimensionPixelSize(R.dimen.pin_dot_size),
                    resources.getDimensionPixelSize(R.dimen.pin_dot_size),
                ).apply {
                    marginStart = resources.getDimensionPixelSize(R.dimen.pin_dot_spacing)
                    marginEnd = resources.getDimensionPixelSize(R.dimen.pin_dot_spacing)
                }
                setImageResource(R.drawable.pin_dot_empty)
                tag = i
            }
            pinDotsContainer.addView(dot)
        }
    }

    private fun updatePinDots() {
        for (i in 0 until pinDotsContainer.childCount) {
            val dot = pinDotsContainer.getChildAt(i) as ImageView
            if (i < currentPin.length) {
                dot.setImageResource(R.drawable.pin_dot_filled)
            } else {
                dot.setImageResource(R.drawable.pin_dot_empty)
            }
        }
    }

    private fun updatePinText() {
        pinTextView.text = if (currentPin.isEmpty()) {
            "----"
        } else {
            "•".repeat(currentPin.length)
        }
    }

    private fun updateContinueButtonState() {
        val config = configuration ?: return
        if (continueButton.visibility == View.VISIBLE) {
            // Enable button only if PIN is at least 4 digits
            val isEnabled = currentPin.length >= 4
            continueButton.isEnabled = isEnabled

            // Animate button scale and alpha based on enabled state
            val scale = if (isEnabled) 1.0f else 0.98f
            val alpha = if (isEnabled) 1.0f else 0.5f
            continueButton.animate()
                .scaleX(scale)
                .scaleY(scale)
                .alpha(alpha)
                .setDuration(200)
                .setInterpolator(AccelerateDecelerateInterpolator())
                .start()
        }
    }

    private fun addDigit(digit: String) {
        if (isProcessing) return

        val config = configuration ?: return

        // Clear error when user starts typing with animation
        hideError()

        // Check if we've reached max length
        val maxLength = config.pinLength ?: 8 // Max 8 digits in setup mode
        if (currentPin.length >= maxLength) return

        // Add digit
        currentPin += digit

        // Update UI
        if (config.pinLength != null) {
            updatePinDots()
        } else {
            updatePinText()
        }

        // Update continue button state
        updateContinueButtonState()

        // Auto-submit when PIN reaches expected length (only for fixed-length PINs)
        if (viewModel.shouldAutoSubmit(currentPin.length, config)) {
            CoroutineScope(Dispatchers.Main).launch {
                delay(100) // Small delay to show the last dot filled
                submitPin()
            }
        }
    }

    private fun removeDigit() {
        if (isProcessing || currentPin.isEmpty()) return

        // Remove last digit
        currentPin = currentPin.dropLast(1)

        // Clear error with animation
        hideError()

        // Update UI
        val config = configuration ?: return
        if (config.pinLength != null) {
            updatePinDots()
        } else {
            updatePinText()
        }

        // Update continue button state
        updateContinueButtonState()
    }

    private fun submitPin() {
        if (isProcessing || currentPin.isEmpty()) return

        val config = configuration ?: return

        // Validate minimum length for setup mode
        if (config.mode == PinMode.SETUP &&
            config.setupStep == PinSetupStep.ENTER_NEW &&
            currentPin.length < 4
        ) {
            return // Don't submit until at least 4 digits
        }

        CoroutineScope(Dispatchers.Main).launch {
            try {
                // Show loading state
                isProcessing = true
                loadingOverlay.visibility = View.VISIBLE
                progressBar.visibility = View.VISIBLE

                // Give UI time to update
                delay(50)

                // Process the PIN
                val result = viewModel.processPin(currentPin, config, setupEncryptionKey)

                // Handle result
                handlePinResult(result)
            } catch (e: Exception) {
                isProcessing = false
                loadingOverlay.visibility = View.GONE
                progressBar.visibility = View.GONE

                showError(e.message ?: "An error occurred")
                triggerErrorFeedback()
                shakeAndClear()
            }
        }
    }

    private suspend fun handlePinResult(result: PinResult) {
        when (result) {
            is PinResult.Success -> {
                // Success - return result
                val resultIntent = Intent()
                result.encryptionKey?.let {
                    resultIntent.putExtra(EXTRA_ENCRYPTION_KEY, it)
                }
                setResult(RESULT_SUCCESS, resultIntent)
                finish()
            }
            is PinResult.Error -> {
                isProcessing = false
                loadingOverlay.visibility = View.GONE
                progressBar.visibility = View.GONE

                showError(result.message)
                triggerErrorFeedback()
                if (result.shouldClear) {
                    shakeAndClear()
                }
            }
            is PinResult.PinDisabled -> {
                showError(getString(R.string.pin_locked_max_attempts))
                triggerErrorFeedback()
                delay(1000)
                setResult(RESULT_PIN_DISABLED)
                finish()
            }
            is PinResult.NextStep -> {
                // Move to next step (setup confirmation)
                isProcessing = false
                loadingOverlay.visibility = View.GONE
                progressBar.visibility = View.GONE

                configuration = result.newConfiguration
                currentPin = ""
                updateUI()
            }
            is PinResult.Mismatch -> {
                // PINs don't match - restart setup
                isProcessing = false
                loadingOverlay.visibility = View.GONE
                progressBar.visibility = View.GONE

                showError(result.errorMessage)
                triggerErrorFeedback()

                // Restart from beginning after showing error
                delay(1000)
                configuration = viewModel.initializeConfiguration(PinMode.SETUP)
                currentPin = ""
                hideError()
                updateUI()
            }
        }
    }

    private fun showError(message: String) {
        errorTextView.text = message

        // Animate error in with slide from top and fade
        errorTextView.visibility = View.VISIBLE
        errorTextView.alpha = 0f
        errorTextView.translationY = -20f
        errorTextView.animate()
            .alpha(1f)
            .translationY(0f)
            .setDuration(300)
            .setInterpolator(AccelerateDecelerateInterpolator())
            .start()
    }

    private fun hideError() {
        if (errorTextView.visibility == View.VISIBLE) {
            errorTextView.animate()
                .alpha(0f)
                .translationY(-20f)
                .setDuration(200)
                .setInterpolator(AccelerateDecelerateInterpolator())
                .setListener(object : AnimatorListenerAdapter() {
                    override fun onAnimationEnd(animation: Animator) {
                        errorTextView.visibility = View.GONE
                    }
                })
                .start()
        }
    }

    private fun triggerErrorFeedback() {
        // Trigger haptic feedback for error
        val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            vibrator?.vibrate(VibrationEffect.createOneShot(200, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vibrator?.vibrate(200)
        }
    }

    private fun shakeAndClear() {
        // Shake the PIN display to indicate error (similar to password field shake)
        val config = configuration ?: return
        val targetView = if (config.pinLength != null) pinDotsContainer else pinTextView
        val shake = ObjectAnimator.ofFloat(targetView, "translationX", 0f, 25f, -25f, 25f, -25f, 15f, -15f, 6f, -6f, 0f)
        shake.duration = 600
        shake.start()

        CoroutineScope(Dispatchers.Main).launch {
            // Clear the PIN after a short delay to show error
            delay(500)
            currentPin = ""
            if (config.pinLength != null) {
                updatePinDots()
            } else {
                updatePinText()
            }
        }
    }

    override fun onBackPressed() {
        // Handle back button as cancel
        setResult(RESULT_CANCELLED)
        super.onBackPressed()
    }
}
