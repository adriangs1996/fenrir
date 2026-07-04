import Foundation
import Testing
import FenrirNativeShared
@testable import AgentIntegration

@Suite("AgentIntegration session resume (D-044)")
struct AgentSessionResumeTests {
    @Test("session id validation accepts the strict allowlist and rejects everything else")
    func sessionIDValidation() {
        #expect(AgentIntegration.isValidAgentSessionID("abc123"))
        #expect(AgentIntegration.isValidAgentSessionID("A-b_c.9"))
        #expect(AgentIntegration.isValidAgentSessionID(String(repeating: "a", count: 128)))
        #expect(AgentIntegration.isValidAgentSessionID("550e8400-e29b-41d4-a716-446655440000"))

        #expect(!AgentIntegration.isValidAgentSessionID(""))
        #expect(!AgentIntegration.isValidAgentSessionID(String(repeating: "a", count: 129)))
        #expect(!AgentIntegration.isValidAgentSessionID("has space"))
        #expect(!AgentIntegration.isValidAgentSessionID("semi;colon"))
        #expect(!AgentIntegration.isValidAgentSessionID("dollar$(rm -rf /)"))
        #expect(!AgentIntegration.isValidAgentSessionID("quote'"))
        #expect(!AgentIntegration.isValidAgentSessionID("back`tick"))
        #expect(!AgentIntegration.isValidAgentSessionID("colon:id"))
        #expect(!AgentIntegration.isValidAgentSessionID("newline\nid"))
        #expect(!AgentIntegration.isValidAgentSessionID("émoji"))
        // Leading non-alphanumerics are argument-injection vectors: a session
        // id starting with `-` would reach the agent CLI as an option token.
        #expect(!AgentIntegration.isValidAgentSessionID("-h"))
        #expect(!AgentIntegration.isValidAgentSessionID("--dangerously-skip-permissions"))
        #expect(!AgentIntegration.isValidAgentSessionID("-leading-dash"))
        #expect(!AgentIntegration.isValidAgentSessionID(".leading-dot"))
        #expect(!AgentIntegration.isValidAgentSessionID("_leading-underscore"))
    }

    @Test("resume descriptors interpolate each adapter's documented resume command")
    func resumeDescriptorInterpolation() {
        #expect(AgentIntegration.resumeCommand(agentID: .claudeCode, sessionID: "sess-1") == "claude --resume sess-1")
        #expect(AgentIntegration.resumeCommand(agentID: .codex, sessionID: "sess-1") == "codex resume sess-1")
        #expect(AgentIntegration.resumeCommand(agentID: .openCode, sessionID: "sess-1") == "opencode --session sess-1")
        #expect(AgentIntegration.resumeCommand(agentID: .cursor, sessionID: "sess-1") == "cursor-agent --resume sess-1")
    }

    @Test("resume command is never built for invalid session ids or adapters without descriptors")
    func resumeCommandRefusesInvalidInput() {
        #expect(AgentIntegration.resumeCommand(agentID: .claudeCode, sessionID: "bad; rm -rf /") == nil)
        #expect(AgentIntegration.resumeCommand(agentID: .claudeCode, sessionID: "") == nil)
        #expect(AgentIntegration.resumeCommand(agentID: .claudeCode, sessionID: "a b") == nil)
        // Option-shaped ids must never become CLI argv tokens.
        #expect(AgentIntegration.resumeCommand(agentID: .claudeCode, sessionID: "--dangerously-skip-permissions") == nil)
        #expect(AgentIntegration.resumeCommand(agentID: .codex, sessionID: "-h") == nil)
        #expect(AgentIntegration.resumeCommand(agentID: .custom, sessionID: "sess-1") == nil)
        #expect(AgentIntegration.resumeCommand(agentID: .future, sessionID: "sess-1") == nil)
    }

    @Test("session-start presence with a session id parses and stores the id")
    func presenceWithSessionIDParses() async throws {
        let store = AgentIntegration.InMemoryAgentPresenceStore()
        let action = AgentIntegration.IngestAgentPresenceSignal(store: store, clock: resumeClock)
        let signal = AgentIntegration.AgentPresenceSignal(
            payload: #"{"namespace":"com.fenrir.agent.presence.v1","agentID":"claudeCode","state":"sessionStarted","sessionID":"claude-sess-42"}"#,
            provenance: resumeProvenance
        )

        let result = try await action.run(.init(requestID: "session-start", signal: signal, source: .terminalViewport)).get()
        let records = try await store.listPresence(workspaceID: "workspace-1")

        #expect(result.stored)
        #expect(result.event?.state == .sessionStarted)
        #expect(result.event?.sessionID == "claude-sess-42")
        #expect(records.map(\.sessionID) == ["claude-sess-42"])
    }

