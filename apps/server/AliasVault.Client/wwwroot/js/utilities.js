function downloadFileFromStream(fileName, contentStreamReference) {
    const arrayBuffer = new Uint8Array(contentStreamReference).buffer;
    const blob = new Blob([arrayBuffer]);
    const url = URL.createObjectURL(blob);
    const anchorElement = document.createElement('a');
    anchorElement.href = url;
    anchorElement.download = fileName ?? '';
    anchorElement.click();
    anchorElement.remove();
    URL.revokeObjectURL(url);
}

window.topMenuClickOutsideHandler = (dotNetHelper) => {
    document.addEventListener('click', (event) => {
        const userMenu = document.getElementById('userMenuDropdown');
        const userMenuButton = document.getElementById('userMenuDropdownButton');
        const mobileMenu = document.getElementById('mobileMenuDropdown');
        const mobileMenuButton = document.getElementById('toggleMobileMenuButton');

        // Handle user menu
        if (userMenu && !userMenu.contains(event.target) && !userMenuButton.contains(event.target)) {
            dotNetHelper.invokeMethodAsync('CloseUserMenu');
        }

        // Handle mobile menu
        if (mobileMenu && !mobileMenu.contains(event.target)) {
            if (!mobileMenuButton.contains(event.target)) {
                dotNetHelper.invokeMethodAsync('CloseMobileMenu');
            }
        }
    });
};

window.clipboardCopy = {
    copyText: function (text) {
        navigator.clipboard.writeText(text).then(function () { })
            .catch(function (error) {
                alert(error);
            });
    }
};

// Global clipboard manager with timestamp-based clearing
window.clipboardManager = {
    clearByTime: null,
    clearTimer: null,
    copiedValue: null,
    clearPending: false,  // Track if clear is pending due to focus issues
    statusCallback: null,  // Callback to notify Blazor of status changes
    failedAttempts: 0,  // Track consecutive failed clear attempts

    // Set up a new clipboard clear schedule
    scheduleClipboardClear: function(seconds) {
        // Clear any existing timer
        if (this.clearTimer) {
            clearTimeout(this.clearTimer);
            this.clearTimer = null;
        }

        // Reset pending state and failed attempts counter
        this.clearPending = false;
        this.failedAttempts = 0;
        this.notifyStatusChange('active');

        // Set the clear by time
        this.clearByTime = Date.now() + (seconds * 1000);

        // Try to clear when the time is reached
        this.clearTimer = setTimeout(() => {
            this.attemptClipboardClear('timer expired');
        }, seconds * 1000);
    },

    // Notify Blazor of status change
    notifyStatusChange: function(status) {
        if (this.statusCallback) {
            try {
                this.statusCallback.invokeMethodAsync('OnClipboardStatusChange', status);
            } catch (error) {
                if (error.message && error.message.includes('tracked object')) {
                    this.statusCallback = null;
                }
            }
        }
    },

    // Attempt to clear the clipboard
    attemptClipboardClear: function(source) {
        // Check if we should clear
        if (!this.clearByTime) {
            return Promise.resolve(false);
        }

        const now = Date.now();
        const timeRemaining = this.clearByTime - now;

        if (timeRemaining > 100) {  // Allow 100ms tolerance for timer precision
            // If called from timer and there's still time, reschedule
            if (source === 'timer expired' && timeRemaining > 0) {
                this.clearTimer = setTimeout(() => {
                    this.attemptClipboardClear('timer expired');
                }, timeRemaining);
            }
            return Promise.resolve(false);
        }

        return navigator.clipboard.writeText('')
            .then(() => {
                this.clearByTime = null;
                this.copiedValue = null;
                this.clearPending = false;
                this.failedAttempts = 0;
                if (this.clearTimer) {
                    clearTimeout(this.clearTimer);
                    this.clearTimer = null;
                }
                this.notifyStatusChange('cleared');
                return true;
            })
            .catch((error) => {
                if (error.name === 'NotAllowedError' || error.message.includes('Document is not focused')) {
                    // Browser blocked clipboard clear - increment failed attempts
                    this.failedAttempts++;

                    // Only show UI prompt after 2+ consecutive failures
                    // First failure might be due to timing/focus, second failure indicates real restriction
                    if (this.failedAttempts >= 2) {
                        this.clearPending = true;
                        this.notifyStatusChange('manual_clear_required');
                    } else {
                        // First failure - just set pending, will retry on focus
                        this.notifyStatusChange('pending');
                    }
                } else {
                    console.warn(`[Clipboard] ❌ ERROR - Failed to clear clipboard from: ${source}`, error);
                }
                return false;
            });
    },

    // Check and clear if needed (called on focus events)
    checkAndClear: function(source) {
        if (this.clearByTime && Date.now() >= this.clearByTime) {
            // Small delay to ensure browser is ready after focus, then attempt clear
            // Don't reset pending state here - let attemptClipboardClear handle it based on success/failure
            setTimeout(() => {
                this.attemptClipboardClear(source);
            }, 100);
        }
    }
};

