import Foundation

extension NativeDistribution {
    struct AppResourceTerminalRendererArtifactLocator: TerminalRendererArtifactLocating {
        let bundle: Bundle
        let artifactResourceName: String
        let artifactResourceExtension: String?
        let resourcesResourceName: String
        let resourcesResourceExtension: String?

        func locateTerminalRendererArtifact() async throws -> TerminalRendererArtifactProbeResult {
            guard let artifactURL = bundle.url(forResource: artifactResourceName, withExtension: artifactResourceExtension) else {
                return TerminalRendererArtifactProbeResult(
                    artifactPath: nil,
                    resourcesPath: resourcesURL()?.path,
                    isLoadable: false,
                    version: bundle.infoDictionary?["FenrirTerminalRendererVersion"] as? String
                )
            }

            return TerminalRendererArtifactProbeResult(
                artifactPath: artifactURL.path,
                resourcesPath: resourcesURL()?.path,
                isLoadable: FileManager.default.fileExists(atPath: artifactURL.path),
                version: bundle.infoDictionary?["FenrirTerminalRendererVersion"] as? String
            )
        }

        private func resourcesURL() -> URL? {
            bundle.url(forResource: resourcesResourceName, withExtension: resourcesResourceExtension)
        }
    }
}
