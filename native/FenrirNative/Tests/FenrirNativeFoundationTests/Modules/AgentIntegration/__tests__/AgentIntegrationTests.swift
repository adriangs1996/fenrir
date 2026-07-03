import Foundation
import Testing
import FenrirNativeShared
@testable import AgentIntegration

@Suite("AgentIntegration foundation")
struct AgentIntegrationTests {
    @Test("public contracts expose supported descriptors and atomic actions")
    func publicContractsCompile() async throws {
        #expect(AgentIntegration.supportedAgentDescriptors.map(\.id) == [.claudeCode, .codex, .cursor, .openCode, .custom, .future])
        #expect(AgentIntegration.AgentPresenceSignal.oscIdentifier == 8737)
        #expect(AgentIntegration.AgentPresenceSignal.namespace == "com.fenrir.agent.presence.v1")

        let detector = FakeDetector(statuses: [status(.codex, state: .installed)])
        let action = AgentIntegration.GetAgentIntegrationStatus(detector: detector, clock: fixedClock)
        let result: AgentIntegration.GetAgentIntegrationStatusResult = try await action.run(.init(requestID: "status", agentID: .codex, source: .test)).get()

        #expect(result.requestID == "status")
        #expect(result.status.agent.id == .codex)
        #expect(result.timestamp == fixedClock.now())
        _ = AgentIntegration.PresencePayload(
            namespace: AgentIntegration.AgentPresenceSignal.namespace,
            agentID: .codex,
            state: .sessionStarted,
            workspaceID: "workspace-1",
            paneID: "pane-1",
            sequence: nil,
            timestamp: nil
        )
    }

    @Test("detecting providers through a fake detector returns stable descriptors and status")
    func detectProviders() async throws {
        let statuses = [
            status(.claudeCode, state: .installed),
            status(.codex, state: .outdated, installedVersion: "0.9.0"),
            status(.cursor, state: .notInstalled),
            status(.openCode, state: .installed)
        ]
        let action = AgentIntegration.DetectAgentIntegrations(detector: FakeDetector(statuses: statuses), clock: fixedClock)

        let result = try await action.run(.init(requestID: "detect", source: .test)).get()

        #expect(result.requestID == "detect")
        #expect(result.timestamp == fixedClock.now())
        #expect(result.statuses.map(\.agent.id) == [.claudeCode, .codex, .cursor, .openCode])
        #expect(result.statuses.map(\.state) == [.installed, .outdated, .notInstalled, .installed])
    }

    @Test("path detector reports supported agent CLIs without mutating user config")
    func pathDetectorReportsSupportedAgentCLIs() async throws {
        let detector = AgentIntegration.PathAgentIntegrationDetector(
            pathEnvironment: "/agents/bin:/usr/bin",
            expectedVersion: "2.0.0",
            isExecutableFile: { path in
                path == "/agents/bin/codex" || path == "/agents/bin/claude"
            }
        )

        let statuses = try await detector.detectAgentIntegrations()
        let codex = try #require(statuses.first { $0.agent.id == .codex })
        let claude = try #require(statuses.first { $0.agent.id == .claudeCode })
        let cursor = try #require(statuses.first { $0.agent.id == .cursor })

        #expect(statuses.map { $0.agent.id } == [.claudeCode, .codex, .cursor, .openCode])
        #expect(codex.detectedExecutablePath == "/agents/bin/codex")
        #expect(claude.detectedExecutablePath == "/agents/bin/claude")
        #expect(cursor.detectedExecutablePath == nil)
        #expect(codex.state == .notInstalled)
        #expect(codex.expectedVersion == "2.0.0")
        #expect(codex.ownership == nil)
    }

