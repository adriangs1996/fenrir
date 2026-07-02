import Foundation
import Testing
import FenrirNativeShared
@testable import NativeRuntime

@Suite("NativeRuntime actions")
struct NativeRuntimeTests {
    @Test("DiscoverRuntimeCapabilities requires tmux kernel APIs")
    func discoverRequiresTmuxKernelCapabilities() async {
        let action = NativeRuntime.DiscoverRuntimeCapabilities(
            capabilityQuery: CapabilityQuery(capabilities: NativeRuntime.RuntimeCapabilities(
                tmuxKernel: false,
                paneStreams: true,
                writeAcknowledgements: true
            )),
            store: RuntimeStore(),
            clock: FixedClock()
        )

        let result = await action.run(NativeRuntime.DiscoverRuntimeCapabilitiesInput(requestID: "cap", source: .test))

        #expect(result == .failure(.capabilitiesUnavailable))
    }

    @Test("AttachWorkspaceRuntime persists typed workspace state")
    func attachWorkspacePersistsState() async throws {
        let store = RuntimeStore()
        let action = NativeRuntime.AttachWorkspaceRuntime(
            attacher: WorkspaceAttacher(),
            store: store,
            clock: FixedClock()
        )

        let result = try await action.run(
            NativeRuntime.AttachWorkspaceRuntimeInput(
                requestID: "workspace",
                workspaceID: "workspace-1",
                actor: actorIdentity(),
                source: .test
            )
        ).get()

        #expect(result.workspace.workspaceID == "workspace-1")
        #expect(result.workspace.status == .attached)
        #expect(result.workspace.tmuxSessionID == "tmux-session-workspace-1")
        #expect(try await store.loadWorkspace(workspaceID: "workspace-1")?.status == .attached)
    }

    @Test("AttachWorkspaceRuntime is idempotent within the same actor scope")
    func attachWorkspaceIsIdempotentForSameActor() async throws {
        let actor = actorIdentity("user-a")
        let store = RuntimeStore()
        let attacher = WorkspaceAttacher()
        let action = NativeRuntime.AttachWorkspaceRuntime(attacher: attacher, store: store, clock: FixedClock())
        let input = NativeRuntime.AttachWorkspaceRuntimeInput(
            requestID: "workspace",
            workspaceID: "workspace-1",
            actor: actor,
            source: .test
        )

        let first = try await action.run(input).get()
        let second = try await action.run(input).get()

        #expect(first.workspace == second.workspace)
        #expect(await attacher.attachCount() == 1)
    }

    @Test("AttachWorkspaceRuntime rejects a different actor for an attached tmux session")
    func attachWorkspaceRejectsDifferentActorScope() async throws {
        let store = RuntimeStore()
        try await store.saveWorkspace(workspaceState(actor: actorIdentity("user-a")))
        let action = NativeRuntime.AttachWorkspaceRuntime(
            attacher: WorkspaceAttacher(),
            store: store,
            clock: FixedClock()
        )

        let result = await action.run(
            NativeRuntime.AttachWorkspaceRuntimeInput(
                requestID: "workspace",
                workspaceID: "workspace-1",
                actor: actorIdentity("user-b"),
                source: .test
            )
        )

        #expect(result == .failure(.actorScopeMismatch))
    }

    @Test("DetachWorkspaceRuntime rejects a different actor for an attached tmux session")
    func detachWorkspaceRejectsDifferentActorScope() async throws {
        let store = RuntimeStore()
        try await store.saveWorkspace(workspaceState(actor: actorIdentity("user-a")))
        let result = await NativeRuntime.DetachWorkspaceRuntime(
            detacher: WorkspaceDetacher(),
            store: store,
            clock: FixedClock()
        ).run(
            NativeRuntime.DetachWorkspaceRuntimeInput(
                requestID: "detach",
                workspaceID: "workspace-1",
                actor: actorIdentity("user-b"),
                source: .test
            )
        )

        #expect(result == .failure(.actorScopeMismatch))
        #expect(try await store.loadWorkspace(workspaceID: "workspace-1") != nil)
    }

    @Test("Open, switch, focus, enumerate, and close preserve actor-scoped tmux layout")
    func workspaceLifecycleActionsPreserveActorScopedLayout() async throws {
        let actor = actorIdentity("user-a")
        let store = RuntimeStore()
        let opener = WorkspaceOpener()
        let opened = try await NativeRuntime.OpenWorkspaceRuntime(
            opener: opener,
            store: store,
            clock: FixedClock()
        ).run(
            NativeRuntime.OpenWorkspaceRuntimeInput(requestID: "open", workspaceID: "workspace-1", actor: actor, source: .test)
        ).get()

        let switched = try await NativeRuntime.SwitchWorkspaceRuntime(
            switcher: WorkspaceSwitcher(),
            store: store,
            clock: FixedClock()
        ).run(
            NativeRuntime.SwitchWorkspaceRuntimeInput(requestID: "switch", workspaceID: "workspace-1", actor: actor, source: .test)
        ).get()

        let enumerated = try await NativeRuntime.EnumerateWorkspaceRuntime(
            enumerator: WorkspaceEnumerator(actor: actor),
            store: store,
            clock: FixedClock()
        ).run(
            NativeRuntime.EnumerateWorkspaceRuntimeInput(requestID: "enumerate", workspaceID: "workspace-1", actor: actor, source: .test)
        ).get()

        let focused = try await NativeRuntime.FocusPaneRuntime(
            focuser: PaneFocuser(),
            store: store,
            clock: FixedClock()
        ).run(
            NativeRuntime.FocusPaneRuntimeInput(requestID: "focus", workspaceID: "workspace-1", windowID: "window-1", paneID: "pane-2", actor: actor, source: .test)
        ).get()

        _ = try await NativeRuntime.CloseWorkspaceRuntime(
            closer: WorkspaceCloser(),
            store: store,
            clock: FixedClock()
        ).run(
            NativeRuntime.CloseWorkspaceRuntimeInput(requestID: "close", workspaceID: "workspace-1", actor: actor, source: .test)
        ).get()

        #expect(opened.workspace.actor == actor)
        #expect(opened.workspace.tmuxSessionID == "tmux-session-workspace-1")
        #expect(switched.workspace.activeWindowID == "window-1")
        #expect(enumerated.windows.map(\.windowID) == ["window-1"])
        #expect(enumerated.panes.map(\.tmuxPaneID) == ["%1", "%2"])
        #expect(focused.workspace.windows.first?.activePaneID == "pane-2")
        #expect(try await store.loadWorkspace(workspaceID: "workspace-1") == nil)
        #expect(await opener.openCount() == 1)
    }

