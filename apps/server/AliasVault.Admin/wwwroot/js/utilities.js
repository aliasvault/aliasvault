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

window.initTopMenu = function() {
    initDarkModeSwitcher();
};

window.isDarkMode = function() {
    return document.documentElement.classList.contains('dark');
};

window.registerClickOutsideHandler = (dotNetHelper) => {
    document.addEventListener('click', (event) => {
        const menu = document.getElementById('userMenuDropdown');
        const menuButton = document.getElementById('userMenuDropdownButton');
        if (menu && !menu.contains(event.target) && !menuButton.contains(event.target)) {
            dotNetHelper.invokeMethodAsync('CloseMenu');
        }

        const mobileMenu = document.getElementById('mobileMenu');
        const mobileMenuButton = document.getElementById('toggleMobileMenuButton');
        if (mobileMenu && !mobileMenu.contains(event.target) && !mobileMenuButton.contains(event.target)) {
            dotNetHelper.invokeMethodAsync('CloseMenu');
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

window.isFunctionDefined = function(functionName) {
    return typeof window[functionName] === 'function';
};

// Primarily used by E2E tests.
window.blazorNavigate = (url) => {
    Blazor.navigateTo(url);
};

/**
 * Generate a QR code for the given id element that has a data-url attribute.
 * Includes proper quiet zone (white padding) for reliable scanning in dark mode.
 * @param id
 */
function generateQrCode(id) {
    console.log(`Generating QR code for element with id "${id}".`);
    // Find the element by id
    const element = document.getElementById(id);

    // Check if the element exists
    if (!element) {
        console.log(`Element with id "${id}" not found. QR code generation aborted.`);
        return; // Silently fail
    }

    // Get the data-url attribute
    const dataUrl = element.getAttribute('data-url');

    // Check if data-url exists
    if (!dataUrl) {
        console.log(`No data-url attribute found on element with id "${id}". QR code generation aborted.`);
        return; // Silently fail
    }

    // Create a wrapper with white background and padding for the quiet zone.
    // QR code best practices require at least 4 modules of quiet zone (white space)
    // around the code for reliable scanning, especially important in dark mode.
    const qrWrapper = document.createElement('div');
    qrWrapper.style.display = 'inline-block';
    qrWrapper.style.padding = '16px';
    qrWrapper.style.backgroundColor = '#ffffff';
    qrWrapper.style.borderRadius = '8px';

    // Create a container for the QR code
    const qrContainer = document.createElement('div');
    qrContainer.id = `qrcode-${id}`;
    qrWrapper.appendChild(qrContainer);
    element.appendChild(qrWrapper);

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

// Keyboard navigation for pagination
window.enablePaginationKeyboardNavigation = (element, dotNetHelper, currentPage, maxPage) => {
    if (!element) return;
    
    // Add tabindex and focus if not already set
    if (!element.hasAttribute('tabindex')) {
        element.setAttribute('tabindex', '0');
    }
    
    // Remove any existing event listener to prevent duplicates
    if (element._paginationKeyHandler) {
        element.removeEventListener('keydown', element._paginationKeyHandler);
    }
    
    // Create keyboard event handler
    element._paginationKeyHandler = (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            
            const newPage = e.key === 'ArrowLeft' 
                ? Math.max(1, currentPage - 1)
                : Math.min(maxPage, currentPage + 1);
                
            if (newPage !== currentPage) {
                dotNetHelper.invokeMethodAsync('NavigateToPage', newPage);
            }
        }
    };
    
    // Add event listener
    element.addEventListener('keydown', element._paginationKeyHandler);
};
