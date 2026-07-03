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

    protocol GhosttyTerminalRuntimeChecking: Sendable {
        func probeGhosttyTerminalRuntime() async throws -> GhosttyTerminalRuntimeProbeResult
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

    static func linkedGhosttyTerminalRuntimeChecker(
        bundle: Bundle = .main,
        symbolName: String = "ghostty_surface_new"
    ) -> any GhosttyTerminalRuntimeChecking {
        LinkedGhosttyTerminalRuntimeChecker(bundle: bundle, symbolName: symbolName)
    }
}
