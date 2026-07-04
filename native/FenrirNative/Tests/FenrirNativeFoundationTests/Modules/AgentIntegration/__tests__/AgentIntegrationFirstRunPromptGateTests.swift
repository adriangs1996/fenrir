import Foundation
import Testing
import FenrirNativeShared
@testable import AgentIntegration

@Suite("AgentIntegration first-run prompt gate")
struct AgentIntegrationFirstRunPromptGateTests {
    @Test("prompts once per degraded-agent fingerprint and again when it changes")
    func promptsOncePerFingerprint() throws {
        let markerFileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("fenrir-first-run-gate-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("agent-integration-first-run.json", isDirectory: false)
        defer { try? FileManager.default.removeItem(at: markerFileURL.deletingLastPathComponent()) }
        let gate = AgentIntegration.AgentIntegrationFirstRunPromptGate(markerFileURL: markerFileURL)

        let degradedCodex = panelState(statuses: [degradedStatus(.codex)])
        #expect(gate.shouldPresentPrompt(for: degradedCodex))

        gate.markPromptPresented(for: degradedCodex)
        #expect(!gate.shouldPresentPrompt(for: degradedCodex))

        let degradedCodexAndClaude = panelState(statuses: [degradedStatus(.codex), degradedStatus(.claudeCode)])
        #expect(gate.shouldPresentPrompt(for: degradedCodexAndClaude))

        gate.markPromptPresented(for: degradedCodexAndClaude)
        #expect(!gate.shouldPresentPrompt(for: degradedCodexAndClaude))
    }

    @Test("never prompts when no agent is degraded")
    func staysQuietWithoutDegradedAgents() {
        let markerFileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("fenrir-first-run-gate-\(UUID().uuidString).json", isDirectory: false)
        let gate = AgentIntegration.AgentIntegrationFirstRunPromptGate(markerFileURL: markerFileURL)

        let healthy = panelState(statuses: [installedStatus(.codex)])
        #expect(!gate.shouldPresentPrompt(for: healthy))
    }
}

private func panelState(statuses: [AgentIntegration.AgentIntegrationStatus]) -> AgentIntegration.AgentIntegrationPanelState {
    AgentIntegration.AgentIntegrationPanelState(
        statuses: statuses,
        timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000))
    )
}

private func degradedStatus(_ id: AgentIntegration.AgentCLIIdentifier) -> AgentIntegration.AgentIntegrationStatus {
    makeStatus(id, state: .notInstalled, detectedExecutablePath: "/usr/local/bin/\(id.rawValue)")
}

private func installedStatus(_ id: AgentIntegration.AgentCLIIdentifier) -> AgentIntegration.AgentIntegrationStatus {
    makeStatus(id, state: .installed, detectedExecutablePath: "/usr/local/bin/\(id.rawValue)")
}

private func makeStatus(
    _ id: AgentIntegration.AgentCLIIdentifier,
    state: AgentIntegration.IntegrationState,
    detectedExecutablePath: String?
) -> AgentIntegration.AgentIntegrationStatus {
    let descriptor = AgentIntegration.supportedAgentDescriptors.first { $0.id == id }!
    return AgentIntegration.AgentIntegrationStatus(
        agent: descriptor,
        state: state,
        installedVersion: state == .installed ? "1.0.0" : nil,
        expectedVersion: "1.0.0",
        ownership: .init(version: "1.0.0", blockID: "\(id.rawValue)-hooks"),
        detectedExecutablePath: detectedExecutablePath
    )
}