    @Test("presence with an out-of-allowlist session id drops the whole signal")
    func presenceWithInvalidSessionIDDrops() async throws {
        let store = AgentIntegration.InMemoryAgentPresenceStore()
        let events = ResumeEventCollector()
        let action = AgentIntegration.IngestAgentPresenceSignal(store: store, clock: resumeClock, events: events)
        let signal = AgentIntegration.AgentPresenceSignal(
            payload: #"{"namespace":"com.fenrir.agent.presence.v1","agentID":"claudeCode","state":"sessionStarted","sessionID":"bad'; rm -rf /"}"#,
            provenance: resumeProvenance
        )

        let result = try await action.run(.init(requestID: "bad-session", signal: signal, source: .terminalViewport)).get()

        #expect(!result.stored)
        #expect(result.event == nil)
        #expect(try await store.listPresence(workspaceID: nil).isEmpty)
        guard case let .malformedPresenceDropped(reason, _) = await events.events.first?.event else {
            Issue.record("Expected malformedPresenceDropped event")
            return
        }
        #expect(reason == "invalid-session-id")
    }

    @Test("presence store keeps the last session id sticky across later states of the same agent")
    func presenceStoreKeepsSessionIDSticky() async throws {
        let store = AgentIntegration.InMemoryAgentPresenceStore()
        try await store.upsertPresence(presenceEvent(state: .sessionStarted, sessionID: "sess-sticky"))
        try await store.upsertPresence(presenceEvent(state: .busy, sessionID: nil))
        try await store.upsertPresence(presenceEvent(state: .turnCompleted, sessionID: nil))

        let records = try await store.listPresence(workspaceID: "workspace-1")
        let record = try #require(records.first)
        #expect(record.state == .turnCompleted)
        #expect(record.sessionID == "sess-sticky")

        // A different agent taking over the same pane resets resumability.
        try await store.upsertPresence(presenceEvent(agentID: .codex, state: .busy, sessionID: nil))
        let resetRecords = try await store.listPresence(workspaceID: "workspace-1")
        let reset = try #require(resetRecords.first)
        #expect(reset.sessionID == nil)
    }

    @Test("resumable session derivation keeps the latest record per session and marks pane liveness")
    func resumableSessionDerivation() {
        let older = AgentIntegration.AgentPresenceRecord(
            agentID: .claudeCode,
            state: .sessionStarted,
            provenance: resumeProvenance,
            sessionID: "sess-1",
            updatedAt: FenrirTimestamp(Date(timeIntervalSince1970: 100))
        )
        let newer = AgentIntegration.AgentPresenceRecord(
            agentID: .claudeCode,
            state: .turnCompleted,
            provenance: resumeProvenance,
            sessionID: "sess-1",
            updatedAt: FenrirTimestamp(Date(timeIntervalSince1970: 200))
        )
        let livePane = AgentIntegration.AgentPresenceRecord(
            agentID: .codex,
            state: .busy,
            provenance: AgentIntegration.AgentPresenceProvenance(workspaceID: "workspace-1", paneID: "pane-live"),
            sessionID: "sess-2",
            updatedAt: FenrirTimestamp(Date(timeIntervalSince1970: 150))
        )
        let noSession = AgentIntegration.AgentPresenceRecord(
            agentID: .openCode,
            state: .busy,
            provenance: AgentIntegration.AgentPresenceProvenance(workspaceID: "workspace-1", paneID: "pane-3"),
            sessionID: nil,
            updatedAt: FenrirTimestamp(Date(timeIntervalSince1970: 150))
        )
        let noDescriptor = AgentIntegration.AgentPresenceRecord(
            agentID: .custom,
            state: .sessionStarted,
            provenance: AgentIntegration.AgentPresenceProvenance(workspaceID: "workspace-1", paneID: "pane-4"),
            sessionID: "sess-3",
            updatedAt: FenrirTimestamp(Date(timeIntervalSince1970: 150))
        )

        let snapshots = AgentIntegration.resumableAgentSessions(
            records: [older, newer, livePane, noSession, noDescriptor],
            livePaneIDs: ["pane-live"]
        )

        #expect(snapshots.count == 2)
        let claude = snapshots.first { $0.agentID == .claudeCode }
        #expect(claude?.sessionID == "sess-1")
        #expect(claude?.updatedAt == FenrirTimestamp(Date(timeIntervalSince1970: 200)))
        #expect(claude?.paneAlive == false)
        let codex = snapshots.first { $0.agentID == .codex }
        #expect(codex?.paneAlive == true)
    }

    @Test("provider session-start hooks extract session_id from stdin with the allowlist capture")
    func providerSessionStartHooksCarrySessionID() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        let provisioner = AgentIntegration.providerStructuredAgentIntegrationProvisioner(
            configStore: store,
            clock: resumeClock,
            homeDirectoryPath: "/tmp/fenrir-resume-home"
        )

