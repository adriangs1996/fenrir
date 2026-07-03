import Foundation

enum NativeDesktopBootstrapCredential {
    static let environmentKeys = [
        "FENRIR_NATIVE_BOOTSTRAP_TOKEN",
        "FENRIR_DESKTOP_BOOTSTRAP_TOKEN",
        "FENRIR_BOOTSTRAP_TOKEN"
    ]

    private static let generatedCredential = "fenrir-native-\(UUID().uuidString)"

    static func resolve(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        generateIfMissing: Bool = true
    ) -> String? {
        if let configured = environmentKeys
            .compactMap({ environment[$0]?.trimmingCharacters(in: .whitespacesAndNewlines) })
            .first(where: { !$0.isEmpty })
        {
            return configured
        }

        return generateIfMissing ? generatedCredential : nil
    }
}
