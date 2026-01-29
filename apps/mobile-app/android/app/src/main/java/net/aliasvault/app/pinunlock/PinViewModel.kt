package net.aliasvault.app.pinunlock

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.aliasvault.app.R
import net.aliasvault.app.vaultstore.PinUnlockException
import net.aliasvault.app.vaultstore.VaultStore

/**
 * ViewModel for PIN unlock and setup operations.
 * Handles business logic and state management for PIN flows.
 */
class PinViewModel(
    private val context: Context,
    private val vaultStore: VaultStore,
) {
    /**
     * Initialize PIN configuration based on mode.
     * @param mode The PIN mode (unlock or setup)
     * @param customTitle Optional custom title to override default
     * @param customSubtitle Optional custom subtitle to override default
     */
    fun initializeConfiguration(
        mode: PinMode,
        customTitle: String? = null,
        customSubtitle: String? = null,
    ): PinConfiguration {
        return when (mode) {
            PinMode.UNLOCK -> {
                val pinLength = vaultStore.getPinLength()
                PinConfiguration(
                    mode = PinMode.UNLOCK,
                    title = customTitle ?: context.getString(R.string.pin_unlock_vault),
                    subtitle = customSubtitle ?: context.getString(R.string.pin_enter_to_unlock),
                    pinLength = pinLength,
                )
            }
            PinMode.SETUP -> {
                PinConfiguration(
                    mode = PinMode.SETUP,
                    title = customTitle ?: context.getString(R.string.pin_setup_title),
                    subtitle = customSubtitle ?: context.getString(R.string.pin_setup_description),
                    pinLength = null, // Allow any length from 4-8
                    setupStep = PinSetupStep.ENTER_NEW,
                )
            }
        }
    }

    /**
     * Process the entered PIN based on current configuration.
     */
    suspend fun processPin(
        pin: String,
        configuration: PinConfiguration,
        setupEncryptionKey: String? = null,
    ): PinResult = withContext(Dispatchers.IO) {
        return@withContext when (configuration.mode) {
            PinMode.UNLOCK -> processUnlock(pin)
            PinMode.SETUP -> processSetup(pin, configuration, setupEncryptionKey)
        }
    }

    /**
     * Process unlock attempt.
     */
    private fun processUnlock(pin: String): PinResult {
        return try {
            val encryptionKey = vaultStore.unlockWithPin(pin)
            PinResult.Success(encryptionKey)
        } catch (e: PinUnlockException) {
            when (e) {
                is PinUnlockException.Locked -> {
                    PinResult.PinDisabled
                }
                is PinUnlockException.IncorrectPin -> {
                    PinResult.Error(
                        context.getString(R.string.pin_incorrect_attempts_remaining, e.attemptsRemaining),
                        shouldClear = true,
                    )
                }
            }
        } catch (e: Exception) {
            PinResult.Error(
                e.message ?: context.getString(R.string.unknown_error),
                shouldClear = true,
            )
        }
    }

    /**
     * Process setup flow.
     */
    private fun processSetup(
        pin: String,
        configuration: PinConfiguration,
        setupEncryptionKey: String?,
    ): PinResult {
        return when (configuration.setupStep) {
            PinSetupStep.ENTER_NEW -> {
                // Validate PIN length
                if (pin.length < 4) {
                    return PinResult.Error(
                        "PIN must be at least 4 digits",
                        shouldClear = false,
                    )
                }
                if (pin.length > 8) {
                    return PinResult.Error(
                        "PIN must be at most 8 digits",
                        shouldClear = false,
                    )
                }

                // Move to confirm step
                val newConfig = configuration.copy(
                    title = context.getString(R.string.pin_confirm_title),
                    subtitle = context.getString(R.string.pin_confirm_description),
                    setupStep = PinSetupStep.CONFIRM,
                    firstStepPin = pin,
                    pinLength = pin.length, // Fix length for confirmation
                )
                PinResult.NextStep(newConfig)
            }
            PinSetupStep.CONFIRM -> {
                // Check if PINs match
                if (pin != configuration.firstStepPin) {
                    return PinResult.Mismatch(context.getString(R.string.pin_mismatch))
                }

                // Setup the PIN
                try {
                    if (setupEncryptionKey == null) {
                        return PinResult.Error(
                            "Encryption key required for PIN setup",
                            shouldClear = false,
                        )
                    }
                    vaultStore.setupPin(pin, setupEncryptionKey)
                    PinResult.Success(null)
                } catch (e: Exception) {
                    PinResult.Error(
                        e.message ?: "Failed to setup PIN",
                        shouldClear = false,
                    )
                }
            }
        }
    }

    /**
     * Check if PIN entry should auto-submit based on configuration.
     */
    fun shouldAutoSubmit(pinLength: Int, configuration: PinConfiguration): Boolean {
        // Auto-submit when:
        // 1. In unlock mode with fixed length PIN
        // 2. In confirm step with matching length
        return when {
            configuration.mode == PinMode.UNLOCK && configuration.pinLength != null -> {
                pinLength == configuration.pinLength
            }
            configuration.mode == PinMode.SETUP &&
                configuration.setupStep == PinSetupStep.CONFIRM &&
                configuration.pinLength != null -> {
                pinLength == configuration.pinLength
            }
            else -> false
        }
    }
}
