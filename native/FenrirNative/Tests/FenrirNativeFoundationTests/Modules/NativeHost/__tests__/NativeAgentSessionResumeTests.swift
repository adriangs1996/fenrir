import AgentIntegration
import FenrirNativeShared
import Foundation
import NativeRuntime
import Testing
@testable import FenrirNativeApp

// D-044 shell wiring: the resume action must create a NEW tmux pane through
// the agent pane-create port running the validated descriptor command, and
// the session-start metadata attacher must persist {agentID, sessionID}
// through the pane-metadata port. Both are exercised against fake runtimes.
@Suite("Native agent session resume (D-044)")
struct NativeAgentSessionResumeTests {
    @Test("resume action creates an agent pane running the validated resume command")
    func resumeCreatesAgentPaneViaFakeRuntime() async throws {
        let runtime = FakeAgentPaneRuntime()
        let resumer = NativeServerAgentSessionResumer(
            actor: NativeRuntime.RuntimeActorIdentity(profileID: "local", authSessionID: "auth-user-a", subject: "user-a"),
            paneRuntime: runtime
        )

        let paneID = try await resumer.resumeAgentSession(NativeAgentResumeRequest(
            workspaceID: "workspace-1",
            windowID: "window-1",
            workingDirectory: "/repo",
            agentID: .claudeCode,
            sessionID: "sess-42"
        ))
        let input = try #require(await runtime.createInputs.first)

        #expect(paneID == "pane-agent")
        #expect(input.workspaceID == "workspace-1")
        #expect(input.windowID == "window-1")
        #expect(input.workingDirectory == "/repo")
        #expect(input.agent.command == "claude --resume sess-42")
        #expect(input.agent.providerID == "claudeCode")
        #expect(input.agent.title == "Claude Code")
        #expect(input.agent.instanceID.hasPrefix("agent-resume-"))
        #expect(input.agent.labels == ["fenrir.agent.resumedSessionID": "sess-42"])
    }

