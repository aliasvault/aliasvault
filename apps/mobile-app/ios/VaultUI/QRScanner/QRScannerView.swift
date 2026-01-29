import SwiftUI
import AVFoundation

private let locBundle = Bundle.vaultUI

/// SwiftUI view for scanning QR codes using AVFoundation
public struct QRScannerView: View {
    let onCodeScanned: (String) -> Void
    let onCancel: () -> Void
    let prefixes: [String]?
    let statusText: String

    @State private var hasScanned = false
    @State private var showFlash = false

    public init(
        prefixes: [String]? = nil,
        statusText: String? = nil,
        onCodeScanned: @escaping (String) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.prefixes = prefixes
        self.statusText = statusText?.isEmpty == false ? statusText! : "Scan QR code"
        self.onCodeScanned = onCodeScanned
        self.onCancel = onCancel
    }

    public var body: some View {
        ZStack {
            // Camera preview
            QRScannerRepresentable(
                prefixes: prefixes,
                onCodeScanned: { code in
                    if !hasScanned {
                        hasScanned = true
                        showFlash = true

                        // Flash animation then callback
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                            onCodeScanned(code)
                        }
                    }
                },
                onCodeRejected: {
                    // Reset hasScanned to allow scanning again
                    hasScanned = false
                }
            )
            .edgesIgnoringSafeArea(.all)

            // Overlay with viewfinder
            VStack {
                Spacer()

                // Viewfinder frame
                Rectangle()
                    .stroke(Color.white, lineWidth: 3)
                    .frame(width: 280, height: 280)
                    .overlay(
                        // Flash effect
                        Rectangle()
                            .fill(Color.white)
                            .opacity(showFlash ? 0.7 : 0)
                            .animation(.easeInOut(duration: 0.2), value: showFlash)
                    )

                Spacer()

                // Status text
                Text(statusText)
                    .foregroundColor(.white)
                    .padding()
                    .background(Color.black.opacity(0.7))
                    .cornerRadius(10)
                    .padding(.bottom, 50)
            }

            // Cancel button
            VStack {
                HStack {
                    Spacer()
                    Button(action: onCancel) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 32))
                            .foregroundColor(.white)
                            .padding()
                    }
                }
                Spacer()
            }
        }
        .background(Color.black)
    }
}

/// UIViewControllerRepresentable wrapper for AVFoundation camera
struct QRScannerRepresentable: UIViewControllerRepresentable {
    let prefixes: [String]?
    let onCodeScanned: (String) -> Void
    let onCodeRejected: () -> Void

    func makeUIViewController(context: Context) -> QRScannerViewController {
        let controller = QRScannerViewController()
        controller.prefixes = prefixes
        controller.onCodeScanned = onCodeScanned
        controller.onCodeRejected = onCodeRejected
        return controller
    }

    func updateUIViewController(_ uiViewController: QRScannerViewController, context: Context) {
        // No updates needed
    }
}

/// UIViewController that handles AVFoundation QR code scanning
class QRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var captureSession: AVCaptureSession?
    var previewLayer: AVCaptureVideoPreviewLayer?
    var prefixes: [String]?
    var onCodeScanned: ((String) -> Void)?
    var onCodeRejected: (() -> Void)?
    private var rejectedQRCodes = Set<String>() // Track rejected QR codes to avoid repeated haptic feedback

    override func viewDidLoad() {
        super.viewDidLoad()
        setupCamera()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)

        if let session = captureSession, !session.isRunning {
            DispatchQueue.global(qos: .userInitiated).async {
                session.startRunning()
            }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)

        if let session = captureSession, session.isRunning {
            DispatchQueue.global(qos: .userInitiated).async {
                session.stopRunning()
            }
        }
    }

    private func setupCamera() {
        let session = AVCaptureSession()

        guard let videoCaptureDevice = AVCaptureDevice.default(for: .video) else {
            return
        }

        let videoInput: AVCaptureDeviceInput

        do {
            videoInput = try AVCaptureDeviceInput(device: videoCaptureDevice)
        } catch {
            return
        }

        if session.canAddInput(videoInput) {
            session.addInput(videoInput)
        } else {
            return
        }

        let metadataOutput = AVCaptureMetadataOutput()

        if session.canAddOutput(metadataOutput) {
            session.addOutput(metadataOutput)

            metadataOutput.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
            metadataOutput.metadataObjectTypes = [.qr]
        } else {
            return
        }

        let previewLayer = AVCaptureVideoPreviewLayer(session: session)
        previewLayer.frame = view.layer.bounds
        previewLayer.videoGravity = .resizeAspectFill
        view.layer.addSublayer(previewLayer)

        self.captureSession = session
        self.previewLayer = previewLayer

        DispatchQueue.global(qos: .userInitiated).async {
            session.startRunning()
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.layer.bounds
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        if let metadataObject = metadataObjects.first,
           let readableObject = metadataObject as? AVMetadataMachineReadableCodeObject,
           let stringValue = readableObject.stringValue {

            // Check if prefixes filter is enabled
            if let prefixes = prefixes, !prefixes.isEmpty {
                // Check if the scanned code starts with any of the accepted prefixes
                let hasValidPrefix = prefixes.contains { prefix in
                    stringValue.hasPrefix(prefix)
                }

                if !hasValidPrefix {
                    // Invalid QR code - only give haptic feedback once per unique code
                    if !rejectedQRCodes.contains(stringValue) {
                        let generator = UINotificationFeedbackGenerator()
                        generator.notificationOccurred(.warning)
                        rejectedQRCodes.insert(stringValue)
                    }

                    // Notify that code was rejected (to reset UI state if needed)
                    onCodeRejected?()
                    return
                }
            }

            // Valid QR code - stop scanning
            captureSession?.stopRunning()

            // Success haptic feedback
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)

            // Callback with scanned code
            onCodeScanned?(stringValue)
        }
    }
}
