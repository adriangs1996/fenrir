import Foundation
import FenrirNativeShared

public extension NativeDistribution {
    struct DescribeNativeDistributionModule: FenrirAction {
        public typealias Failure = DistributionReadinessError

        public let clock: any NativeDistributionClock

        public init(clock: any NativeDistributionClock) {
            self.clock = clock
        }

        public func run(_ input: DescribeNativeDistributionModuleInput) async -> Result<DescribeNativeDistributionModuleResult, DistributionReadinessError> {
            let timestamp = clock.now()
            return .success(DescribeNativeDistributionModuleResult(
                requestID: input.requestID,
                summary: ModuleSummary(registeredAt: timestamp),
                timestamp: timestamp
            ))
        }
    }

    struct AssessStartupReadiness: FenrirAction {
        public typealias Failure = DistributionReadinessError

        public let clock: any NativeDistributionClock
        public let tmuxChecker: any TmuxDependencyChecking
        public let serverAssetLocator: any ServerAssetLocating

        public init(
            clock: any NativeDistributionClock,
            tmuxChecker: any TmuxDependencyChecking,
            serverAssetLocator: any ServerAssetLocating
        ) {
            self.clock = clock
            self.tmuxChecker = tmuxChecker
            self.serverAssetLocator = serverAssetLocator
        }

        public func run(_ input: AssessStartupReadinessInput) async -> Result<AssessStartupReadinessResult, DistributionReadinessError> {
            let timestamp = clock.now()

            do {
                let checks = try await NativeDistribution.checks(
                    mode: input.mode,
                    minimumTmuxVersion: input.minimumTmuxVersion,
                    tmuxChecker: tmuxChecker,
                    serverAssetLocator: serverAssetLocator
                )
                let diagnostics = checks.compactMap(NativeDistribution.diagnostic(for:))
                let canStart = !diagnostics.contains { $0.severity == .error }
                let report = StartupReadinessReport(
                    mode: input.mode,
                    canStart: canStart,
                    checks: checks,
                    diagnostics: diagnostics,
                    generatedAt: timestamp
                )
                return .success(AssessStartupReadinessResult(
                    requestID: input.requestID,
                    report: report,
                    timestamp: timestamp
                ))
            } catch let error as DistributionReadinessError {
                return .failure(error)
            } catch {
                return .failure(.dependencyProbeFailed(String(describing: error)))
            }
        }
    }

    static func checks(
        mode: StartupMode,
        minimumTmuxVersion: String,
        tmuxChecker: any TmuxDependencyChecking,
        serverAssetLocator: any ServerAssetLocating
    ) async throws -> [DependencyCheck] {
        var checks: [DependencyCheck] = []

        if mode.requiresLocalTmux {
            checks.append(try await tmuxCheck(minimumVersion: minimumTmuxVersion, checker: tmuxChecker))
        } else {
            checks.append(DependencyCheck(
                kind: .tmux,
                status: .notRequired,
                message: "Remote attach uses the remote server tmux kernel; local tmux is not required."
            ))
        }

        if mode.requiresBundledServerAsset {
            checks.append(try await serverAssetCheck(locator: serverAssetLocator))
        } else {
            checks.append(DependencyCheck(
                kind: .fenrirServerAsset,
                status: .notRequired,
                message: mode == .existingLocalServer
                    ? "Existing local server mode attaches to an externally managed Fenrir server."
                    : "Remote attach mode does not use a bundled local server asset."
            ))
        }

        checks.append(DependencyCheck(
            kind: .neovim,
            status: .externalNotBundled,
            message: "Neovim is not bundled with Fenrir Native; Neovim panes are created by server/tmux workflows when available."
        ))

        return checks
    }