        for agentID in [AgentIntegration.AgentCLIIdentifier.claudeCode, .codex] {
            _ = try await provisioner.installAgentIntegration(AgentIntegration.AgentProvisioningRequest(
                requestID: RequestID(rawValue: "resume-provision-\(agentID.rawValue)"),
                agentID: agentID,
                workspaceID: "workspace-1",
                targetVersion: "1.0.0",
                source: .test
            ))
        }
        let claudeSettings = try #require(await store.content(at: "/tmp/fenrir-resume-home/.claude/settings.json"))
        let codexHooks = try #require(await store.content(at: "/tmp/fenrir-resume-home/.codex/hooks.json"))
        let claudeRoot = try JSONSerialization.jsonObject(with: Data(claudeSettings.utf8)) as? [String: Any]
        let hooks = claudeRoot?["hooks"] as? [String: Any]
        let sessionStartCommands = fenrirHookCommands(hooks?["SessionStart"])
        let busyCommands = fenrirHookCommands(hooks?["UserPromptSubmit"])
        let sessionStartCommand = try #require(sessionStartCommands.first)
        let busyCommand = try #require(busyCommands.first)

        // Session-start: stdin extractor + printf %s interpolation, capture
        // limited to the D-044 allowlist charset.
        #expect(sessionStartCommand.contains("session_id"))
        #expect(sessionStartCommand.contains("[A-Za-z0-9._-]"))
        #expect(sessionStartCommand.contains(#""sessionID":"%s""#))
        #expect(sessionStartCommand.contains("sessionStarted"))
        // Other events never read stdin and never carry a session id.
        #expect(!busyCommand.contains("session_id"))
        #expect(!busyCommand.contains("sessionID"))
        // Codex hook input carries session_id as well.
        #expect(codexHooks.contains("session_id"))
        #expect(codexHooks.contains("sessionID"))
    }

    @Test("opencode plugin emits sessionStarted with a charset-validated session id")
    func openCodePluginCarriesSessionID() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        let provisioner = AgentIntegration.providerStructuredAgentIntegrationProvisioner(
            configStore: store,
            clock: resumeClock,
            homeDirectoryPath: "/tmp/fenrir-resume-home"
        )

        _ = try await provisioner.installAgentIntegration(AgentIntegration.AgentProvisioningRequest(
            requestID: "resume-provision-opencode",
            agentID: .openCode,
            workspaceID: "workspace-1",
            targetVersion: "1.0.0",
            source: .test
        ))
        let plugin = try #require(await store.content(at: "/tmp/fenrir-resume-home/.config/opencode/plugins/fenrir-presence.js"))

        #expect(plugin.contains("session.created"))
        #expect(plugin.contains("sessionStarted"))
        #expect(plugin.contains("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"))
    }

    @Test("managed hook spec documents session-start session id and its allowlist")
    func managedHookSpecDocumentsSessionID() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        let provisioner = AgentIntegration.ManagedAgentIntegrationProvisioner(
            targets: AgentIntegration.defaultManagedAgentInstallTargets(configurationRootPath: "/tmp/fenrir-resume-managed"),
            configStore: store,
            clock: resumeClock
        )

        _ = try await provisioner.installAgentIntegration(AgentIntegration.AgentProvisioningRequest(
            requestID: "resume-managed-claude",
            agentID: .claudeCode,
            workspaceID: "workspace-1",
            targetVersion: "1.0.0",
            source: .test
        ))
        let hooks = try #require(await store.content(at: "/tmp/fenrir-resume-managed/claudeCode/hooks.conf"))

        #expect(hooks.contains("fenrir.agent.presence.session_start.session_id=include-when-available"))
        #expect(hooks.contains("fenrir.agent.presence.session_id.pattern=^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$"))
    }
}

/// Extracts the Fenrir-owned hook command strings from a decoded hook event
/// entry list (both the Claude nested-hooks shape and the flat shape).
private func fenrirHookCommands(_ entries: Any?) -> [String] {
    guard let entries = entries as? [[String: Any]] else {
        return []
    }
    return entries.flatMap { entry -> [String] in
        var commands: [String] = []
        if let command = entry["command"] as? String {
            commands.append(command)
        }
        if let nested = entry["hooks"] as? [[String: Any]] {
            commands.append(contentsOf: nested.compactMap { $0["command"] as? String })
        }
        return commands
    }
    .filter { $0.contains("fenrir-managed-agent-hook:v1") }
}

private let resumeClock = AgentIntegration.FixedAgentIntegrationClock(timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_500)))
private let resumeProvenance = AgentIntegration.AgentPresenceProvenance(workspaceID: "workspace-1", tabID: "tab-1", paneID: "pane-1", viewportID: "viewport-1")

private func presenceEvent(
    agentID: AgentIntegration.AgentCLIIdentifier = .claudeCode,
    state: AgentIntegration.AgentPresenceState,
    sessionID: String?
) -> AgentIntegration.AgentPresenceEvent {
    AgentIntegration.AgentPresenceEvent(
        agentID: agentID,
        state: state,
        provenance: resumeProvenance,
        sessionID: sessionID,
        ingestedAt: resumeClock.now()
    )
}

private actor ResumeEventCollector: AgentIntegration.AgentIntegrationEventSinking {
    private(set) var events: [EventEnvelope<AgentIntegration.Event>] = []

    func emit(_ event: EventEnvelope<AgentIntegration.Event>) async {
        events.append(event)
    }
}
