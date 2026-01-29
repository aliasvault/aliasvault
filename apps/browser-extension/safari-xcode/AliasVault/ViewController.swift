import Cocoa
import SafariServices
import WebKit

let extensionBundleIdentifier = "net.aliasvault.safari.extension"

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            guard let state = state, error == nil else {
                // Insert code to inform the user that something went wrong.
                return
            }

            DispatchQueue.main.async {
                if #available(macOS 13, *) {
                    webView.evaluateJavaScript("show(\(state.isEnabled), true)")
                } else {
                    webView.evaluateJavaScript("show(\(state.isEnabled), false)")
                }
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if (message.body as! String != "open-preferences") {
            return;
        }

        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            DispatchQueue.main.async {
                if let error = error {
                    // Show manual instructions in case opening the preferences fails due to restricted permissions.
                    let alert = NSAlert()
                    alert.messageText = "Safari Extensions Settings"
                    alert.informativeText = """
                        Please follow these steps to enable the extension:
                        1. Open Safari
                        2. Click Safari > Settings in the menu bar
                        3. Go to Extensions
                        4. Find and enable "AliasVault"
                        """
                    alert.addButton(withTitle: "OK")
                    alert.runModal()
                }
                else {
                    // Close app
                    NSApplication.shared.terminate(nil)
                }
            }
        }
    }

}