    static func tmuxCheck(minimumVersion: String, checker: any TmuxDependencyChecking) async throws -> DependencyCheck {
        let probe: ToolProbeResult
        do {
            probe = try await checker.probeTmux()
        } catch {
            throw DistributionReadinessError.dependencyProbeFailed(String(describing: error))
        }

        guard let path = probe.executablePath, !path.isEmpty else {
            return DependencyCheck(
                kind: .tmux,
                status: .missing,
                requiredVersion: minimumVersion,
                message: "tmux was not found on PATH."
            )
        }

        guard let version = probe.version, isVersion(version, atLeast: minimumVersion) else {
            return DependencyCheck(
                kind: .tmux,
                status: .unsupportedVersion,
                path: path,
                version: probe.version,
                requiredVersion: minimumVersion,
                message: "tmux \(probe.version ?? "unknown") is older than required \(minimumVersion)."
            )
        }

        return DependencyCheck(
            kind: .tmux,
            status: .available,
            path: path,
            version: version,
            requiredVersion: minimumVersion,
            message: "tmux \(version) is available."
        )
    }

    static func serverAssetCheck(locator: any ServerAssetLocating) async throws -> DependencyCheck {
        let probe: ServerAssetProbeResult
        do {
            probe = try await locator.locateServerAsset()
        } catch {
            throw DistributionReadinessError.serverAssetProbeFailed(String(describing: error))
        }

        guard let path = probe.assetPath, !path.isEmpty else {
            return DependencyCheck(
                kind: .fenrirServerAsset,
                status: .missing,
                message: "Bundled Fenrir server asset was not found in app resources."
            )
        }

        guard probe.isExecutable else {
            return DependencyCheck(
                kind: .fenrirServerAsset,
                status: .missing,
                path: path,
                version: probe.version,
                message: "Bundled Fenrir server asset is present but not executable."
            )
        }

        return DependencyCheck(
            kind: .fenrirServerAsset,
            status: .available,
            path: path,
            version: probe.version,
            message: "Bundled Fenrir server asset is available."
        )
    }

    static func diagnostic(for check: DependencyCheck) -> StartupDiagnostic? {
        switch (check.kind, check.status) {
        case (.tmux, .missing):
            return StartupDiagnostic(
                severity: .error,
                title: "tmux is required for local startup",
                message: check.message,
                recoverySuggestion: "Install tmux 3.2 or newer and ensure it is visible on PATH before starting a local workspace."
            )
        case (.tmux, .unsupportedVersion):
            return StartupDiagnostic(
                severity: .error,
                title: "tmux version is unsupported",
                message: check.message,
                recoverySuggestion: "Upgrade tmux to \(check.requiredVersion ?? "the required version") or newer."
            )
        case (.fenrirServerAsset, .missing):
            return StartupDiagnostic(
                severity: .error,
                title: "Local Fenrir server asset is unavailable",
                message: check.message,
                recoverySuggestion: "Reinstall the native app bundle or use existing local server or remote attach mode."
            )
        case (.neovim, .externalNotBundled):
            return StartupDiagnostic(
                severity: .info,
                title: "Neovim is external",
                message: check.message,
                recoverySuggestion: "Install Neovim separately if workflows should create Neovim panes."
            )
        default:
            return nil
        }
    }

    static func isVersion(_ actual: String, atLeast minimum: String) -> Bool {
        normalizedVersionParts(actual).lexicographicallyPrecedes(normalizedVersionParts(minimum)) == false
    }

    static func normalizedVersionParts(_ version: String) -> [Int] {
        let parts = version
            .split { !$0.isNumber && $0 != "." }
            .flatMap { $0.split(separator: ".") }
            .compactMap { Int($0) }
        return Array((parts + [0, 0, 0]).prefix(3))
    }
}

private extension NativeDistribution.StartupMode {
    var requiresLocalTmux: Bool {
        switch self {
        case .localDefault, .existingLocalServer:
            true
        case .remoteAttach:
            false
        }
    }

    var requiresBundledServerAsset: Bool {
        self == .localDefault
    }
}