    @Test("EnumerateWorkspaceRuntime rejects orphaned tmux panes")
    func enumerateRejectsOrphanedTmuxPanes() async {
        let actor = actorIdentity("user-a")
        let action = NativeRuntime.EnumerateWorkspaceRuntime(
            enumerator: WorkspaceEnumerator(actor: actor, panes: [
                paneState(lastObservedSeq: nil, paneID: "orphan", windowID: "window-missing", tmuxPaneID: "%99")
            ]),
            store: RuntimeStore(),
            clock: FixedClock()
        )

        let result = await action.run(
            NativeRuntime.EnumerateWorkspaceRuntimeInput(requestID: "enumerate", workspaceID: "workspace-1", actor: actor, source: .test)
        )

        #expect(result == .failure(.orphanedTmuxResource))
    }

    @Test("DetachWorkspaceRuntime clears local runtime state only")
    func detachWorkspaceClearsLocalState() async throws {
        let store = RuntimeStore()
        try await store.saveWorkspace(workspaceState(actor: actorIdentity()))
        let action = NativeRuntime.DetachWorkspaceRuntime(
            detacher: WorkspaceDetacher(),
            store: store,
            clock: FixedClock()
        )

        _ = try await action.run(
            NativeRuntime.DetachWorkspaceRuntimeInput(
                requestID: "detach",
                workspaceID: "workspace-1",
                actor: actorIdentity(),
                source: .test
            )
        ).get()

        #expect(try await store.loadWorkspace(workspaceID: "workspace-1") == nil)
    }

    @Test("AttachPaneRuntime uses latest backfill when no cursor exists")
    func attachPaneUsesLatestBackfillWithoutCursor() async throws {
        let store = RuntimeStore()
        try await store.saveWorkspace(workspaceState(actor: actorIdentity()))
        let attacher = PaneAttacher()
        let action = NativeRuntime.AttachPaneRuntime(
            attacher: attacher,
            store: store,
            clock: FixedClock()
        )

        let result = try await action.run(attachPaneInput()).get()

        #expect(result.backfill == .latest)
        #expect(await attacher.lastBackfill() == .latest)
        #expect(result.pane.stream.status == .live)
        #expect(try await store.loadPane(paneID: "pane-1")?.paneID == "pane-1")
    }

    @Test("AttachPaneRuntime rejects panes outside the actor-owned tmux layout")
    func attachPaneRejectsOrphanedPaneOutsideWorkspaceLayout() async throws {
        let store = RuntimeStore()
        try await store.saveWorkspace(workspaceState(actor: actorIdentity()))
        let result = await NativeRuntime.AttachPaneRuntime(
            attacher: PaneAttacher(),
            store: store,
            clock: FixedClock()
        ).run(
            NativeRuntime.AttachPaneRuntimeInput(
                requestID: "attach-orphan",
                workspaceID: "workspace-1",
                windowID: "window-1",
                paneID: "orphan-pane",
                streamID: "stream-1",
                actor: actorIdentity(),
                source: .test
            )
        )

        #expect(result == .failure(.orphanedTmuxResource))
        #expect(try await store.loadPane(paneID: "orphan-pane") == nil)
    }

    @Test("ReconnectPaneStream uses cursor backfill and applies output gap overflow states")
    func reconnectPaneStreamAppliesEnvelopes() async throws {
        let store = RuntimeStore()
        try await store.saveWorkspace(workspaceState(actor: actorIdentity()))
        try await store.savePane(paneState(lastObservedSeq: 41))
        let subscriber = PaneSubscriber(envelopes: [
            NativeRuntime.PaneStreamEnvelope(
                paneID: "pane-1",
                streamID: "stream-1",
                kind: .output,
                sequence: 42,
                bytes: Data("ok".utf8)
            ),
            NativeRuntime.PaneStreamEnvelope(
                paneID: "pane-1",
                streamID: "stream-1",
                kind: .gap,
                lowReplaySeq: 10,
                highReplaySeq: 20
            ),
            NativeRuntime.PaneStreamEnvelope(
                paneID: "pane-1",
                streamID: "stream-1",
                kind: .overflow
            )
        ])
        let action = NativeRuntime.ReconnectPaneStream(
            subscriber: subscriber,
            store: store,
            clock: FixedClock()
        )

        let result = try await action.run(
            NativeRuntime.ReconnectPaneStreamInput(
                requestID: "reconnect-pane",
                workspaceID: "workspace-1",
                paneID: "pane-1",
                actor: actorIdentity(),
                source: .test
            )
        ).get()

        #expect(result.backfill == .fromSeq(41))
        #expect(await subscriber.lastBackfill() == .fromSeq(41))
        #expect(result.stream.lastObservedSeq == 42)
        #expect(result.stream.status == .overflow)
        #expect(result.stream.overflowCount == 1)
        #expect(try await store.loadPane(paneID: "pane-1")?.stream.status == .overflow)
    }

    @Test("ReconnectPaneStream rejects malformed stream envelopes")
    func reconnectPaneStreamRejectsMalformedEnvelope() async throws {
        let store = RuntimeStore()
        try await store.saveWorkspace(workspaceState(actor: actorIdentity()))
        try await store.savePane(paneState(lastObservedSeq: 1))
        let action = NativeRuntime.ReconnectPaneStream(
            subscriber: PaneSubscriber(envelopes: [
                NativeRuntime.PaneStreamEnvelope(
                    paneID: "different-pane",
                    streamID: "stream-1",
                    kind: .output,
                    sequence: 2,
                    bytes: Data("bad".utf8)
                )
            ]),
            store: store,
            clock: FixedClock()
        )

        let result = await action.run(
            NativeRuntime.ReconnectPaneStreamInput(
                requestID: "reconnect-pane",
                workspaceID: "workspace-1",
                paneID: "pane-1",
                actor: actorIdentity(),
                source: .test
            )
        )

        #expect(result == .failure(.malformedStreamEnvelope))
    }

    @Test("ReconnectPaneStream rejects invalid gap bounds and extraneous closed fields")
    func reconnectPaneStreamRejectsInvalidEnvelopeShapes() async throws {
        let invalidGap = NativeRuntime.PaneStreamEnvelope(
            paneID: "pane-1",
            streamID: "stream-1",
            kind: .gap,
            lowReplaySeq: 20,
            highReplaySeq: 10
        )
        let invalidClosed = NativeRuntime.PaneStreamEnvelope(
            paneID: "pane-1",
            streamID: "stream-1",
            kind: .closed,
            sequence: 43
        )

        for envelope in [invalidGap, invalidClosed] {
            let store = RuntimeStore()
            try await store.saveWorkspace(workspaceState(actor: actorIdentity()))
            try await store.savePane(paneState(lastObservedSeq: 1))
            let action = NativeRuntime.ReconnectPaneStream(
                subscriber: PaneSubscriber(envelopes: [envelope]),
                store: store,
                clock: FixedClock()
            )

            let result = await action.run(
                NativeRuntime.ReconnectPaneStreamInput(
                    requestID: "reconnect-pane",
                    workspaceID: "workspace-1",
                    paneID: "pane-1",
                    actor: actorIdentity(),
                    source: .test
                )
            )

            #expect(result == .failure(.malformedStreamEnvelope))
        }
    }