// Copy to clipboard and schedule clear
window.copyToClipboardWithClear = function(text, clearAfterSeconds) {
    return navigator.clipboard.writeText(text)
        .then(() => {
            if (clearAfterSeconds > 0) {
                window.clipboardManager.copiedValue = text;
                window.clipboardManager.scheduleClipboardClear(clearAfterSeconds);
            }
            return true;
        })
        .catch((error) => {
            console.error('[Clipboard] ❌ Failed to copy to clipboard:', error);
            return false;
        });
};

// Global focus event listener
window.addEventListener('focus', () => {
    window.clipboardManager.checkAndClear('window focus event');
});

// Global visibility change listener
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        window.clipboardManager.checkAndClear('document became visible');
    }
});

// Also check on page visibility API
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        window.clipboardManager.checkAndClear('page no longer hidden');
    }
});

// Check when window becomes active (another way to detect focus)
window.addEventListener('pageshow', () => {
    window.clipboardManager.checkAndClear('pageshow event');
});

// Legacy method for compatibility
window.safeClearClipboard = function() {
    return window.clipboardManager.attemptClipboardClear('manual clear request');
};

// Register a callback for clipboard status changes
window.registerClipboardStatusCallback = function(callback) {
    window.clipboardManager.statusCallback = callback;
    // Test the callback immediately to make sure it works
    window.clipboardManager.notifyStatusChange('registered');
};

// Unregister the callback
window.unregisterClipboardStatusCallback = function() {
    window.clipboardManager.statusCallback = null;
};

// Primarily used by E2E tests.
window.blazorNavigate = (url) => {
    Blazor.navigateTo(url);
};

window.focusElement = (elementId) => {
    const element = document.getElementById(elementId);
    if (element) {
        element.focus();
    }
};

window.focusAndSelectElement = (elementId) => {
    const element = document.getElementById(elementId);
    if (element) {
        element.focus();
        if (element.select) {
            element.select();
        }
    }
};

window.blurElement = (elementId) => {
    const element = document.getElementById(elementId);
    if (element) {
        element.blur();
    }
};