    @Test("path detector rejects custom and future adapters until explicit installers exist")
    func pathDetectorRejectsUnsupportedAdapters() async {
        let detector = AgentIntegration.PathAgentIntegrationDetector(pathEnvironment: "/agents/bin")

        await #expect(throws: AgentIntegration.AgentIntegrationError.unsupportedAgent(.custom)) {
            _ = try await detector.integrationStatus(for: .custom)
        }
        await #expect(throws: AgentIntegration.AgentIntegrationError.unsupportedAgent(.future)) {
            _ = try await detector.integrationStatus(for: .future)
        }
    }

    @Test("first-run prompt is false when not installed agents have no detected executable")
    func panelStateDoesNotPromptForAbsentAgents() {
        let panelState = AgentIntegration.AgentIntegrationPanelState(
            statuses: [
                status(.claudeCode, state: .notInstalled, installedVersion: nil, detectedExecutablePath: nil),
                status(.codex, state: .notInstalled, installedVersion: nil, detectedExecutablePath: nil)
            ],
            timestamp: fixedClock.now()
        )

        #expect(panelState.degradedStatuses.isEmpty)
        #expect(!panelState.shouldPresentFirstRunPrompt)
        #expect(panelState.summaryText == "2 agents checked, all integrations current")
        #expect(panelState.rowTexts == ["Claude Code: not installed", "Codex: not installed"])
    }

    @Test("first-run prompt is true for detected not installed, outdated, and conflicted agents")
    func panelStatePromptsForDegradedAgents() {
        let panelState = AgentIntegration.AgentIntegrationPanelState(
            statuses: [
                status(.claudeCode, state: .notInstalled, installedVersion: nil, detectedExecutablePath: "/agents/bin/claude"),
                status(.codex, state: .outdated, installedVersion: "0.9.0"),
                status(.cursor, state: .conflicted),
                status(.custom, state: .unsupported, detectedExecutablePath: nil)
            ],
            lastProvisioningResult: AgentIntegration.AgentProvisioningResult(
                requestID: "repair-codex",
                agentID: .codex,
                change: .updated,
                status: status(.codex, state: .installed),
                timestamp: fixedClock.now()
            ),
            lastErrorMessage: "conflict",
            timestamp: fixedClock.now()
        )

        #expect(panelState.degradedStatuses.map(\.agent.id) == [.claudeCode, .codex, .cursor, .custom])
        #expect(panelState.shouldPresentFirstRunPrompt)
        #expect(panelState.summaryText == "4 agents checked, 4 need attention")
        #expect(panelState.rowTexts == [
            "Claude Code: detected at /agents/bin/claude, integration not installed",
            "Codex: outdated 0.9.0 -> 1.0.0",
            "Cursor: conflicted",
            "Custom Agent: unsupported"
        ])
        #expect(panelState.lastProvisioningResult?.change == .updated)
        #expect(panelState.lastErrorMessage == "conflict")
    }

    @Test("view commands preserve request source and kind shape")
    func viewCommandShape() {
        let refresh = AgentIntegration.AgentIntegrationViewCommand(requestID: "refresh", source: .test, kind: .refresh)
        let repair = AgentIntegration.AgentIntegrationViewCommand(requestID: "repair", source: .test, kind: .repair(agentID: .codex))
        let remove = AgentIntegration.AgentIntegrationViewCommand(requestID: "remove", source: .test, kind: .remove(agentID: .claudeCode))

        #expect(refresh == AgentIntegration.AgentIntegrationViewCommand(requestID: "refresh", source: .test, kind: .refresh))
        #expect(refresh.requestID == "refresh")
        #expect(refresh.source == .test)
        #expect(refresh.kind == .refresh)
        #expect(repair.kind == .repair(agentID: .codex))
        #expect(remove.kind == .remove(agentID: .claudeCode))
    }

    @MainActor
    @Test("panel view emits refresh repair remove commands from workspace shell")
    func panelViewCommandSequence() {
        let view = AgentIntegration.AgentIntegrationPanelView(state: AgentIntegration.AgentIntegrationPanelState(
            statuses: [
                status(.codex, state: .outdated, installedVersion: "0.9.0"),
                status(.claudeCode, state: .conflicted)
            ],
            timestamp: fixedClock.now()
        ))
        var commands: [AgentIntegration.AgentIntegrationViewCommand] = []
        view.onCommand = { commands.append($0) }

        view.refresh(requestID: "refresh")
        view.repair(agentID: .codex, requestID: "repair")
        view.remove(agentID: .claudeCode, requestID: "remove")

        #expect(commands == [
            AgentIntegration.AgentIntegrationViewCommand(requestID: "refresh", source: .workspaceShell, kind: .refresh),
            AgentIntegration.AgentIntegrationViewCommand(requestID: "repair", source: .workspaceShell, kind: .repair(agentID: .codex)),
            AgentIntegration.AgentIntegrationViewCommand(requestID: "remove", source: .workspaceShell, kind: .remove(agentID: .claudeCode))
        ])
    }

    @MainActor
    @Test("panel view apply updates visible summary and rows")
    func panelViewApplyUpdatesVisibleText() {
        let initialState = AgentIntegration.AgentIntegrationPanelState(
            statuses: [
                status(.codex, state: .installed)
            ],
            timestamp: fixedClock.now()
        )
        let updatedState = AgentIntegration.AgentIntegrationPanelState(
            statuses: [
                status(.claudeCode, state: .notInstalled, installedVersion: nil, detectedExecutablePath: "/agents/bin/claude"),
                status(.codex, state: .installed)
            ],
            timestamp: fixedClock.now()
        )
        let view = AgentIntegration.AgentIntegrationPanelView(state: initialState)

        #expect(view.visibleSummaryText == "1 agents checked, all integrations current")
        #expect(view.visibleRowTexts == ["Codex: installed 1.0.0"])

        view.apply(updatedState)

        #expect(view.state == updatedState)
        #expect(view.visibleSummaryText == "2 agents checked, 1 need attention")
        #expect(view.visibleRowTexts == [
            "Claude Code: detected at /agents/bin/claude, integration not installed",
            "Codex: installed 1.0.0"
        ])
    }

    @Test("install update remove actions call installer ports and preserve typed result semantics")
    func provisioningActionsCallInstallerPorts() async throws {
        let installer = FakeInstaller()
        let request = AgentIntegration.AgentProvisioningRequest(
            requestID: "provision",
            agentID: .codex,
            workspaceID: "workspace-1",
            targetVersion: "1.0.0",
            source: .test
        )

        let installed = try await AgentIntegration.InstallAgentIntegration(installer: installer).run(request).get()
        let updated = try await AgentIntegration.UpdateAgentIntegration(installer: installer).run(request).get()
        let removed = try await AgentIntegration.RemoveAgentIntegration(installer: installer).run(request).get()

        #expect(await installer.calls == ["install:codex", "update:codex", "remove:codex"])
        #expect(installed.change == .installed)
        #expect(updated.change == .updated)
        #expect(removed.change == .removed)
        #expect(removed.status.state == .notInstalled)
    }

    @Test("managed config install twice is idempotent")
    func managedConfigInstallTwiceIsIdempotent() throws {
        let editor = managedEditor
        let first = try editor.install(into: "user=true\n", managedBody: "fenrir=true")
        let second = try editor.install(into: first.content, managedBody: "fenrir=true")

        #expect(first.changed)
        #expect(!second.changed)
        #expect(first.content == second.content)
    }

    @Test("managed config preserves user content outside markers and removes only Fenrir owned blocks")
    func managedConfigRemoveOnlyOwnedBlock() throws {
        let editor = managedEditor
        let userBefore = "user.before=true\n"
        let userAfter = "# >>> someone-else\nkeep=true\n# <<< someone-else\nuser.after=true\n"
        let installed = try editor.install(into: userBefore + userAfter, managedBody: "fenrir=true")
        let removed = try editor.remove(from: installed.content)

        #expect(removed.changed)
        #expect(removed.content == userBefore + userAfter)
    }

    @Test("valid presence payload ingests into presence store and emits advisory event")
    func validPresenceIngests() async throws {
        let store = AgentIntegration.InMemoryAgentPresenceStore()
        let events = EventCollector()
        let action = AgentIntegration.IngestAgentPresenceSignal(store: store, clock: fixedClock, events: events)

        let result = try await action.run(.init(requestID: "presence", signal: validSignal(), source: .terminalViewport)).get()
        let records = try await AgentIntegration.ListAgentPresence(store: store, clock: fixedClock)
            .run(.init(requestID: "list", workspaceID: "workspace-1", source: .test))
            .get()

        #expect(result.stored)
        #expect(result.event?.agentID == .codex)
        #expect(records.records.map(\.state) == [.busy])
        #expect(await events.events.map(\.eventKind) == ["AgentPresenceIngested"])
        guard case let .presenceIngested(record) = await events.events.first?.event else {
            Issue.record("Expected presenceIngested event")
            return
        }
        #expect(record.provenance.paneID == "pane-1")
    }

    @Test("malformed and unknown presence payload is dropped with diagnostics and no stored presence")
    func malformedPresenceDrops() async throws {
        let store = AgentIntegration.InMemoryAgentPresenceStore()
        let events = EventCollector()
        let action = AgentIntegration.IngestAgentPresenceSignal(store: store, clock: fixedClock, events: events)
        let malformed = AgentIntegration.AgentPresenceSignal(
            payload: #"{"namespace":"com.fenrir.agent.presence.v1","agentID":"codex","state":"busy","workspaceID":"other","paneID":"pane-1"}"#,
            provenance: provenance
        )

        let result = try await action.run(.init(requestID: "bad", signal: malformed, source: .terminalViewport)).get()
        let records = try await AgentIntegration.ListAgentPresence(store: store, clock: fixedClock)
            .run(.init(requestID: "list", source: .test))
            .get()

        #expect(!result.stored)
        #expect(result.event == nil)
        #expect(records.records.isEmpty)
        #expect(await events.events.map(\.eventKind) == ["AgentPresenceMalformedDropped"])
        guard case let .malformedPresenceDropped(reason, droppedProvenance) = await events.events.first?.event else {
            Issue.record("Expected malformedPresenceDropped event")
            return
        }
        #expect(reason == "workspace-mismatch")
        #expect(droppedProvenance == provenance)
        #expect(!String(describing: await events.events).contains("other"))
    }

    @Test("no action has or uses a pane write service or port")
    func noPaneWritePortExists() {
        let publicServicePortNames = [
            "AgentIntegrationDetecting",
            "AgentIntegrationInstalling",
            "AgentMCPProvisioning",
            "AgentPresenceStoring",
            "AgentIntegrationEventSinking",
            "AgentIntegrationPreferences",
            "AgentIntegrationViewCommand",
            "AgentIntegrationPanelState"
        ]

        #expect(!publicServicePortNames.contains { $0.localizedCaseInsensitiveContains("PaneWrite") })
        #expect(!publicServicePortNames.contains { $0.localizedCaseInsensitiveContains("TerminalWriting") })
    }

    @Test("MCP provision action delegates to MCP provisioner")
    func provisionMCPDelegates() async throws {
        let provisioner = FakeMCPProvisioner()
        let request = AgentIntegration.AgentMCPProvisioningRequest(
            requestID: "mcp",
            agentID: .claudeCode,
            workspaceID: "workspace-1",
            servers: [.init(name: "fenrir", command: "fenrir", arguments: ["mcp"])],
            source: .test
        )

        let result = try await AgentIntegration.ProvisionAgentMCP(provisioner: provisioner).run(request).get()

        #expect(result.change == .updated)
        #expect(await provisioner.calls == ["claudeCode:workspace-1:1"])
    }
}

