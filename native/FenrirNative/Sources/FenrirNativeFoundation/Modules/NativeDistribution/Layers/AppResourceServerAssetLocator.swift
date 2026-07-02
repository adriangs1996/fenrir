import Foundation

extension NativeDistribution {
    struct AppResourceServerAssetLocator: ServerAssetLocating {
        let bundle: Bundle
        let resourceName: String
        let resourceExtension: String?

        func locateServerAsset() async throws -> ServerAssetProbeResult {
            guard let url = bundle.url(forResource: resourceName, withExtension: resourceExtension) else {
                return ServerAssetProbeResult(assetPath: nil, isExecutable: false)
            }

            return ServerAssetProbeResult(
                assetPath: url.path,
                isExecutable: FileManager.default.isExecutableFile(atPath: url.path),
                version: bundle.infoDictionary?["FenrirServerVersion"] as? String
            )
        }
    }
}