function initializeDarkMode() {
    if (localStorage.getItem('color-theme') === 'dark' ||
        (!localStorage.getItem('color-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

window.darkModeCallback = null;

function initDarkModeSwitcher() {
    const themeToggleDarkIcon = document.getElementById('theme-toggle-dark-icon');
    const themeToggleLightIcon = document.getElementById('theme-toggle-light-icon');
    const themeToggleBtn = document.getElementById('theme-toggle');

    if (!themeToggleBtn || !themeToggleDarkIcon || !themeToggleLightIcon) {
        return;
    }

    const isDark = localStorage.getItem('color-theme') === 'dark' ||
        (!localStorage.getItem('color-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);

    if (isDark) {
        themeToggleDarkIcon?.classList.remove('hidden');
    } else {
        themeToggleLightIcon?.classList.remove('hidden');
    }

    // Notify Blazor of initial state
    if (window.darkModeCallback) {
        window.darkModeCallback.invokeMethodAsync('OnThemeChanged', isDark);
    }

    let event = new Event('dark-mode');

    themeToggleBtn.addEventListener('click', function () {
        // toggle icons
        themeToggleDarkIcon.classList.toggle('hidden');
        themeToggleLightIcon.classList.toggle('hidden');

        // toggle dark mode
        const newIsDark = !document.documentElement.classList.contains('dark');
        if (document.documentElement.classList.contains('dark')) {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('color-theme', 'light');
        } else {
            document.documentElement.classList.add('dark');
            localStorage.setItem('color-theme', 'dark');
        }

        // Notify Blazor of theme change
        if (window.darkModeCallback) {
            window.darkModeCallback.invokeMethodAsync('OnThemeChanged', newIsDark);
        }

        document.dispatchEvent(event);
    });
}

window.registerDarkModeCallback = function(callback) {
    window.darkModeCallback = callback;
};

initializeDarkMode();

window.initTopMenu = function() {
    initDarkModeSwitcher();
};

/**
 * Generate a QR code for the given id element that has a data-url attribute.
 * @param id
 */
function generateQrCode(id) {
    // Find the element by id
    const element = document.getElementById(id);

    // Check if the element exists
    if (!element) {
        return;
    }

    // Get the data-url attribute
    const dataUrl = element.getAttribute('data-url');

    // Check if data-url exists
    if (!dataUrl) {
        return;
    }

    // Create a container for the QR code
    const qrContainer = document.createElement('div');
    qrContainer.id = `qrcode-${id}`;
    element.appendChild(qrContainer);

    // Initialize QRCode object
    let qrcode = new QRCode(qrContainer, {
        width: 256,
        height: 256,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });

    qrcode.makeCode(dataUrl);
}

/**
 * Gets or creates a WebAuthn credential and derives a key from it.
 * @param {string} credentialIdToUse - The credentialId to use if one exists.
 * @param {string} salt - The salt to use when deriving the key.
 * @returns {Promise<string>} The derived key as a base64 string.
 */
async function getWebAuthnCredentialAndDeriveKey(credentialIdToUse, salt) {
    const rpId = window.location.hostname;
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    try {
        const existingCredential = await navigator.credentials.get({
            publicKey: {
                challenge,
                rpId,
                userVerification: "discouraged",
                allowCredentials: [{
                    id: Uint8Array.from(atob(credentialIdToUse), c => c.charCodeAt(0)),
                    type: 'public-key'
                }],
                extensions: {
                    prf: {
                        eval: {
                            first: Uint8Array.from(atob(salt), c => c.charCodeAt(0)),
                        },
                    },
                },
            }
        });

        const extensionsResult = existingCredential.getClientExtensionResults();
        if (!extensionsResult?.prf) {
            return { Error: "PRF_NOT_SUPPORTED" };
        }

        if (!extensionsResult.prf?.results?.first) {
            return { Error: "PRF_DERIVATION_FAILED" };
        }

        const derivedKey = extensionsResult.prf.results.first;
        return {
            DerivedKey: btoa(String.fromCharCode.apply(null, new Uint8Array(derivedKey)))
        };
    } catch (error) {
        console.error("Error getting WebAuthn credential:", error);
        return { Error: "WEBAUTHN_GET_ERROR", Message: error.message };
    }
}

/**
 * Creates a WebAuthn credential and derives a key from it.
 * @param {string} username - The username to associate with the credential.
 * * @returns {Promise<{credentialId: string, salt: string, derivedKey: string} | null>} An object containing the credentialId, salt and derived key, or null if unsuccessful.
 */
async function createWebAuthnCredentialAndDeriveKey(username) {
    const rpId = window.location.hostname;
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const salt = crypto.getRandomValues(new Uint8Array(32));

    try {
        // Create the credential
        const newCredential = await navigator.credentials.create({
            publicKey: {
                challenge,
                rp: {
                    name: "AliasVault Web Unlock",
                    id: rpId},
                user: {
                    id: crypto.getRandomValues(new Uint8Array(32)),
                    name: username,
                    displayName: username
                },
                pubKeyCredParams: [
                    { alg: -7, type: "public-key" },   // ES256
                    { alg: -257, type: "public-key" }, // RS256
                    { alg: -37, type: "public-key" },  // PS256
                    { alg: -8, type: "public-key" },   // EdDSA
                    { alg: -35, type: "public-key" },  // ES384
                    { alg: -36, type: "public-key" },  // ES512
                    { alg: -259, type: "public-key" }, // RS384
                    { alg: -258, type: "public-key" }, // RS512
                    { alg: -38, type: "public-key" },  // PS384
                    { alg: -39, type: "public-key" },  // PS512
                ],
                authenticatorSelection: {
                    userVerification: "discouraged",
                    residentKey: "discouraged",
                    requireResidentKey: false,
                },
                extensions: {
                    prf: {
                        eval: {
                            first: salt,
                        },
                    },
                },
            }
        });

        let extensionsResult = newCredential.getClientExtensionResults();

        if (!extensionsResult.prf) {
            return { Error: "PRF_NOT_SUPPORTED" };
        }

        if (!extensionsResult.prf?.results?.first) {
            alert("Your authenticator has been successfully registered. Please use your authenticator again to complete the process.")

            // Note: Some authenticators do not return the derived key in the create response. In this case,
            // we need to read the credential to get the derived key. This is required for certain passkeys
            // such as Yubikey.
            const existingCredential = await navigator.credentials.get({
                publicKey: {
                    challenge,
                    rpId,
                    userVerification: "discouraged",
                    allowCredentials: [{
                        id: newCredential.rawId,
                        type: 'public-key'
                    }],
                    extensions: {
                        prf: {
                            eval: {
                                first: salt,
                            },
                        },
                    },
                }
            });

            extensionsResult = existingCredential.getClientExtensionResults();
        }

        if (!extensionsResult.prf?.results?.first) {
            return { Error: "PRF_DERIVATION_FAILED" };
        }

        const derivedKey = extensionsResult.prf.results.first;
        const credentialId = new Uint8Array(newCredential.rawId);

        return {
            CredentialId: btoa(String.fromCharCode.apply(null, credentialId)),
            Salt: btoa(String.fromCharCode.apply(null, salt)),
            DerivedKey: btoa(String.fromCharCode.apply(null, new Uint8Array(derivedKey))),
        };
    } catch (createError) {
        console.error("Error creating new WebAuthn credential:", createError);
        return { Error: "WEBAUTHN_CREATE_ERROR", Message: createError.message };
    }
}

// Store the event listener references.
const visibilityChangeHandlers = new Map();

/**
 * Registers visibility callback that is invoked when the visibility state of the current page/tab changes.
 *
 * @param {any} dotnetHelper
 */
window.registerVisibilityCallback = function (dotnetHelper) {
    // Create a named function so we can reference it later for removal.
    const handler = function() {
        dotnetHelper.invokeMethodAsync('OnVisibilityChange', !document.hidden);
    };

    visibilityChangeHandlers.set(dotnetHelper, handler);
    document.addEventListener("visibilitychange", handler);

    // Initial call to set the correct initial state.
    dotnetHelper.invokeMethodAsync('OnVisibilityChange', !document.hidden);
};

/**
 * Unregisters any previously registered visibility callbacks to prevent memory leaks.
 *
 * @param {any} dotnetHelper
 */
window.unregisterVisibilityCallback = function (dotnetHelper) {
    // Get the stored handler.
    const handler = visibilityChangeHandlers.get(dotnetHelper);

    if (handler) {
        // Remove the event listener with the same function reference.
        document.removeEventListener("visibilitychange", handler);
        visibilityChangeHandlers.delete(dotnetHelper);
    }
};

// Store IntersectionObserver references for cleanup.
const infiniteScrollObservers = new Map();

/**
 * Sets up an IntersectionObserver for infinite scrolling.
 * When the sentinel element becomes visible, it calls the LoadMoreItems method on the .NET component.
 *
 * @param {Element} element - The sentinel element to observe.
 * @param {any} dotnetHelper - The DotNetObjectReference to call back to.
 */
window.setupInfiniteScroll = function (element, dotnetHelper) {
    // Element reference from Blazor may be an empty object if the element doesn't exist in DOM.
    // Check if element is a valid DOM Element.
    if (!element || !(element instanceof Element)) {
        return;
    }

    // Create the IntersectionObserver.
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                dotnetHelper.invokeMethodAsync('LoadMoreItems');
            }
        });
    }, {
        root: null, // Use viewport as root.
        rootMargin: '100px', // Trigger 100px before the element is visible.
        threshold: 0
    });

    // Start observing the sentinel element.
    observer.observe(element);

    // Store the observer for cleanup.
    infiniteScrollObservers.set(element, observer);
};

/**
 * Tears down the IntersectionObserver for infinite scrolling.
 *
 * @param {Element} element - The sentinel element that was being observed.
 */
window.teardownInfiniteScroll = function (element) {
    // Element reference from Blazor may be an empty object if the element doesn't exist in DOM.
    if (!element || !(element instanceof Element)) {
        return;
    }

    const observer = infiniteScrollObservers.get(element);

    if (observer) {
        observer.disconnect();
        infiniteScrollObservers.delete(element);
    }
};
