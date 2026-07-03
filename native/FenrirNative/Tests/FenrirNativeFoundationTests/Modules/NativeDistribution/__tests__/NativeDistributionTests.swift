import Foundation
import Testing
import FenrirNativeShared
import NativeDistribution

@Suite("NativeDistribution startup readiness")
struct NativeDistributionTests {
    @Test("DescribeNativeDistributionModule exposes the NativeDistribution target")
    func describeModule() async throws {
        let action = NativeDistribution.DescribeNativeDistributionModule(clock: FixedClock())

        let result = try await action.run(.init(requestID: "distribution", source: .test)).get()

        #expect(result.summary.moduleName == "NativeDistribution")
        #expect(result.requestID == "distribution")
    }

    @Test("Local default startup fails with actionable diagnostics when tmux is missing")
    func localDefaultFailsWhenTmuxMissing() async throws {
        let action = readinessAction(
            tmux: .init(executablePath: nil, version: nil),
            serverAsset: .init(assetPath: "/app/fenrir-server", isExecutable: true)
        )

        let result = try await action.run(.init(requestID: "readiness", mode: .localDefault, source: .test)).get()

        #expect(!result.report.canStart)
        #expect(result.report.checks.first { $0.kind == .tmux }?.status == .missing)
        #expect(result.report.diagnostics.contains { $0.title == "tmux is required for local startup" })
        #expect(result.report.diagnostics.first?.recoverySuggestion.contains("Install tmux") == true)
    }

    @Test("Local default startup fails when tmux version is unsupported")
    func localDefaultFailsWhenTmuxVersionUnsupported() async throws {
        let action = readinessAction(
            tmux: .init(executablePath: "/usr/bin/tmux", version: "2.9"),
            serverAsset: .init(assetPath: "/app/fenrir-server", isExecutable: true)
        )

        let result = try await action.run(.init(
            requestID: "readiness",
            mode: .localDefault,
            minimumTmuxVersion: "3.2",
            source: .test
        )).get()

        let tmux = result.report.checks.first { $0.kind == .tmux }
        #expect(!result.report.canStart)
        #expect(tmux?.status == .unsupportedVersion)
        #expect(tmux?.version == "2.9")
        #expect(result.report.diagnostics.contains { $0.title == "tmux version is unsupported" })
    }

    @Test("Local default startup fails when bundled server asset is missing")
    func localDefaultFailsWhenServerAssetMissing() async throws {
        let action = readinessAction(
            tmux: .init(executablePath: "/opt/homebrew/bin/tmux", version: "3.4"),
            serverAsset: .init(assetPath: nil, isExecutable: false)
        )

        let result = try await action.run(.init(requestID: "readiness", mode: .localDefault, source: .test)).get()

        #expect(!result.report.canStart)
        #expect(result.report.checks.first { $0.kind == .fenrirServerAsset }?.status == .missing)
        #expect(result.report.diagnostics.contains { $0.title == "Local Fenrir server asset is unavailable" })
    }

    @Test("Ghostty runtime absence blocks local default startup by default")
    func ghosttyRuntimeAbsenceBlocksLocalDefaultByDefault() async throws {
        let action = readinessAction(
            tmux: .init(executablePath: "/opt/homebrew/bin/tmux", version: "3.4"),
            serverAsset: .init(assetPath: "/app/fenrir-server", isExecutable: true),
            ghosttyRuntime: .init(isLinked: false)
        )

        let result = try await action.run(.init(requestID: "readiness", mode: .localDefault, source: .test)).get()

        #expect(!result.report.canStart)
        #expect(result.report.checks.first { $0.kind == .ghosttyTerminalRuntime }?.status == .missing)
        #expect(result.report.diagnostics.contains { $0.title == "Ghostty terminal runtime is unavailable" && $0.severity == .error })
    }

    @Test("Ghostty runtime absence is warning-only when bootstrap fallback is explicit")
    func ghosttyRuntimeAbsenceAllowsExplicitBootstrapFallback() async throws {
        let action = readinessAction(
            tmux: .init(executablePath: "/opt/homebrew/bin/tmux", version: "3.4"),
            serverAsset: .init(assetPath: "/app/fenrir-server", isExecutable: true),
            ghosttyRuntime: .init(isLinked: false)
        )

        let result = try await action.run(.init(
            requestID: "readiness",
            mode: .localDefault,
            allowBootstrapRendererFallback: true,
            source: .test
        )).get()

        #expect(result.report.canStart)
        #expect(result.report.checks.first { $0.kind == .ghosttyTerminalRuntime }?.status == .fallbackAvailable)
        #expect(result.report.diagnostics.contains { $0.title == "Ghostty terminal fallback is active" && $0.severity == .warning })
    }