private let fixedClock = AgentIntegration.FixedAgentIntegrationClock(timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000)))
private let provenance = AgentIntegration.AgentPresenceProvenance(workspaceID: "workspace-1", tabID: "tab-1", paneID: "pane-1", viewportID: "viewport-1")
private let managedEditor = AgentIntegration.ManagedConfigBlockEditor(ownership: .init(version: "1.0.0", blockID: "codex-hooks"))

private func status(
    _ id: AgentIntegration.AgentCLIIdentifier,
    state: AgentIntegration.IntegrationState,
    installedVersion: AgentIntegration.IntegrationVersion? = "1.0.0",
    detectedExecutablePath: String? = nil
) -> AgentIntegration.AgentIntegrationStatus {
    let descriptor = AgentIntegration.supportedAgentDescriptors.first { $0.id == id }!
    let defaultDetectedExecutablePath = state == .notInstalled ? nil : "/usr/local/bin/\(descriptor.executableNames.first ?? id.rawValue)"
    return AgentIntegration.AgentIntegrationStatus(
        agent: descriptor,
        state: state,
        installedVersion: installedVersion,
        expectedVersion: "1.0.0",
        ownership: .init(version: "1.0.0", blockID: "\(id.rawValue)-hooks"),
        detectedExecutablePath: detectedExecutablePath ?? defaultDetectedExecutablePath
    )
}

