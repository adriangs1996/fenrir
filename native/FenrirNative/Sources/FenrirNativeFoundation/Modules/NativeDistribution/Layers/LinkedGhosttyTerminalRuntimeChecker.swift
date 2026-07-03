import Darwin
import Foundation

extension NativeDistribution {
    struct LinkedGhosttyTerminalRuntimeChecker: GhosttyTerminalRuntimeChecking {
        let bundle: Bundle
        let symbolName: String

        func probeGhosttyTerminalRuntime() async throws -> GhosttyTerminalRuntimeProbeResult {
            let handle = dlopen(nil, RTLD_NOW)
            let symbol = handle.flatMap { dlsym($0, symbolName) }
            return GhosttyTerminalRuntimeProbeResult(
                symbolName: symbolName,
                isLinked: symbol != nil,
                version: bundle.infoDictionary?["FenrirGhosttyTerminalVersion"] as? String
            )
        }
    }
}
