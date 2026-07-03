import Foundation

public extension AgentIntegration {
    struct PathAgentIntegrationDetector: AgentIntegrationDetecting, Sendable {
        public typealias ExecutableProbe = @Sendable (String) -> Bool

        private let pathEnvironment: String
        private let expectedVersion: IntegrationVersion
        private let isExecutableFile: ExecutableProbe

        public init(
            pathEnvironment: String = ProcessInfo.processInfo.environment["PATH"] ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
            expectedVersion: IntegrationVersion = "1.0.0",
            isExecutableFile: @escaping ExecutableProbe = { FileManager.default.isExecutableFile(atPath: $0) }
        ) {
            self.pathEnvironment = pathEnvironment
            self.expectedVersion = expectedVersion
            self.isExecutableFile = isExecutableFile
        }

        public func detectAgentIntegrations() async throws -> [AgentIntegrationStatus] {
            AgentIntegration.supportedAgentDescriptors
                .filter { $0.id != .custom && $0.id != .future }
                .map(status(for:))
        }

        public func integrationStatus(for agentID: AgentCLIIdentifier) async throws -> AgentIntegrationStatus {
            guard let descriptor = AgentIntegration.supportedAgentDescriptors.first(where: { $0.id == agentID }),
                  descriptor.id != .custom,
                  descriptor.id != .future
            else {
                throw AgentIntegrationError.unsupportedAgent(agentID)
            }
            return status(for: descriptor)
        }

        private func status(for descriptor: AgentDescriptor) -> AgentIntegrationStatus {
            let executablePath = firstExecutablePath(for: descriptor)
            return AgentIntegrationStatus(
                agent: descriptor,
                state: .notInstalled,
                installedVersion: nil,
                expectedVersion: expectedVersion,
                ownership: nil,
                detectedExecutablePath: executablePath
            )
        }

        private func firstExecutablePath(for descriptor: AgentDescriptor) -> String? {
            for directory in searchDirectories() {
                for executableName in descriptor.executableNames {
                    let candidate = directory.appendingPathComponent(executableName)
                    if isExecutableFile(candidate) {
                        return candidate
                    }
                }
            }
            return nil
        }

        private func searchDirectories() -> [String] {
            pathEnvironment
                .split(separator: ":")
                .map(String.init)
                .filter { !$0.isEmpty }
        }
    }
}

private extension String {
    func appendingPathComponent(_ component: String) -> String {
        if hasSuffix("/") {
            return self + component
        }
        return self + "/" + component
    }
}