    @Test("SendPaneInput returns stable write acknowledgement request id")
    func sendPaneInputKeepsRequestID() async throws {
        let store = RuntimeStore()
        try await store.saveWorkspace(workspaceState(actor: actorIdentity()))
        try await store.savePane(paneState(lastObservedSeq: 1))
        let writer = PaneWriter()
        let action = NativeRuntime.SendPaneInput(writer: writer, store: store, clock: FixedClock())

        let result = try await action.run(sendInput()).get()

        #expect(result.requestID == "write-1")
        #expect(result.acknowledgement.requestID == "write-1")
        #expect(result.acknowledgement.status == .accepted)
        #expect(result.acknowledgement.inputSeq == 42)
    }

    @Test("SendPaneInput rejects actor mismatches before writing")
    func sendPaneInputRejectsActorMismatch() async throws {
        let store = RuntimeStore()
        try await store.saveWorkspace(workspaceState(actor: actorIdentity("user-a")))
        try await store.savePane(paneState(lastObservedSeq: 1))

        let result = await NativeRuntime.SendPaneInput(
            writer: PaneWriter(),
            store: store,
            clock: FixedClock()
        ).run(
            NativeRuntime.SendPaneInputInput(
                requestID: "write-actor-mismatch",
                workspaceID: "workspace-1",
                paneID: "pane-1",
                actor: actorIdentity("user-b"),
                inputBytes: Data("ls\n".utf8),
                source: .terminalViewport
            )
        )

        #expect(result == .failure(.actorScopeMismatch))
    }

    @Test("SendPaneInput rejects accepted acknowledgements missing input sequence")
    func sendPaneInputRejectsAcceptedAckWithoutInputSeq() async {
        let store = RuntimeStore()
        try? await store.saveWorkspace(workspaceState(actor: actorIdentity()))
        try? await store.savePane(paneState(lastObservedSeq: 1))
        let action = NativeRuntime.SendPaneInput(
            writer: PaneWriter(acknowledgement: .accepted(inputSeq: nil)),
            store: store,
            clock: FixedClock()
        )

        let result = await action.run(sendInput())

        #expect(result == .failure(.malformedWriteAcknowledgement))
    }

    @Test("SendPaneInput maps rejected acknowledgements to write rejected")
    func sendPaneInputMapsRejectedAck() async {
        let store = RuntimeStore()
        try? await store.saveWorkspace(workspaceState(actor: actorIdentity()))
        try? await store.savePane(paneState(lastObservedSeq: 1))
        let action = NativeRuntime.SendPaneInput(
            writer: PaneWriter(acknowledgement: .rejected(code: .permissionDenied)),
            store: store,
            clock: FixedClock()
        )

        let result = await action.run(sendInput())

        #expect(result == .failure(.paneWriteRejected))
    }

    @Test("SendPaneInput rejects rejected acknowledgements missing rejection code")
    func sendPaneInputRejectsRejectedAckWithoutCode() async {
        let store = RuntimeStore()
        try? await store.saveWorkspace(workspaceState(actor: actorIdentity()))
        try? await store.savePane(paneState(lastObservedSeq: 1))
        let action = NativeRuntime.SendPaneInput(
            writer: PaneWriter(acknowledgement: .rejected(code: nil)),
            store: store,
            clock: FixedClock()
        )

        let result = await action.run(sendInput())

        #expect(result == .failure(.malformedWriteAcknowledgement))
    }

    @Test("ResizePaneRuntime maps rejected resize acknowledgements")
    func resizePaneMapsRejectedAck() async throws {
        let store = RuntimeStore()
        try await store.saveCapabilities(runtimeCapabilities())
        try await store.saveWorkspace(workspaceState(actor: actorIdentity()))
        try await store.savePane(paneState(lastObservedSeq: 1))
        let action = NativeRuntime.ResizePaneRuntime(
            resizer: PaneResizer(ack: .rejected),
            store: store,
            clock: FixedClock()
        )

        let result = await action.run(resizeInput())

        #expect(result == .failure(.paneResizeRejected))
    }

    @Test("ResizePaneRuntime rejects malformed accepted resize acknowledgements")
    func resizePaneRejectsMalformedAcceptedAck() async {
        let wrongStore = RuntimeStore()
        try? await wrongStore.saveCapabilities(runtimeCapabilities())
        try? await wrongStore.saveWorkspace(workspaceState(actor: actorIdentity()))
        try? await wrongStore.savePane(paneState(lastObservedSeq: 1))
        let wrongSize = await NativeRuntime.ResizePaneRuntime(
            resizer: PaneResizer(ack: .acceptedWrongSize(NativeRuntime.PaneSize(columns: 10, rows: 10))),
            store: wrongStore,
            clock: FixedClock()
        ).run(resizeInput())

        let missingStore = RuntimeStore()
        try? await missingStore.saveCapabilities(runtimeCapabilities())
        try? await missingStore.saveWorkspace(workspaceState(actor: actorIdentity()))
        try? await missingStore.savePane(paneState(lastObservedSeq: 1))
        let missingSize = await NativeRuntime.ResizePaneRuntime(
            resizer: PaneResizer(ack: .acceptedMissingSize),
            store: missingStore,
            clock: FixedClock()
        ).run(resizeInput())

        let mismatchedStore = RuntimeStore()
        try? await mismatchedStore.saveCapabilities(runtimeCapabilities())
        try? await mismatchedStore.saveWorkspace(workspaceState(actor: actorIdentity()))
        try? await mismatchedStore.savePane(paneState(lastObservedSeq: 1))
        let mismatchedID = await NativeRuntime.ResizePaneRuntime(
            resizer: PaneResizer(ack: .mismatchedPaneID),
            store: mismatchedStore,
            clock: FixedClock()
        ).run(resizeInput())

        #expect(wrongSize == .failure(.malformedResizeAcknowledgement))
        #expect(missingSize == .failure(.malformedResizeAcknowledgement))
        #expect(mismatchedID == .failure(.malformedResizeAcknowledgement))
    }

    @Test("ResizePaneRuntime rejects unsupported resize capability")
    func resizePaneRejectsUnsupportedCapability() async throws {
        let store = RuntimeStore()
        try await store.saveCapabilities(runtimeCapabilities(paneResize: false))
        try await store.saveWorkspace(workspaceState(actor: actorIdentity()))
        try await store.savePane(paneState(lastObservedSeq: 1))

        let result = await NativeRuntime.ResizePaneRuntime(
            resizer: PaneResizer(),
            store: store,
            clock: FixedClock()
        ).run(resizeInput())

        #expect(result == .failure(.capabilitiesUnavailable))
    }

    @Test("ClosePaneRuntime clears pane runtime state")
    func closePaneClearsState() async throws {
        let store = RuntimeStore()
        try await store.saveCapabilities(runtimeCapabilities())
        try await store.saveWorkspace(workspaceState(actor: actorIdentity()))
        try await store.savePane(paneState(lastObservedSeq: 1))
        let action = NativeRuntime.ClosePaneRuntime(
            closer: PaneCloser(),
            store: store,
            clock: FixedClock()
        )

        _ = try await action.run(
            NativeRuntime.ClosePaneRuntimeInput(
                requestID: "close",
                workspaceID: "workspace-1",
                paneID: "pane-1",
                actor: actorIdentity(),
                source: .test
            )
        ).get()

        #expect(try await store.loadPane(paneID: "pane-1") == nil)
    }

