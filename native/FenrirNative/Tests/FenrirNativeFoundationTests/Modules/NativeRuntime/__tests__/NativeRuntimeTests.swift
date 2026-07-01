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
                source: .test
            )
        ).get()

        #expect(result.workspace.workspaceID == "workspace-1")
        #expect(result.workspace.status == .attached)
        #expect(try await store.loadWorkspace(workspaceID: "workspace-1")?.status == .attached)
    }

    @Test("DetachWorkspaceRuntime clears local runtime state only")
    func detachWorkspaceClearsLocalState() async throws {
        let store = RuntimeStore()
        try await store.saveWorkspace(NativeRuntime.WorkspaceRuntimeState(workspaceID: "workspace-1", status: .attached))
        let action = NativeRuntime.DetachWorkspaceRuntime(
            detacher: WorkspaceDetacher(),
            store: store,
            clock: FixedClock()
        )

        _ = try await action.run(
            NativeRuntime.DetachWorkspaceRuntimeInput(
                requestID: "detach",
                workspaceID: "workspace-1",
                source: .test
            )
        ).get()

        #expect(try await store.loadWorkspace(workspaceID: "workspace-1") == nil)
    }

    @Test("AttachPaneRuntime uses latest backfill when no cursor exists")
    func attachPaneUsesLatestBackfillWithoutCursor() async throws {
        let store = RuntimeStore()
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

    @Test("ReconnectPaneStream uses cursor backfill and applies output gap overflow states")
    func reconnectPaneStreamAppliesEnvelopes() async throws {
        let store = RuntimeStore()
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
                    source: .test
                )
            )

            #expect(result == .failure(.malformedStreamEnvelope))
        }
    }

    @Test("SendPaneInput returns stable write acknowledgement request id")
    func sendPaneInputKeepsRequestID() async throws {
        let writer = PaneWriter()
        let action = NativeRuntime.SendPaneInput(writer: writer, clock: FixedClock())

        let result = try await action.run(sendInput()).get()

        #expect(result.requestID == "write-1")
        #expect(result.acknowledgement.requestID == "write-1")
        #expect(result.acknowledgement.status == .accepted)
        #expect(result.acknowledgement.inputSeq == 42)
    }

    @Test("SendPaneInput rejects accepted acknowledgements missing input sequence")
    func sendPaneInputRejectsAcceptedAckWithoutInputSeq() async {
        let action = NativeRuntime.SendPaneInput(
            writer: PaneWriter(acknowledgement: .accepted(inputSeq: nil)),
            clock: FixedClock()
        )

        let result = await action.run(sendInput())

        #expect(result == .failure(.malformedWriteAcknowledgement))
    }

    @Test("SendPaneInput maps rejected acknowledgements to write rejected")
    func sendPaneInputMapsRejectedAck() async {
        let action = NativeRuntime.SendPaneInput(
            writer: PaneWriter(acknowledgement: .rejected(code: .permissionDenied)),
            clock: FixedClock()
        )

        let result = await action.run(sendInput())

        #expect(result == .failure(.paneWriteRejected))
    }

    @Test("SendPaneInput rejects rejected acknowledgements missing rejection code")
    func sendPaneInputRejectsRejectedAckWithoutCode() async {
        let action = NativeRuntime.SendPaneInput(
            writer: PaneWriter(acknowledgement: .rejected(code: nil)),
            clock: FixedClock()
        )

        let result = await action.run(sendInput())

        #expect(result == .failure(.malformedWriteAcknowledgement))
    }

    @Test("ResizePaneRuntime maps rejected resize acknowledgements")
    func resizePaneMapsRejectedAck() async {
        let action = NativeRuntime.ResizePaneRuntime(
            resizer: PaneResizer(ack: .rejected),
            store: RuntimeStore(),
            clock: FixedClock()
        )

        let result = await action.run(resizeInput())

        #expect(result == .failure(.paneResizeRejected))
    }

    @Test("ResizePaneRuntime rejects malformed accepted resize acknowledgements")
    func resizePaneRejectsMalformedAcceptedAck() async {
        let wrongSize = await NativeRuntime.ResizePaneRuntime(
            resizer: PaneResizer(ack: .acceptedWrongSize(NativeRuntime.PaneSize(columns: 10, rows: 10))),
            store: RuntimeStore(),
            clock: FixedClock()
        ).run(resizeInput())

        let missingSize = await NativeRuntime.ResizePaneRuntime(
            resizer: PaneResizer(ack: .acceptedMissingSize),
            store: RuntimeStore(),
            clock: FixedClock()
        ).run(resizeInput())

        let mismatchedID = await NativeRuntime.ResizePaneRuntime(
            resizer: PaneResizer(ack: .mismatchedPaneID),
            store: RuntimeStore(),
            clock: FixedClock()
        ).run(resizeInput())

        #expect(wrongSize == .failure(.malformedResizeAcknowledgement))
        #expect(missingSize == .failure(.malformedResizeAcknowledgement))
        #expect(mismatchedID == .failure(.malformedResizeAcknowledgement))
    }

    @Test("ClosePaneRuntime clears pane runtime state")
    func closePaneClearsState() async throws {
        let store = RuntimeStore()
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
                source: .test
            )
        ).get()

        #expect(try await store.loadPane(paneID: "pane-1") == nil)
    }
}

private func attachPaneInput() -> NativeRuntime.AttachPaneRuntimeInput {
    NativeRuntime.AttachPaneRuntimeInput(
        requestID: "attach-pane",
        workspaceID: "workspace-1",
        paneID: "pane-1",
        streamID: "stream-1",
        source: .test
    )
}

private func sendInput() -> NativeRuntime.SendPaneInputInput {
    NativeRuntime.SendPaneInputInput(
        requestID: "write-1",
        workspaceID: "workspace-1",
        paneID: "pane-1",
        inputBytes: Data("ls\n".utf8),
        source: .terminalViewport
    )
}

private func resizeInput() -> NativeRuntime.ResizePaneRuntimeInput {
    NativeRuntime.ResizePaneRuntimeInput(
        requestID: "resize",
        workspaceID: "workspace-1",
        paneID: "pane-1",
        size: NativeRuntime.PaneSize(columns: 120, rows: 40),
        source: .terminalViewport
    )
}

private func paneState(lastObservedSeq: UInt64?) -> NativeRuntime.PaneRuntimeState {
    NativeRuntime.PaneRuntimeState(
        workspaceID: "workspace-1",
        paneID: "pane-1",
        status: .attached,
        stream: NativeRuntime.PaneStreamState(
            paneID: "pane-1",
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

private struct WorkspaceAttacher: NativeRuntime.WorkspaceRuntimeAttaching {
    func attachWorkspaceRuntime(_ input: NativeRuntime.AttachWorkspaceRuntimeInput) async throws -> NativeRuntime.WorkspaceRuntimeState {
        NativeRuntime.WorkspaceRuntimeState(workspaceID: input.workspaceID, status: .attached, generation: 1)
    }
}

private struct WorkspaceDetacher: NativeRuntime.WorkspaceRuntimeDetaching {
    func detachWorkspaceRuntime(_ input: NativeRuntime.DetachWorkspaceRuntimeInput) async throws {}
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
    ) async throws -> [NativeRuntime.PaneStreamEnvelope] {
        observedBackfill = backfill
        return envelopes
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
