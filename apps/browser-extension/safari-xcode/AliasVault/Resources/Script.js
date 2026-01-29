function show(enabled, useSettingsInsteadOfPreferences) {
    if (useSettingsInsteadOfPreferences) {
        document.getElementsByClassName('state-on')[0].innerText = "AliasVault's Safari browser extension is succesfully enabled. If you wish to turn it off, go to the Safari Extensions preferences.";
        document.getElementsByClassName('state-off')[0].innerText = "AliasVault's Safari browser extension is currently disabled. If you wish to turn it on, go to the Safari Extensions preferences.";
        document.getElementsByClassName('state-unknown')[0].innerText = "To enable AliasVault's Safari browser extension, go to the Safari Extensions preferences.";
        document.getElementsByClassName('open-preferences')[0].innerText = "Open Safari Extensions Preferences…";
    }

    if (typeof enabled === "boolean") {
        document.body.classList.toggle(`state-on`, enabled);
        document.body.classList.toggle(`state-off`, !enabled);
    } else {
        document.body.classList.remove(`state-on`);
        document.body.classList.remove(`state-off`);
    }
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);