    @Test("ClosePaneRuntime rejects unsupported close capability")
    func closePaneRejectsUnsupportedCapability() async throws {
        let store = RuntimeStore()
        try await store.saveCapabilities(runtimeCapabilities(paneClose: false))
        try await store.saveWorkspace(workspaceState(actor: actorIdentity()))
        try await store.savePane(paneState(lastObservedSeq: 1))

        let result = await NativeRuntime.ClosePaneRuntime(
            closer: PaneCloser(),
            store: store,
            clock: FixedClock()
        ).run(
            NativeRuntime.ClosePaneRuntimeInput(
                requestID: "close",
                workspaceID: "workspace-1",
                paneID: "pane-1",
                actor: actorIdentity(),
                source: .test
            )
        )

        #expect(result == .failure(.capabilitiesUnavailable))
        #expect(try await store.loadPane(paneID: "pane-1") != nil)
    }

    @Test("ServerTmuxRuntimeAdapter maps workspace snapshots without pty ownership")
    func serverTmuxAdapterMapsWorkspaceSnapshot() async throws {
        let transport = RuntimeRPCTransport(responses: [
            "tmux.workspace.getSnapshot": serverSnapshotData()
        ])
        let adapter = NativeRuntime.ServerTmuxRuntimeAdapter(transport: transport)

        let workspace = try await adapter.attachWorkspaceRuntime(
            NativeRuntime.AttachWorkspaceRuntimeInput(requestID: "attach", workspaceID: "workspace-1", actor: actorIdentity(), source: .nativeHost)
        )

        #expect(workspace.workspaceID == "workspace-1")
        #expect(workspace.tmuxSessionID == "fenrir-ws-workspace-1")
        #expect(workspace.windows.first?.tmuxWindowID == "@1")
        #expect(workspace.attachedPaneIDs == ["pane-1", "pane-2"])
        #expect(await transport.methods() == ["tmux.workspace.getSnapshot"])
        #expect(await transport.payload(for: "tmux.workspace.getSnapshot")?.contains("\"sessionId\":\"auth-user-a\"") == true)
        #expect(await transport.payload(for: "tmux.workspace.getSnapshot")?.contains("node-pty") == false)
    }

    @Test("ServerTmuxRuntimeAdapter maps Neovim pane metadata from snapshots")
    func serverTmuxAdapterMapsNeovimPaneMetadata() async throws {
        let transport = RuntimeRPCTransport(responses: [
            "tmux.workspace.getSnapshot": serverNeovimSnapshotData()
        ])
        let adapter = NativeRuntime.ServerTmuxRuntimeAdapter(transport: transport)

        let snapshot = try await adapter.enumerateWorkspaceRuntime(
            NativeRuntime.EnumerateWorkspaceRuntimeInput(requestID: "enumerate", workspaceID: "workspace-1", actor: actorIdentity(), source: .nativeHost)
        )

        let pane = snapshot.panes.first { $0.paneID == "pane-nvim" }
        #expect(pane?.metadata?.kind == "neovim")
        #expect(pane?.metadata?.neovim?.bootstrapID == "nvim-bootstrap")
        #expect(pane?.metadata?.neovim?.bridgeSocketPath == "/tmp/fenrir-nvim.sock")
        #expect(pane?.metadata?.neovim?.themeID == "fenrir-dark")
    }

    @Test("ServerTmuxRuntimeAdapter preserves requested workspace identity through tmux snapshots")
    func serverTmuxAdapterOpensWorkspaceWithEnsureGrant() async throws {
        let transport = RuntimeRPCTransport(responses: [
            "tmux.workspace.ensure": serverSnapshotData(workspaceID: "project-1"),
            "tmux.workspace.reconnect": serverSnapshotData(workspaceID: "project-1"),
            "tmux.workspace.getSnapshot": serverSnapshotData(workspaceID: "project-1")
        ])
        let adapter = NativeRuntime.ServerTmuxRuntimeAdapter(transport: transport, defaultWorkingDirectory: "/fallback")

        let workspace = try await adapter.openWorkspaceRuntime(
            NativeRuntime.OpenWorkspaceRuntimeInput(
                requestID: "open",
                workspaceID: "project-1",
                projectID: "project-1",
                workingDirectory: "/repo",
                actor: actorIdentity(),
                source: .nativeHost
            )
        )
        let reconnected = try await adapter.reconnectWorkspaceRuntime(
            NativeRuntime.ReconnectWorkspaceRuntimeInput(requestID: "reconnect", workspaceID: "project-1", actor: actorIdentity(), source: .nativeHost)
        )
        let enumerated = try await adapter.enumerateWorkspaceRuntime(
            NativeRuntime.EnumerateWorkspaceRuntimeInput(requestID: "enumerate", workspaceID: "project-1", actor: actorIdentity(), source: .nativeHost)
        )

        #expect(workspace.workspaceID == "project-1")
        #expect(reconnected.workspaceID == "project-1")
        #expect(enumerated.workspace.workspaceID == "project-1")
        #expect(enumerated.panes.allSatisfy { $0.workspaceID == "project-1" })
        #expect(await transport.methods() == ["tmux.workspace.ensure", "tmux.workspace.reconnect", "tmux.workspace.getSnapshot"])
        #expect(await transport.payload(for: "tmux.workspace.ensure")?.contains("\"workspaceId\":\"project-1\"") == true)
        #expect(await transport.payload(for: "tmux.workspace.reconnect")?.contains("\"workspaceId\":\"project-1\"") == true)
        #expect(await transport.payload(for: "tmux.workspace.getSnapshot")?.contains("\"workspaceId\":\"project-1\"") == true)
        #expect(await transport.payload(for: "tmux.workspace.ensure")?.contains("\"projectId\":\"project-1\"") == true)
        #expect(await transport.payload(for: "tmux.workspace.ensure")?.contains("repo") == true)
        #expect(await transport.payload(for: "tmux.workspace.ensure")?.contains("workspace:control") == true)
        #expect(await transport.payload(for: "tmux.workspace.ensure")?.contains("\"expiresAt\":null") == true)
    }

    @Test("OpenWorkspaceRuntime preserves requested native workspace ids")
    func openWorkspaceActionPreservesRequestedWorkspaceID() async throws {
        let actor = actorIdentity()
        let opened = try await NativeRuntime.OpenWorkspaceRuntime(
            opener: WorkspaceOpener(),
            store: RuntimeStore(),
            clock: FixedClock()
        ).run(
            NativeRuntime.OpenWorkspaceRuntimeInput(requestID: "open", workspaceID: "project-1", projectID: "project-1", workingDirectory: "/repo", actor: actor, source: .nativeHost)
        ).get()

        #expect(opened.workspace.workspaceID == "project-1")
    }