    @Test("resume action refuses invalid session ids before any pane create RPC")
    func resumeRefusesInvalidSessionID() async throws {
        let runtime = FakeAgentPaneRuntime()
        let resumer = NativeServerAgentSessionResumer(
            actor: NativeRuntime.RuntimeActorIdentity(profileID: "local", authSessionID: "auth-user-a", subject: "user-a"),
            paneRuntime: runtime
        )

        await #expect(throws: NativeRuntime.NativeRuntimeError.paneCreateFailed) {
            _ = try await resumer.resumeAgentSession(NativeAgentResumeRequest(
                workspaceID: "workspace-1",
                windowID: "window-1",
                workingDirectory: nil,
                agentID: .claudeCode,
                sessionID: "bad; rm -rf /"
            ))
        }
        // Adapters without a resume descriptor simply refuse (dead pane only).
        await #expect(throws: NativeRuntime.NativeRuntimeError.paneCreateFailed) {
            _ = try await resumer.resumeAgentSession(NativeAgentResumeRequest(
                workspaceID: "workspace-1",
                windowID: "window-1",
                workingDirectory: nil,
                agentID: .custom,
                sessionID: "sess-42"
            ))
        }
        #expect(await runtime.createInputs.isEmpty)
    }

    @Test("distinct resumes mint unique agent pane instance markers")
    func resumesMintUniqueInstanceIDs() async throws {
        let runtime = FakeAgentPaneRuntime()
        let resumer = NativeServerAgentSessionResumer(
            actor: NativeRuntime.RuntimeActorIdentity(profileID: "local", authSessionID: "auth-user-a", subject: "user-a"),
            paneRuntime: runtime
        )
        let request = NativeAgentResumeRequest(
            workspaceID: "workspace-1",
            windowID: "window-1",
            workingDirectory: nil,
            agentID: .codex,
            sessionID: "sess-7"
        )

        _ = try await resumer.resumeAgentSession(request)
        _ = try await resumer.resumeAgentSession(request)
        let instanceIDs = await runtime.createInputs.map(\.agent.instanceID)

        #expect(instanceIDs.count == 2)
        #expect(Set(instanceIDs).count == 2)
        #expect(await runtime.createInputs.allSatisfy { $0.agent.command == "codex resume sess-7" })
    }

    @Test("session-start metadata attacher persists agentID and sessionID through the pane metadata port")
    func metadataAttacherPersistsSession() async throws {
        let runtime = FakeAgentPaneRuntime()
        let attacher = NativeServerAgentPaneMetadataAttacher(
            actor: NativeRuntime.RuntimeActorIdentity(profileID: "local", authSessionID: "auth-user-a", subject: "user-a"),
            paneRuntime: runtime
        )

        try await attacher.attachResumableSessionMetadata(
            workspaceID: "workspace-1",
            paneID: "pane-1",
            agentID: .claudeCode,
            sessionID: "sess-42"
        )
        let input = try #require(await runtime.attachInputs.first)

        #expect(input.workspaceID == "workspace-1")
        #expect(input.paneID == "pane-1")
        #expect(input.agentID == "claudeCode")
        #expect(input.sessionID == "sess-42")
        #expect(input.title == "Claude Code")
        #expect(input.labels == ["fenrir.agent.sessionID": "sess-42"])
    }

    @Test("metadata attacher refuses session ids outside the allowlist")
    func metadataAttacherRefusesInvalidSessionID() async throws {
        let runtime = FakeAgentPaneRuntime()
        let attacher = NativeServerAgentPaneMetadataAttacher(
            actor: NativeRuntime.RuntimeActorIdentity(profileID: "local", authSessionID: "auth-user-a", subject: "user-a"),
            paneRuntime: runtime
        )

        await #expect(throws: NativeRuntime.NativeRuntimeError.paneMetadataAttachFailed) {
            try await attacher.attachResumableSessionMetadata(
                workspaceID: "workspace-1",
                paneID: "pane-1",
                agentID: .claudeCode,
                sessionID: "bad session"
            )
        }
        #expect(await runtime.attachInputs.isEmpty)
    }
}

private actor FakeAgentPaneRuntime: NativeRuntime.AgentPaneRuntimeCreating, NativeRuntime.PaneAgentMetadataAttaching {
    private(set) var createInputs: [NativeRuntime.CreateAgentPaneRuntimeInput] = []
    private(set) var attachInputs: [NativeRuntime.AttachAgentPaneMetadataInput] = []

    func createAgentPaneRuntime(_ input: NativeRuntime.CreateAgentPaneRuntimeInput) async throws -> NativeRuntime.PaneRuntimeState {
        createInputs.append(input)
        return NativeRuntime.PaneRuntimeState(
            workspaceID: input.workspaceID,
            paneID: "pane-agent",
            status: .attached,
            windowID: input.windowID,
            tmuxPaneID: "%12",
            stream: NativeRuntime.PaneStreamState(paneID: "pane-agent", status: .live),
            metadata: NativeRuntime.PaneRuntimeMetadata(
                kind: "agent",
                title: input.agent.title,
                agent: NativeRuntime.AgentPaneRuntimeMetadata(
                    providerID: input.agent.providerID,
                    providerInstanceID: input.agent.instanceID
                )
            )
        )
    }

    func attachAgentPaneMetadata(_ input: NativeRuntime.AttachAgentPaneMetadataInput) async throws -> NativeRuntime.PaneRuntimeState {
        attachInputs.append(input)
        return NativeRuntime.PaneRuntimeState(
            workspaceID: input.workspaceID,
            paneID: input.paneID,
            status: .attached,
            stream: NativeRuntime.PaneStreamState(paneID: input.paneID, status: .live),
            metadata: NativeRuntime.PaneRuntimeMetadata(
                kind: "agent",
                title: input.title,
                agent: NativeRuntime.AgentPaneRuntimeMetadata(
                    providerID: input.agentID,
                    providerInstanceID: input.sessionID
                )
            )
        )
    }
}
