import Foundation

public extension AgentIntegration {
    /// File-backed gate that keeps the first-run integrations prompt from
    /// reopening on every launch: it fires once per distinct set of degraded
    /// agents and stays quiet until that set changes.
    struct AgentIntegrationFirstRunPromptGate: Sendable {
        private let markerFileURL: URL

        public init(markerFileURL: URL) {
            self.markerFileURL = markerFileURL
        }

        public static func applicationSupport(
            applicationSupportDirectoryName: String = "FenrirNative",
            fileManager: FileManager = .default
        ) -> AgentIntegrationFirstRunPromptGate? {
            guard let root = try? fileManager.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: false
            ) else {
                return nil
            }
            return AgentIntegrationFirstRunPromptGate(markerFileURL: root
                .appendingPathComponent(applicationSupportDirectoryName, isDirectory: true)
                .appendingPathComponent("agent-integration-first-run.json", isDirectory: false))
        }

        public func shouldPresentPrompt(for state: AgentIntegrationPanelState) -> Bool {
            guard state.shouldPresentFirstRunPrompt else {
                return false
            }
            return loadFingerprint() != fingerprint(for: state)
        }

        public func markPromptPresented(for state: AgentIntegrationPanelState) {
            let directoryURL = markerFileURL.deletingLastPathComponent()
            try? FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
            try? Data(fingerprint(for: state).utf8).write(to: markerFileURL, options: [.atomic])
        }

        private func loadFingerprint() -> String? {
            guard let data = try? Data(contentsOf: markerFileURL) else {
                return nil
            }
            return String(decoding: data, as: UTF8.self)
        }

        private func fingerprint(for state: AgentIntegrationPanelState) -> String {
            state.degradedStatuses
                .map { "\($0.agent.id.rawValue):\($0.state.rawValue)" }
                .sorted()
                .joined(separator: "|")
        }
    }
}
