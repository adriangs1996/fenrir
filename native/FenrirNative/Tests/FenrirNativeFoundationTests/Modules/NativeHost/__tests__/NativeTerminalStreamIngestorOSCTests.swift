import AppKit
import Foundation
import Testing
import AgentIntegration
import FenrirNativeShared
import NativeRuntime
import PaneGrid
import TerminalViewport
@testable import FenrirNativeApp

@Suite("NativeHost terminal stream ingestor OSC forwarding", .serialized)
struct NativeTerminalStreamIngestorOSCTests {
    @Test("Forwards reserved OSC presence and renders only normal output")
    @MainActor
    func forwardsReservedOSCPresenceAndRendersOnlyNormalOutput() async throws {
        let viewportStore = NativeAppTerminalViewportStore()
        let presenceStore = AgentIntegration.InMemoryAgentPresenceStore()
        let clock = AgentIntegration.FixedAgentIntegrationClock(timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000)))
        let forwarder = NativeAgentPresenceOSCForwarder(
            ingestAgentPresenceSignal: AgentIntegration.IngestAgentPresenceSignal(store: presenceStore, clock: clock)
        )
        let ingestor = NativeTerminalStreamIngestor(store: viewportStore, reservedOSCForwarder: forwarder)
        let backend = NativeHostOSCRecordingTerminalBackend()
        let terminalView = FenrirTerminalView(backend: backend)
        let pane = PaneGrid.PanePresentation(
            paneID: "pane-ingest-osc",
            tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: "%100"),
            streamID: "stream-ingest-osc",
            viewportID: "viewport-ingest-osc",
            title: "ingest-osc",
            rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 120, rows: 36),
            isFocused: true
        )
        let payload = #"{"namespace":"com.fenrir.agent.presence.v1","agentID":"codex","state":"busy","workspaceID":"workspace-a","paneID":"pane-ingest-osc","sequence":21,"timestamp":"2023-11-14T22:13:20Z"}"#
        var bytes = Data("before".utf8)
        bytes.append(Data([0x1B]))
        bytes.append(Data("]8737;".utf8))
        bytes.append(Data(payload.utf8))
        bytes.append(Data([0x07]))
        bytes.append(Data("after".utf8))

        let result = await ingestor.ingestOutput(
            workspaceID: "workspace-a",
            windowID: "window-a",
            pane: pane,
            streamID: "stream-ingest-osc",
            sequence: 1,
            bytes: bytes,
            terminalView: terminalView
        )

        guard case .success = result else {
            Issue.record("Expected stream ingestor to succeed")
            return
        }
        #expect(backend.renderedText == "beforeafter")
        #expect(!backend.renderedText.contains("com.fenrir.agent.presence.v1"))
        let savedState = try await viewportStore.loadViewport(viewportID: "viewport-ingest-osc")
        #expect(savedState?.lastAppliedSequence == 1)

        let records = try await AgentIntegration.ListAgentPresence(store: presenceStore, clock: clock)
            .run(.init(requestID: "list-presence", workspaceID: "workspace-a", source: .test))
            .get()

        #expect(records.records.count == 1)
        guard let record = records.records.first else {
            Issue.record("Expected exactly one presence record")
            return
        }
        #expect(record.agentID == .codex)
        #expect(record.state == .busy)
        #expect(record.sequence == 21)
        #expect(record.provenance.workspaceID == "workspace-a")
        #expect(record.provenance.tabID == "window-a")
        #expect(record.provenance.paneID == "pane-ingest-osc")
        #expect(record.provenance.viewportID == "viewport-ingest-osc")
        #expect(record.provenance.kind == .terminalViewportForwardedOSC)
    }


    @Test("Native stream ingestor rejects duplicate sequence without duplicate render")
    @MainActor
    func nativeStreamIngestorRejectsDuplicateSequenceWithoutDuplicateRender() async throws {
        let viewportStore = NativeAppTerminalViewportStore()
        let ingestor = NativeTerminalStreamIngestor(store: viewportStore)
        let backend = NativeHostOSCRecordingTerminalBackend()
        let terminalView = FenrirTerminalView(backend: backend)
        let pane = PaneGrid.PanePresentation(
            paneID: "pane-sequence-guard",
            tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: "%102"),
            streamID: "stream-sequence-guard",
            viewportID: "viewport-sequence-guard",
            title: "sequence-guard",
            rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 120, rows: 36),
            isFocused: true
        )

        let first = await ingestor.ingestOutput(
            workspaceID: "workspace-a",
            windowID: "window-a",
            pane: pane,
            streamID: "stream-sequence-guard",
            sequence: 1,
            bytes: Data("first".utf8),
            terminalView: terminalView
        )
        guard case .success = first else {
            Issue.record("Expected first sequence to render")
            return
        }

        let duplicate = await ingestor.ingestOutput(
            workspaceID: "workspace-a",
            windowID: "window-a",
            pane: pane,
            streamID: "stream-sequence-guard",
            sequence: 1,
            bytes: Data("duplicate".utf8),
            terminalView: terminalView
        )

        #expect(duplicate == .failure(.streamOrderViolation))
        #expect(backend.renderedText == "first")
        let savedState = try await viewportStore.loadViewport(viewportID: "viewport-sequence-guard")
        #expect(savedState?.lastAppliedSequence == 1)
    }

    @Test("Pane host routes stream output through terminal ingestor")
    @MainActor
    func paneHostRoutesStreamOutputThroughTerminalIngestor() async throws {
        var continuation: AsyncThrowingStream<NativeRuntime.PaneStreamEnvelope, Error>.Continuation?
        let stream = AsyncThrowingStream<NativeRuntime.PaneStreamEnvelope, Error> { current in
            continuation = current
        }
        let viewportStore = NativeAppTerminalViewportStore()
        let presenceStore = AgentIntegration.InMemoryAgentPresenceStore()
        let clock = AgentIntegration.FixedAgentIntegrationClock(timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000)))
        let forwarder = NativeAgentPresenceOSCForwarder(
            ingestAgentPresenceSignal: AgentIntegration.IngestAgentPresenceSignal(store: presenceStore, clock: clock)
        )
        let ingestor = NativeTerminalStreamIngestor(store: viewportStore, reservedOSCForwarder: forwarder)
        let state = nativeHostOSCPaneGridState(streamID: "stream-pane-host-osc")
        let host = NativeTerminalPaneHostView(
            paneGridState: state,
            paneStreamSubscriber: { workspaceID, pane, backfill in
                #expect(workspaceID == "workspace-a")
                #expect(pane.paneID == "pane-host-osc")
                #expect(pane.streamID == "stream-pane-host-osc")
                #expect(backfill == .latest)
                return stream
            },
            terminalStreamIngestor: ingestor
        )
        let payload = #"{"namespace":"com.fenrir.agent.presence.v1","agentID":"codex","state":"busy","workspaceID":"workspace-a","paneID":"pane-host-osc","sequence":31,"timestamp":"2023-11-14T22:13:20Z"}"#
        var bytes = Data("before".utf8)
        bytes.append(Data([0x1B]))
        bytes.append(Data("]8737;".utf8))
        bytes.append(Data(payload.utf8))
        bytes.append(Data([0x07]))
        bytes.append(Data("after".utf8))

        continuation?.yield(NativeRuntime.PaneStreamEnvelope(
            paneID: "pane-host-osc",
            streamID: "stream-pane-host-osc",
            kind: .output,
            sequence: 31,
            bytes: bytes
        ))

        try await nativeHostOSCWaitUntil {
            host.terminalView.captureLastLines(maxLines: nil).text.contains("beforeafter")
        }
        #expect(!host.terminalView.captureLastLines(maxLines: nil).text.contains("com.fenrir.agent.presence.v1"))
        try await nativeHostOSCWaitUntilStoredSequence(
            store: viewportStore,
            viewportID: "viewport-host-osc",
            sequence: 31
        )

        let records = try await AgentIntegration.ListAgentPresence(store: presenceStore, clock: clock)
            .run(.init(requestID: "list-presence", workspaceID: "workspace-a", source: .test))
            .get()
        #expect(records.records.count == 1)
        guard let record = records.records.first else {
            Issue.record("Expected exactly one presence record")
            continuation?.finish()
            return
        }
        #expect(record.agentID == .codex)
        #expect(record.state == .busy)
        #expect(record.sequence == 31)
        #expect(record.provenance.workspaceID == "workspace-a")
        #expect(record.provenance.tabID == "window-a")
        #expect(record.provenance.paneID == "pane-host-osc")
        #expect(record.provenance.viewportID == "viewport-host-osc")
        #expect(record.provenance.kind == .terminalViewportForwardedOSC)
        continuation?.finish()
    }
}