    @Test("Ghostty runtime availability is reported by readiness")
    func ghosttyRuntimeAvailabilityIsReported() async throws {
        let action = readinessAction(
            tmux: .init(executablePath: "/opt/homebrew/bin/tmux", version: "3.4"),
            serverAsset: .init(assetPath: "/app/fenrir-server", isExecutable: true),
            ghosttyRuntime: .init(isLinked: true, version: "libghostty-spm-1.2.8")
        )

        let result = try await action.run(.init(requestID: "readiness", mode: .localDefault, source: .test)).get()

        let renderer = result.report.checks.first { $0.kind == .ghosttyTerminalRuntime }
        #expect(result.report.canStart)
        #expect(renderer?.status == .available)
        #expect(renderer?.path == "GhosttyTerminal/libghostty")
        #expect(renderer?.version == "libghostty-spm-1.2.8")
    }

    @Test("Existing local server mode does not require bundled server asset")
    func existingLocalServerDoesNotRequireBundledServerAsset() async throws {
        let action = readinessAction(
            tmux: .init(executablePath: "/opt/homebrew/bin/tmux", version: "3.4"),
            serverAsset: .init(assetPath: nil, isExecutable: false)
        )

        let result = try await action.run(.init(requestID: "readiness", mode: .existingLocalServer, source: .test)).get()

        #expect(result.report.canStart)
        #expect(result.report.checks.first { $0.kind == .fenrirServerAsset }?.status == .notRequired)
        #expect(result.report.checks.first { $0.kind == .neovim }?.status == .externalNotBundled)
    }

    @Test("Remote attach mode does not require local tmux or server asset")
    func remoteAttachDoesNotRequireLocalAssets() async throws {
        let tmux = RecordingTmuxChecker(result: .init(executablePath: nil, version: nil))
        let serverAsset = RecordingServerAssetLocator(result: .init(assetPath: nil, isExecutable: false))
        let action = NativeDistribution.AssessStartupReadiness(
            clock: FixedClock(),
            tmuxChecker: tmux,
            serverAssetLocator: serverAsset,
            ghosttyRuntimeChecker: RecordingGhosttyTerminalRuntimeChecker(result: availableGhosttyRuntime)
        )

        let result = try await action.run(.init(requestID: "readiness", mode: .remoteAttach, source: .test)).get()

        #expect(result.report.canStart)
        #expect(result.report.checks.first { $0.kind == .tmux }?.status == .notRequired)
        #expect(result.report.checks.first { $0.kind == .fenrirServerAsset }?.status == .notRequired)
        #expect(await tmux.probeCount == 0)
        #expect(await serverAsset.probeCount == 0)
    }

    private func readinessAction(
        tmux: NativeDistribution.ToolProbeResult,
        serverAsset: NativeDistribution.ServerAssetProbeResult,
        ghosttyRuntime: NativeDistribution.GhosttyTerminalRuntimeProbeResult = availableGhosttyRuntime
    ) -> NativeDistribution.AssessStartupReadiness {
        NativeDistribution.AssessStartupReadiness(
            clock: FixedClock(),
            tmuxChecker: RecordingTmuxChecker(result: tmux),
            serverAssetLocator: RecordingServerAssetLocator(result: serverAsset),
            ghosttyRuntimeChecker: RecordingGhosttyTerminalRuntimeChecker(result: ghosttyRuntime)
        )
    }
}

private let availableGhosttyRuntime = NativeDistribution.GhosttyTerminalRuntimeProbeResult(
    isLinked: true,
    version: "libghostty-spm-1.2.8"
)

private actor RecordingTmuxChecker: NativeDistribution.TmuxDependencyChecking {
    private let result: NativeDistribution.ToolProbeResult
    private(set) var probeCount = 0

    init(result: NativeDistribution.ToolProbeResult) {
        self.result = result
    }

    func probeTmux() async throws -> NativeDistribution.ToolProbeResult {
        probeCount += 1
        return result
    }
}

private actor RecordingGhosttyTerminalRuntimeChecker: NativeDistribution.GhosttyTerminalRuntimeChecking {
    private let result: NativeDistribution.GhosttyTerminalRuntimeProbeResult
    private(set) var probeCount = 0

    init(result: NativeDistribution.GhosttyTerminalRuntimeProbeResult) {
        self.result = result
    }

    func probeGhosttyTerminalRuntime() async throws -> NativeDistribution.GhosttyTerminalRuntimeProbeResult {
        probeCount += 1
        return result
    }
}

private actor RecordingServerAssetLocator: NativeDistribution.ServerAssetLocating {
    private let result: NativeDistribution.ServerAssetProbeResult
    private(set) var probeCount = 0

    init(result: NativeDistribution.ServerAssetProbeResult) {
        self.result = result
    }

    func locateServerAsset() async throws -> NativeDistribution.ServerAssetProbeResult {
        probeCount += 1
        return result
    }
}