    @Test("ServerTmuxRuntimeAdapter validates detach against the live tmux workspace")
    func serverTmuxAdapterValidatesDetachBeforeLocalTeardown() async throws {
        let transport = RuntimeRPCTransport(responses: [
            "tmux.workspace.getSnapshot": serverSnapshotData()
        ])
        let adapter = NativeRuntime.ServerTmuxRuntimeAdapter(transport: transport)

        try await adapter.detachWorkspaceRuntime(
            NativeRuntime.DetachWorkspaceRuntimeInput(requestID: "detach", workspaceID: "workspace-1", actor: actorIdentity(), source: .nativeHost)
        )

        #expect(await transport.methods() == ["tmux.workspace.getSnapshot"])
        #expect(await transport.payload(for: "tmux.workspace.getSnapshot")?.contains("\"workspaceId\":\"workspace-1\"") == true)
    }

    @Test("ServerTmuxRuntimeAdapter focuses panes through the tmux focus RPC")
    func serverTmuxAdapterFocusesPaneThroughServer() async throws {
        let transport = RuntimeRPCTransport(responses: [
            "tmux.pane.focus": serverSnapshotData(activePaneID: "pane-2")
        ])
        let adapter = NativeRuntime.ServerTmuxRuntimeAdapter(transport: transport)

        let workspace = try await adapter.focusPaneRuntime(
            NativeRuntime.FocusPaneRuntimeInput(requestID: "focus", workspaceID: "workspace-1", windowID: "window-1", paneID: "pane-2", actor: actorIdentity(), source: .nativeHost)
        )

        #expect(workspace.windows.first?.activePaneID == "pane-2")
        #expect(await transport.methods() == ["tmux.pane.focus"])
        #expect(await transport.payload(for: "tmux.pane.focus")?.contains("\"paneId\":\"pane-2\"") == true)
    }

    @Test("ServerTmuxRuntimeAdapter writes pane input through tmux pane write")
    func serverTmuxAdapterWritesPaneInput() async throws {
        let transport = RuntimeRPCTransport(responses: [
            "tmux.pane.write": jsonData("""
            {
              "type": "accepted",
              "workspaceId": "workspace-1",
              "paneId": "pane-1",
              "requestId": "write-1",
              "inputSeq": 7,
              "acceptedAt": "2026-01-01T00:00:00.000Z"
            }
            """)
        ])
        let adapter = NativeRuntime.ServerTmuxRuntimeAdapter(transport: transport)

        let ack = try await adapter.writePaneInput(sendInput())

        #expect(ack.status == .accepted)
        #expect(ack.inputSeq == 7)
        #expect(await transport.methods() == ["tmux.pane.write"])
        #expect(await transport.payload(for: "tmux.pane.write")?.contains("\"data\":\"ls\\n\"") == true)
    }

    @Test("SendPaneInput rejects stale server tmux write acknowledgements")
    func sendPaneInputRejectsStaleServerTmuxWriteAcknowledgements() async throws {
        let store = RuntimeStore()
        try await store.saveWorkspace(workspaceState(actor: actorIdentity()))
        try await store.savePane(paneState(lastObservedSeq: 1))
        let transport = RuntimeRPCTransport(responses: [
            "tmux.pane.write": jsonData("""
            {
              "type": "accepted",
              "workspaceId": "workspace-1",
              "paneId": "different-pane",
              "requestId": "different-request",
              "inputSeq": 7,
              "acceptedAt": "2026-01-01T00:00:00.000Z"
            }
            """)
        ])
        let adapter = NativeRuntime.ServerTmuxRuntimeAdapter(transport: transport)

        let result = await NativeRuntime.SendPaneInput(
            writer: adapter,
            store: store,
            clock: FixedClock()
        ).run(sendInput())

        #expect(result == .failure(.malformedWriteAcknowledgement))
    }

    @Test("ServerTmuxRuntimeAdapter rejects write acknowledgements for another workspace")
    func serverTmuxAdapterRejectsWriteAckWorkspaceMismatch() async {
        let transport = RuntimeRPCTransport(responses: [
            "tmux.pane.write": jsonData("""
            {
              "type": "accepted",
              "workspaceId": "other-workspace",
              "paneId": "pane-1",
              "requestId": "write-1",
              "inputSeq": 7,
              "acceptedAt": "2026-01-01T00:00:00.000Z"
            }
            """)
        ])
        let adapter = NativeRuntime.ServerTmuxRuntimeAdapter(transport: transport)

        await #expect(throws: NativeRuntime.NativeRuntimeError.malformedWriteAcknowledgement) {
            try await adapter.writePaneInput(sendInput())
        }
    }

    @Test("ServerTmuxRuntimeAdapter maps pane stream events from tmux subscribe")
    func serverTmuxAdapterMapsPaneStreamEvents() async throws {
        let transport = RuntimeRPCTransport(streams: [
            "tmux.pane.subscribeStream": [
                jsonData("""
                {
                  "type": "backfill-started",
                  "descriptor": { "streamId": "stream-1", "paneId": "pane-1", "lowSeq": 0, "highSeq": 8, "droppedCount": 0 },
                  "fromSeq": 7,
                  "toSeq": 8
                }
                """),
                jsonData("""
                {
                  "type": "chunk",
                  "descriptor": { "streamId": "stream-1", "paneId": "pane-1", "lowSeq": 0, "highSeq": 8, "droppedCount": 0 },
                  "seq": 8,
                  "data": "ok",
                  "emittedAt": "2026-01-01T00:00:00.000Z"
                }
                """),
                jsonData("""
                {
                  "type": "overflow",
                  "descriptor": { "streamId": "stream-1", "paneId": "pane-1", "lowSeq": 0, "highSeq": 8, "droppedCount": 1 },
                  "droppedCount": 1,
                  "policy": "fast-forward",
                  "reason": "slow-client"
                }
                """)
            ]
        ])
        let adapter = NativeRuntime.ServerTmuxRuntimeAdapter(transport: transport, maxBufferedStreamChunks: 2)

        let stream = await adapter.reconnectPaneStream(
            NativeRuntime.ReconnectPaneStreamInput(requestID: "stream", workspaceID: "workspace-1", paneID: "pane-1", actor: actorIdentity(), source: .terminalViewport),
            stream: NativeRuntime.PaneStreamState(paneID: "pane-1", streamID: "stream-1", lastObservedSeq: 7, status: .live),
            backfill: .fromSeq(7)
        )
        var envelopes: [NativeRuntime.PaneStreamEnvelope] = []
        for try await envelope in stream {
            envelopes.append(envelope)
        }

        #expect(envelopes.map(\.kind) == [.backfillStarted, .output, .overflow])
        #expect(envelopes[1].bytes == Data("ok".utf8))
        #expect(await transport.methods() == ["tmux.pane.subscribeStream"])
        #expect(await transport.payload(for: "tmux.pane.subscribeStream")?.contains("\"backfill\":\"from-seq\"") == true)
        #expect(await transport.payload(for: "tmux.pane.subscribeStream")?.contains("\"afterSeq\":7") == true)
    }

    @Test("ServerTmuxRuntimeAdapter resizes and closes panes through tmux APIs")
    func serverTmuxAdapterResizesAndClosesPanes() async throws {
        let transport = RuntimeRPCTransport(responses: [
            "tmux.pane.resize": serverPaneData(cols: 120, rows: 40),
            "tmux.pane.close": serverSnapshotData()
        ])
        let adapter = NativeRuntime.ServerTmuxRuntimeAdapter(transport: transport)

        let resize = try await adapter.resizePaneRuntime(resizeInput())
        try await adapter.closePaneRuntime(NativeRuntime.ClosePaneRuntimeInput(requestID: "close", workspaceID: "workspace-1", paneID: "pane-1", actor: actorIdentity(), source: .terminalViewport))

        #expect(resize.status == .accepted)
        #expect(resize.size == NativeRuntime.PaneSize(columns: 120, rows: 40))
        #expect(await transport.methods() == ["tmux.pane.resize", "tmux.pane.close"])
        #expect(await transport.payload(for: "tmux.pane.close")?.contains("\"mode\":\"terminate\"") == true)
    }
}