private func nativeHostOSCPaneGridState(streamID: StreamID) -> PaneGrid.State {
    let pane = PaneGrid.PanePresentation(
        paneID: "pane-host-osc",
        tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: "%101"),
        streamID: streamID,
        viewportID: "viewport-host-osc",
        title: "host-osc",
        rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 120, rows: 36),
        isFocused: true
    )
    return PaneGrid.State(
        workspaceID: "workspace-a",
        tmuxSessionID: "tmux-session-a",
        activeWindowID: "window-a",
        windows: [
            PaneGrid.WindowPresentation(
                windowID: "window-a",
                tmuxWindowID: "tmux-window-a",
                index: 0,
                title: "main",
                root: .pane(pane),
                activePaneID: "pane-host-osc",
                panes: [pane]
            )
        ]
    )
}

@MainActor
private func nativeHostOSCWaitUntil(
    timeoutNanoseconds: UInt64 = 1_000_000_000,
    condition: @escaping @MainActor () -> Bool
) async throws {
    let deadline = DispatchTime.now().uptimeNanoseconds + timeoutNanoseconds
    while !condition() {
        if DispatchTime.now().uptimeNanoseconds >= deadline {
            Issue.record("Timed out waiting for condition")
            return
        }
        try await Task.sleep(nanoseconds: 5_000_000)
    }
}

