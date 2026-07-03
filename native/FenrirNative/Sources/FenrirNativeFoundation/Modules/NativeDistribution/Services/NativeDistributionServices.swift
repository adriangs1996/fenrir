import Foundation
import FenrirNativeShared

public extension NativeDistribution {
    protocol NativeDistributionClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol TmuxDependencyChecking: Sendable {
        func probeTmux() async throws -> ToolProbeResult
    }

    protocol ServerAssetLocating: Sendable {
        func locateServerAsset() async throws -> ServerAssetProbeResult
    }

    protocol TerminalRendererArtifactLocating: Sendable {
        func locateTerminalRendererArtifact() async throws -> TerminalRendererArtifactProbeResult
    }

    static func pathTmuxDependencyChecker() -> any TmuxDependencyChecking {
        PathTmuxDependencyChecker()
    }

    static func appResourceServerAssetLocator(
        bundle: Bundle = .main,
        resourceName: String = "fenrir-server",
        resourceExtension: String? = nil
    ) -> any ServerAssetLocating {
        AppResourceServerAssetLocator(
            bundle: bundle,
            resourceName: resourceName,
            resourceExtension: resourceExtension
        )
    }

    static func appResourceTerminalRendererArtifactLocator(
        bundle: Bundle = .main,
        artifactResourceName: String = "FenrirTerminalRenderer",
        artifactResourceExtension: String? = nil,
        resourcesResourceName: String = "FenrirTerminalResources",
        resourcesResourceExtension: String? = nil
    ) -> any TerminalRendererArtifactLocating {
        AppResourceTerminalRendererArtifactLocator(
            bundle: bundle,
            artifactResourceName: artifactResourceName,
            artifactResourceExtension: artifactResourceExtension,
            resourcesResourceName: resourcesResourceName,
            resourcesResourceExtension: resourcesResourceExtension
        )
    }
}