private func attachPaneInput() -> NativeRuntime.AttachPaneRuntimeInput {
    NativeRuntime.AttachPaneRuntimeInput(
        requestID: "attach-pane",
        workspaceID: "workspace-1",
        paneID: "pane-1",
        streamID: "stream-1",
        actor: actorIdentity(),
        source: .test
    )
}

private func sendInput() -> NativeRuntime.SendPaneInputInput {
    NativeRuntime.SendPaneInputInput(
        requestID: "write-1",
        workspaceID: "workspace-1",
        paneID: "pane-1",
        actor: actorIdentity(),
        inputBytes: Data("ls\n".utf8),
        source: .terminalViewport
    )
}

private func resizeInput() -> NativeRuntime.ResizePaneRuntimeInput {
    NativeRuntime.ResizePaneRuntimeInput(
        requestID: "resize",
        workspaceID: "workspace-1",
        paneID: "pane-1",
        actor: actorIdentity(),
        size: NativeRuntime.PaneSize(columns: 120, rows: 40),
        source: .terminalViewport
    )
}

private func runtimeCapabilities(
    paneResize: Bool = true,
    paneClose: Bool = true
) -> NativeRuntime.RuntimeCapabilities {
    NativeRuntime.RuntimeCapabilities(
        tmuxKernel: true,
        paneStreams: true,
        writeAcknowledgements: true,
        paneResize: paneResize,
        paneClose: paneClose
    )
}

private func actorIdentity(_ subject: String = "user-a") -> NativeRuntime.RuntimeActorIdentity {
    NativeRuntime.RuntimeActorIdentity(profileID: "local", authSessionID: "auth-\(subject)", subject: subject)
}

private func workspaceState(
    workspaceID: WorkspaceID = "workspace-1",
    actor: NativeRuntime.RuntimeActorIdentity? = nil,
    activePaneID: PaneID = "pane-1"
) -> NativeRuntime.WorkspaceRuntimeState {
    NativeRuntime.WorkspaceRuntimeState(
        workspaceID: workspaceID,
        status: .attached,
        actor: actor,
        tmuxSessionID: NativeRuntime.TmuxSessionID(rawValue: "tmux-session-\(workspaceID.rawValue)"),
        windows: [
            NativeRuntime.WindowRuntimeState(
                workspaceID: workspaceID,
                windowID: "window-1",
                tmuxWindowID: "@1",
                index: 0,
                title: "shell",
                activePaneID: activePaneID,
                paneIDs: ["pane-1", "pane-2"]
            )
        ],
        activeWindowID: "window-1",
        attachedPaneIDs: ["pane-1", "pane-2"],
        generation: 1
    )
}

private func paneState(
    lastObservedSeq: UInt64?,
    paneID: PaneID = "pane-1",
    windowID: FenrirWindowID? = "window-1",
    tmuxPaneID: NativeRuntime.TmuxPaneID? = "%1"
) -> NativeRuntime.PaneRuntimeState {
    NativeRuntime.PaneRuntimeState(
        workspaceID: "workspace-1",
        paneID: paneID,
        status: .attached,
        windowID: windowID,
        tmuxPaneID: tmuxPaneID,
        stream: NativeRuntime.PaneStreamState(
            paneID: paneID,
            streamID: "stream-1",
            lastObservedSeq: lastObservedSeq,
            status: .live
        )
    )
}

private actor RuntimeStore: NativeRuntime.NativeRuntimeStore {
    private var capabilities: NativeRuntime.RuntimeCapabilities?
    private var workspaces: [WorkspaceID: NativeRuntime.WorkspaceRuntimeState] = [:]
    private var panes: [PaneID: NativeRuntime.PaneRuntimeState] = [:]

    func loadCapabilities() async throws -> NativeRuntime.RuntimeCapabilities? {
        capabilities
    }

    func saveCapabilities(_ capabilities: NativeRuntime.RuntimeCapabilities) async throws {
        self.capabilities = capabilities
    }

    func loadWorkspace(workspaceID: WorkspaceID) async throws -> NativeRuntime.WorkspaceRuntimeState? {
        workspaces[workspaceID]
    }

    func saveWorkspace(_ workspace: NativeRuntime.WorkspaceRuntimeState) async throws {
        workspaces[workspace.workspaceID] = workspace
    }

    func deleteWorkspace(workspaceID: WorkspaceID) async throws {
        workspaces[workspaceID] = nil
    }

    func loadPane(paneID: PaneID) async throws -> NativeRuntime.PaneRuntimeState? {
        panes[paneID]
    }

    func savePane(_ pane: NativeRuntime.PaneRuntimeState) async throws {
        panes[pane.paneID] = pane
    }

    func deletePane(paneID: PaneID) async throws {
        panes[paneID] = nil
    }
}

private struct CapabilityQuery: NativeRuntime.RuntimeCapabilityQuerying {
    let capabilities: NativeRuntime.RuntimeCapabilities

    func discoverRuntimeCapabilities(_ input: NativeRuntime.DiscoverRuntimeCapabilitiesInput) async throws -> NativeRuntime.RuntimeCapabilities {
        capabilities
    }
}

private actor WorkspaceAttacher: NativeRuntime.WorkspaceRuntimeAttaching {
    private var count = 0

    func attachWorkspaceRuntime(_ input: NativeRuntime.AttachWorkspaceRuntimeInput) async throws -> NativeRuntime.WorkspaceRuntimeState {
        count += 1
        return workspaceState(workspaceID: input.workspaceID, actor: input.actor)
    }

    func attachCount() -> Int {
        count
    }
}

