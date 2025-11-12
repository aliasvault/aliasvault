package net.aliasvault.app.pinunlock

/**
 * Represents the configuration and state for PIN entry screen.
 */
data class PinConfiguration(
    /** The mode of operation: unlock or setup. */
    val mode: PinMode,
    /** The title to display. */
    val title: String,
    /** The subtitle/description to display. */
    val subtitle: String,
    /** The expected PIN length (null for variable length). */
    val pinLength: Int?,
    /** The current step in setup mode. */
    val setupStep: PinSetupStep = PinSetupStep.ENTER_NEW,
    /** The PIN entered in the first step (setup mode only). */
    val firstStepPin: String? = null,
)

/**
 * Modes of PIN operation.
 */
enum class PinMode {
    /** Unlock vault with existing PIN. */
    UNLOCK,

    /** Setup a new PIN (two-step process). */
    SETUP,
}

/**
 * Steps in PIN setup process.
 */
enum class PinSetupStep {
    /** First step: enter new PIN. */
    ENTER_NEW,

    /** Second step: confirm the PIN. */
    CONFIRM,
}

/**
 * Result of PIN processing.
 */
sealed class PinResult {
    /**
     * PIN processing succeeded.
     * @property encryptionKey The encryption key (returned for unlock mode, null for setup mode).
     */
    data class Success(val encryptionKey: String?) : PinResult()

    /**
     * PIN processing failed with an error.
     * @property message The error message to display.
     * @property shouldClear Whether to clear the entered PIN.
     */
    data class Error(val message: String, val shouldClear: Boolean = true) : PinResult()

    /** PIN was disabled due to max attempts. */
    object PinDisabled : PinResult()

    /**
     * Move to next step in setup flow.
     * @property newConfiguration The configuration for the next step.
     */
    data class NextStep(val newConfiguration: PinConfiguration) : PinResult()

    /**
     * PINs don't match in setup confirmation.
     * @property errorMessage The error message to display.
     */
    data class Mismatch(val errorMessage: String) : PinResult()
}