private func validSignal() -> AgentIntegration.AgentPresenceSignal {
    AgentIntegration.AgentPresenceSignal(
        payload: #"{"namespace":"com.fenrir.agent.presence.v1","agentID":"codex","state":"busy","workspaceID":"workspace-1","paneID":"pane-1","sequence":7,"timestamp":"2023-11-14T22:13:20Z"}"#,
        provenance: provenance
    )
}

private struct FakeDetector: AgentIntegration.AgentIntegrationDetecting {
    let statuses: [AgentIntegration.AgentIntegrationStatus]

    func detectAgentIntegrations() async throws -> [AgentIntegration.AgentIntegrationStatus] {
        statuses
    }

    func integrationStatus(for agentID: AgentIntegration.AgentCLIIdentifier) async throws -> AgentIntegration.AgentIntegrationStatus {
        guard let status = statuses.first(where: { $0.agent.id == agentID }) else {
            throw AgentIntegration.AgentIntegrationError.unsupportedAgent(agentID)
        }
        return status
    }
}

private actor FakeInstaller: AgentIntegration.AgentIntegrationInstalling {
    private(set) var calls: [String] = []

    func installAgentIntegration(_ request: AgentIntegration.AgentProvisioningRequest) async throws -> AgentIntegration.AgentProvisioningResult {
        calls.append("install:\(request.agentID.rawValue)")
        return result(request, change: .installed, state: .installed)
    }

    func updateAgentIntegration(_ request: AgentIntegration.AgentProvisioningRequest) async throws -> AgentIntegration.AgentProvisioningResult {
        calls.append("update:\(request.agentID.rawValue)")
        return result(request, change: .updated, state: .installed)
    }

    func removeAgentIntegration(_ request: AgentIntegration.AgentProvisioningRequest) async throws -> AgentIntegration.AgentProvisioningResult {
        calls.append("remove:\(request.agentID.rawValue)")
        return result(request, change: .removed, state: .notInstalled)
    }

    private func result(
        _ request: AgentIntegration.AgentProvisioningRequest,
        change: AgentIntegration.ProvisioningChange,
        state provisionedState: AgentIntegration.IntegrationState
    ) -> AgentIntegration.AgentProvisioningResult {
        AgentIntegration.AgentProvisioningResult(
            requestID: request.requestID,
            agentID: request.agentID,
            change: change,
            status: status(request.agentID, state: provisionedState, installedVersion: provisionedState == .notInstalled ? nil : request.targetVersion),
            timestamp: fixedClock.now()
        )
    }
}

private actor FakeMCPProvisioner: AgentIntegration.AgentMCPProvisioning {
    private(set) var calls: [String] = []

    func provisionAgentMCP(_ request: AgentIntegration.AgentMCPProvisioningRequest) async throws -> AgentIntegration.AgentMCPProvisioningResult {
        calls.append("\(request.agentID.rawValue):\(request.workspaceID.rawValue):\(request.servers.count)")
        return AgentIntegration.AgentMCPProvisioningResult(
            requestID: request.requestID,
            agentID: request.agentID,
            workspaceID: request.workspaceID,
            change: .updated,
            timestamp: fixedClock.now()
        )
    }
}

private actor EventCollector: AgentIntegration.AgentIntegrationEventSinking {
    private(set) var events: [EventEnvelope<AgentIntegration.Event>] = []

    func emit(_ event: EventEnvelope<AgentIntegration.Event>) async {
        events.append(event)
    }
}