private actor WorkspaceOpener: NativeRuntime.WorkspaceRuntimeOpening {
    let workspaceID: WorkspaceID?
    private var count = 0

    init(workspaceID: WorkspaceID? = nil) {
        self.workspaceID = workspaceID
    }

    func openWorkspaceRuntime(_ input: NativeRuntime.OpenWorkspaceRuntimeInput) async throws -> NativeRuntime.WorkspaceRuntimeState {
        count += 1
        return workspaceState(workspaceID: workspaceID ?? input.workspaceID, actor: input.actor)
    }

    func openCount() -> Int {
        count
    }
}

private struct WorkspaceCloser: NativeRuntime.WorkspaceRuntimeClosing {
    func closeWorkspaceRuntime(_ input: NativeRuntime.CloseWorkspaceRuntimeInput) async throws {}
}

private struct WorkspaceSwitcher: NativeRuntime.WorkspaceRuntimeSwitching {
    func switchWorkspaceRuntime(_ input: NativeRuntime.SwitchWorkspaceRuntimeInput) async throws -> NativeRuntime.WorkspaceRuntimeState {
        workspaceState(workspaceID: input.workspaceID, actor: input.actor)
    }
}

private struct WorkspaceEnumerator: NativeRuntime.WorkspaceRuntimeEnumerating {
    let actor: NativeRuntime.RuntimeActorIdentity
    let workspace: NativeRuntime.WorkspaceRuntimeState?
    let panes: [NativeRuntime.PaneRuntimeState]

    init(
        actor: NativeRuntime.RuntimeActorIdentity,
        workspace: NativeRuntime.WorkspaceRuntimeState? = nil,
        panes: [NativeRuntime.PaneRuntimeState] = [
            paneState(lastObservedSeq: nil, paneID: "pane-1", windowID: "window-1", tmuxPaneID: "%1"),
            paneState(lastObservedSeq: nil, paneID: "pane-2", windowID: "window-1", tmuxPaneID: "%2")
        ]
    ) {
        self.actor = actor
        self.workspace = workspace
        self.panes = panes
    }

    func enumerateWorkspaceRuntime(_ input: NativeRuntime.EnumerateWorkspaceRuntimeInput) async throws -> (workspace: NativeRuntime.WorkspaceRuntimeState, panes: [NativeRuntime.PaneRuntimeState]) {
        (workspace ?? workspaceState(workspaceID: input.workspaceID, actor: actor), panes)
    }
}

private struct WorkspaceDetacher: NativeRuntime.WorkspaceRuntimeDetaching {
    func detachWorkspaceRuntime(_ input: NativeRuntime.DetachWorkspaceRuntimeInput) async throws {}
}

private struct PaneFocuser: NativeRuntime.PaneRuntimeFocusing {
    func focusPaneRuntime(_ input: NativeRuntime.FocusPaneRuntimeInput) async throws -> NativeRuntime.WorkspaceRuntimeState {
        workspaceState(workspaceID: input.workspaceID, actor: input.actor, activePaneID: input.paneID)
    }
}

private actor PaneAttacher: NativeRuntime.PaneRuntimeAttaching {
    private var observedBackfill: NativeRuntime.BackfillMode?

    func attachPaneRuntime(
        _ input: NativeRuntime.AttachPaneRuntimeInput,
        backfill: NativeRuntime.BackfillMode
    ) async throws -> NativeRuntime.PaneRuntimeState {
        observedBackfill = backfill
        return NativeRuntime.PaneRuntimeState(
            workspaceID: input.workspaceID,
            paneID: input.paneID,
            status: .attached,
            windowID: input.windowID,
            tmuxPaneID: "%1",
            stream: NativeRuntime.PaneStreamState(
                paneID: input.paneID,
                streamID: input.streamID,
                status: .live
            )
        )
    }

    func lastBackfill() -> NativeRuntime.BackfillMode? {
        observedBackfill
    }
}

private actor PaneSubscriber: NativeRuntime.PaneStreamSubscribing {
    let envelopes: [NativeRuntime.PaneStreamEnvelope]
    private var observedBackfill: NativeRuntime.BackfillMode?

    init(envelopes: [NativeRuntime.PaneStreamEnvelope]) {
        self.envelopes = envelopes
    }

    func reconnectPaneStream(
        _ input: NativeRuntime.ReconnectPaneStreamInput,
        stream: NativeRuntime.PaneStreamState,
        backfill: NativeRuntime.BackfillMode
    ) async -> AsyncThrowingStream<NativeRuntime.PaneStreamEnvelope, Error> {
        observedBackfill = backfill
        return AsyncThrowingStream { continuation in
            for envelope in envelopes {
                continuation.yield(envelope)
            }
            continuation.finish()
        }
    }

    func lastBackfill() -> NativeRuntime.BackfillMode? {
        observedBackfill
    }
}

private struct PaneWriter: NativeRuntime.PaneInputWriting {
    enum Acknowledgement: Sendable {
        case accepted(inputSeq: UInt64?)
        case rejected(code: NativeRuntime.WriteRejectionCode?)
    }

    let acknowledgement: Acknowledgement

    init(acknowledgement: Acknowledgement = .accepted(inputSeq: 42)) {
        self.acknowledgement = acknowledgement
    }

    func writePaneInput(_ input: NativeRuntime.SendPaneInputInput) async throws -> NativeRuntime.PaneWriteAck {
        switch acknowledgement {
        case .accepted(let inputSeq):
            NativeRuntime.PaneWriteAck(
                requestID: input.requestID,
                paneID: input.paneID,
                status: .accepted,
                inputSeq: inputSeq
            )
        case .rejected(let code):
            NativeRuntime.PaneWriteAck(
                requestID: input.requestID,
                paneID: input.paneID,
                status: .rejected,
                rejectionCode: code
            )
        }
    }
}

private struct PaneResizer: NativeRuntime.PaneRuntimeResizing {
    enum Ack {
        case accepted
        case acceptedWrongSize(NativeRuntime.PaneSize)
        case acceptedMissingSize
        case rejected
        case mismatchedPaneID
    }

    let ack: Ack

    init(ack: Ack = .accepted) {
        self.ack = ack
    }

    func resizePaneRuntime(_ input: NativeRuntime.ResizePaneRuntimeInput) async throws -> NativeRuntime.PaneResizeAck {
        switch ack {
        case .accepted:
            NativeRuntime.PaneResizeAck(requestID: input.requestID, paneID: input.paneID, status: .accepted, size: input.size)
        case .acceptedWrongSize(let size):
            NativeRuntime.PaneResizeAck(requestID: input.requestID, paneID: input.paneID, status: .accepted, size: size)
        case .acceptedMissingSize:
            NativeRuntime.PaneResizeAck(requestID: input.requestID, paneID: input.paneID, status: .accepted)
        case .rejected:
            NativeRuntime.PaneResizeAck(requestID: input.requestID, paneID: input.paneID, status: .rejected)
        case .mismatchedPaneID:
            NativeRuntime.PaneResizeAck(requestID: input.requestID, paneID: "different-pane", status: .accepted, size: input.size)
        }
    }
}