private func nativeHostOSCWaitUntilStoredSequence(
    store: NativeAppTerminalViewportStore,
    viewportID: ViewportID,
    sequence: UInt64,
    timeoutNanoseconds: UInt64 = 1_000_000_000
) async throws {
    let deadline = DispatchTime.now().uptimeNanoseconds + timeoutNanoseconds
    while true {
        let state = try await store.loadViewport(viewportID: viewportID)
        if state?.lastAppliedSequence == sequence {
            return
        }
        if DispatchTime.now().uptimeNanoseconds >= deadline {
            Issue.record("Timed out waiting for viewport sequence \(sequence)")
            return
        }
        try await Task.sleep(nanoseconds: 5_000_000)
    }
}

@MainActor
private final class NativeHostOSCRecordingTerminalBackend: FenrirTerminalBackend {
    let descriptor = TerminalViewport.RendererDescriptor(rendererID: "native-host-osc-recording-terminal", status: .ready)
    private(set) var outputs: [Data] = []
    private(set) var renderedText = ""

    func mount(in hostView: NSView) { _ = hostView }
    func unmount() {}
    func attach(streamID: StreamID) { _ = streamID }
    func detach(streamID: StreamID) { _ = streamID }

    func applyOutput(_ bytes: Data) {
        outputs.append(bytes)
        renderedText += String(decoding: bytes, as: UTF8.self)
    }

    func sendUserInput(_ bytes: Data) { _ = bytes }
    func resize(_ size: TerminalViewport.Size) { _ = size }
    func setFocused(_ focused: Bool) { _ = focused }
    func captureSelection() -> TerminalViewport.CapturedTextBuffer { .init(text: "") }
    func captureViewport() -> TerminalViewport.CapturedTextBuffer { .init(text: renderedText) }
    func captureLastLines(maxLines: Int?) -> TerminalViewport.CapturedTextBuffer {
        _ = maxLines
        return .init(text: renderedText)
    }
}