private struct PaneCloser: NativeRuntime.PaneRuntimeClosing {
    func closePaneRuntime(_ input: NativeRuntime.ClosePaneRuntimeInput) async throws {}
}

private actor RuntimeRPCTransport: NativeRuntime.ServerRPCTransport {
    private let responses: [String: Data]
    private let streams: [String: [Data]]
    private var requests: [NativeRuntime.ServerRPCRequest] = []

    init(responses: [String: Data] = [:], streams: [String: [Data]] = [:]) {
        self.responses = responses
        self.streams = streams
    }

    func request(_ request: NativeRuntime.ServerRPCRequest) async throws -> Data {
        requests.append(request)
        guard let response = responses[request.method] else {
            throw NativeRuntime.NativeRuntimeError.serverUnavailable
        }
        return response
    }

    func stream(_ request: NativeRuntime.ServerRPCRequest) async -> AsyncThrowingStream<Data, Error> {
        AsyncThrowingStream { continuation in
            append(request)
            guard let stream = stream(for: request.method) else {
                continuation.finish(throwing: NativeRuntime.NativeRuntimeError.serverUnavailable)
                return
            }
            for data in stream {
                continuation.yield(data)
            }
            continuation.finish()
        }
    }

    func methods() -> [String] {
        requests.map(\.method)
    }

    func payload(for method: String) -> String? {
        requests.last(where: { $0.method == method }).flatMap { String(data: $0.payload, encoding: .utf8) }
    }

    private func append(_ request: NativeRuntime.ServerRPCRequest) {
        requests.append(request)
    }

    private func stream(for method: String) -> [Data]? {
        streams[method]
    }
}

private func serverSnapshotData(workspaceID: String = "workspace-1", activePaneID: String = "pane-1") -> Data {
    jsonData("""
    {
      "workspace": {
        "workspaceId": "\(workspaceID)",
        "projectId": "project-1",
        "tmuxSessionName": "fenrir-ws-\(workspaceID)",
        "cwd": "/tmp",
        "status": "running",
        "activeWindowId": "window-1",
        "grants": [],
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z"
      },
      "windows": [
        {
          "windowId": "window-1",
          "workspaceId": "\(workspaceID)",
          "tmuxWindowId": "@1",
          "tmuxWindowIndex": 0,
          "name": "shell",
          "cwd": "/tmp",
          "status": "active",
          "activePaneId": "\(activePaneID)",
          "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-01T00:00:00.000Z"
        }
      ],
      "panes": [
        \(serverPaneJSON(workspaceID: workspaceID, paneID: "pane-1", tmuxPaneID: "%1", cols: 100, rows: 30)),
        \(serverPaneJSON(workspaceID: workspaceID, paneID: "pane-2", tmuxPaneID: "%2", cols: 100, rows: 30))
      ],
      "revision": 3
    }
    """)
}

private func serverNeovimSnapshotData() -> Data {
    jsonData("""
    {
      "workspace": {
        "workspaceId": "workspace-1",
        "projectId": "project-1",
        "tmuxSessionName": "fenrir-ws-workspace-1",
        "cwd": "/tmp",
        "status": "running",
        "activeWindowId": "window-1",
        "grants": [],
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z"
      },
      "windows": [
        {
          "windowId": "window-1",
          "workspaceId": "workspace-1",
          "tmuxWindowId": "@1",
          "tmuxWindowIndex": 0,
          "name": "editor",
          "cwd": "/tmp",
          "status": "active",
          "activePaneId": "pane-nvim",
          "createdAt": "2026-01-01T00:00:00.000Z",
          "updatedAt": "2026-01-01T00:00:00.000Z"
        }
      ],
      "panes": [
        \(serverPaneJSON(workspaceID: "workspace-1", paneID: "pane-1", tmuxPaneID: "%1", cols: 100, rows: 30)),
        \(serverNeovimPaneJSON())
      ],
      "revision": 4
    }
    """)
}

private func serverPaneData(
    workspaceID: String = "workspace-1",
    paneID: String = "pane-1",
    tmuxPaneID: String = "%1",
    cols: Int,
    rows: Int
) -> Data {
    jsonData(serverPaneJSON(workspaceID: workspaceID, paneID: paneID, tmuxPaneID: tmuxPaneID, cols: cols, rows: rows))
}

private func serverPaneJSON(
    workspaceID: String = "workspace-1",
    paneID: String = "pane-1",
    tmuxPaneID: String = "%1",
    cols: Int,
    rows: Int
) -> String {
    """
    {
      "paneId": "\(paneID)",
      "workspaceId": "\(workspaceID)",
      "windowId": "window-1",
      "tmuxPaneId": "\(tmuxPaneID)",
      "cwd": "/tmp",
      "cols": \(cols),
      "rows": \(rows),
      "status": "running",
      "metadata": {
        "kind": "shell",
        "title": "shell",
        "process": null,
        "labels": {},
        "neovim": null,
        "agent": null,
        "workflow": null,
        "managedProcess": null,
        "remoteProcess": null,
        "browserLab": null
      },
      "stream": {
        "streamId": "stream-1",
        "paneId": "\(paneID)",
        "encoding": "utf8",
        "lowSeq": 0,
        "highSeq": 5,
        "droppedCount": 0,
        "backfillAvailable": true,
        "maxChunkBytes": 262144
      },
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
    """
}

private func serverNeovimPaneJSON() -> String {
    """
    {
      "paneId": "pane-nvim",
      "workspaceId": "workspace-1",
      "windowId": "window-1",
      "tmuxPaneId": "%2",
      "cwd": "/tmp",
      "cols": 100,
      "rows": 30,
      "status": "running",
      "metadata": {
        "kind": "neovim",
        "title": "nvim",
        "process": {
          "command": "nvim README.md",
          "argv": ["nvim", "README.md"],
          "envKeys": ["NVIM_LISTEN_ADDRESS"],
          "pid": null,
          "startedAt": null,
          "exitedAt": null,
          "exitCode": null,
          "exitSignal": null
        },
        "labels": {},
        "neovim": {
          "bootstrapId": "nvim-bootstrap",
          "workspaceId": "workspace-1",
          "windowId": "window-1",
          "cwd": "/tmp",
          "profileId": "default",
          "themeId": "fenrir-dark",
          "keybindingProfileId": "native-compatible",
          "bridgeSocketPath": "/tmp/fenrir-nvim.sock",
          "files": ["README.md"],
          "launchSource": "user",
          "bootstrapEnvKeys": ["NVIM_LISTEN_ADDRESS"]
        },
        "agent": null,
        "workflow": null,
        "managedProcess": null,
        "remoteProcess": null,
        "browserLab": null
      },
      "stream": {
        "streamId": "stream-nvim",
        "paneId": "pane-nvim",
        "encoding": "utf8",
        "lowSeq": 0,
        "highSeq": 5,
        "droppedCount": 0,
        "backfillAvailable": true,
        "maxChunkBytes": 262144
      },
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
    """
}

private func jsonData(_ value: String) -> Data {
    Data(value.utf8)
}
