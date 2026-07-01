import Foundation
import Testing
import FenrirNativeShared
@testable import TerminalViewport

@Suite("TerminalViewport actions")
struct TerminalViewportTests {
    @Test("CreateTerminalViewport maps renderer adapter failure")
    func createViewportMapsRendererFailure() async {
        let action = TerminalViewport.CreateTerminalViewport(
            store: TerminalStore(),
            rendererHost: RendererHost(createResult: .failure(TestError.failed)),
            clock: FixedClock()
        )

        let result = await action.run(createInput())

        #expect(result == .failure(TerminalViewport.TerminalViewportError.createFailed))
    }

    @Test("IngestTerminalOutput applies bytes and rejects out-of-order stream chunks")
    func ingestTerminalOutputValidatesStreamOrder() async throws {
        let store = TerminalStore()
        let renderer = RendererWriter()
        try await store.saveViewport(state(streamID: "stream-1"))
        let action = TerminalViewport.IngestTerminalOutput(store: store, rendererWriter: renderer, clock: FixedClock())

        let result = try await action.run(outputInput(sequence: 1, bytes: Data("one".utf8))).get()
        let outOfOrder = await action.run(outputInput(sequence: 3, bytes: Data("three".utf8)))

        #expect(result.appliedSequence == 1)
        #expect(await renderer.ingested == [Data("one".utf8)])
        #expect(outOfOrder == .failure(TerminalViewport.TerminalViewportError.streamOrderViolation))
    }

    @Test("ResizeTerminalViewport propagates valid dimensions to runtime and renderer")
    func resizeViewportPropagatesResize() async throws {
        let store = TerminalStore()
        let renderer = RendererSizer()
        let runtime = RuntimeResizer()
        try await store.saveViewport(state())
        let action = TerminalViewport.ResizeTerminalViewport(
            store: store,
            rendererSizer: renderer,
            runtimeResizer: runtime,
            clock: FixedClock()
        )
        let size = TerminalViewport.Size(columns: 100, rows: 32, pixelWidth: 1200, pixelHeight: 800)

        let result = try await action.run(resizeInput(size: size)).get()

        #expect(result.state.size == size)
        #expect(await runtime.requests.map(\.size) == [size])
        #expect(await renderer.requests == [size])
    }

    @Test("ResizeTerminalViewport rejects invalid dimensions before crossing ports")
    func resizeViewportRejectsInvalidDimensions() async throws {
        let store = TerminalStore()
        let renderer = RendererSizer()
        let runtime = RuntimeResizer()
        try await store.saveViewport(state())
        let action = TerminalViewport.ResizeTerminalViewport(store: store, rendererSizer: renderer, runtimeResizer: runtime, clock: FixedClock())

        let result = await action.run(resizeInput(size: TerminalViewport.Size(columns: 0, rows: 24, pixelWidth: 800, pixelHeight: 600)))

        #expect(result == .failure(TerminalViewport.TerminalViewportError.invalidDimensions))
        #expect(await runtime.requests.isEmpty)
        #expect(await renderer.requests.isEmpty)
    }

    @Test("SendTerminalInput preserves stable request id across runtime write")
    func sendTerminalInputPreservesRequestID() async throws {
        let store = TerminalStore()
        let writer = RuntimeWriter()
        try await store.saveViewport(state())
        let action = TerminalViewport.SendTerminalInput(store: store, runtimeWriter: writer, clock: FixedClock())

        let result = try await action.run(inputRequest()).get()

        #expect(result.requestID == "terminal-write-1")
        #expect(result.acknowledgement.requestID == "terminal-write-1")
        #expect(await writer.requests.map(\.requestID) == ["terminal-write-1"])
    }

    @Test("SendTerminalInput rejects pane identity mismatch")
    func sendTerminalInputRejectsPaneMismatch() async throws {
        let store = TerminalStore()
        try await store.saveViewport(state(paneID: "pane-2"))
        let action = TerminalViewport.SendTerminalInput(store: store, runtimeWriter: RuntimeWriter(), clock: FixedClock())

        let result = await action.run(inputRequest())

        #expect(result == .failure(TerminalViewport.TerminalViewportError.paneIdentityMismatch))
    }

    @Test("Focus and snapshot expose renderer-free viewport state")
    func focusAndSnapshotExposeState() async throws {
        let store = TerminalStore()
        let renderer = RendererHost()
        try await store.saveViewport(state())

        let focus = TerminalViewport.FocusTerminalViewport(store: store, rendererHost: renderer, clock: FixedClock())
        let snapshot = TerminalViewport.SnapshotTerminalViewport(store: store, clock: FixedClock())

        let focused = try await focus.run(TerminalViewport.FocusTerminalViewportInput(requestID: "focus", viewportID: "viewport-1", paneID: "pane-1", focused: true, source: .test)).get()
        let snapshotted = try await snapshot.run(TerminalViewport.SnapshotTerminalViewportInput(requestID: "snapshot", viewportID: "viewport-1", paneID: "pane-1", source: .test)).get()

        #expect(focused.state.isFocused)
        #expect(snapshotted.state.isFocused)
        #expect(await renderer.focusRequests == [true])
    }

    @Test("TerminalViewport source has no direct NativeRuntime layer dependency")
    func terminalViewportDoesNotImportNativeRuntimeLayers() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/FenrirNativeFoundation/Modules/TerminalViewport")
        let swiftFiles = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)?
            .compactMap { $0 as? URL }
            .filter { $0.pathExtension == "swift" } ?? []
        let source = try swiftFiles.map { try String(contentsOf: $0, encoding: .utf8) }.joined(separator: "\n")

        #expect(!source.contains("NativeRuntime/Layers"))
        #expect(!source.contains("import NativeRuntime"))
    }
}

private func createInput() -> TerminalViewport.CreateTerminalViewportInput {
    TerminalViewport.CreateTerminalViewportInput(
        requestID: "create",
        viewportID: "viewport-1",
        workspaceID: "workspace-1",
        paneID: "pane-1",
        size: TerminalViewport.Size(columns: 80, rows: 24, pixelWidth: 800, pixelHeight: 600),
        source: .test
    )
}

private func inputRequest() -> TerminalViewport.SendTerminalInputInput {
    TerminalViewport.SendTerminalInputInput(
        requestID: "terminal-write-1",
        viewportID: "viewport-1",
        workspaceID: "workspace-1",
        paneID: "pane-1",
        inputBytes: Data("echo ok\n".utf8),
        inputMode: .normal,
        source: .terminalViewport
    )
}

private func outputInput(sequence: UInt64, bytes: Data) -> TerminalViewport.IngestTerminalOutputInput {
    TerminalViewport.IngestTerminalOutputInput(
        requestID: RequestID(rawValue: "output-\(sequence)"),
        viewportID: "viewport-1",
        paneID: "pane-1",
        streamID: "stream-1",
        sequence: sequence,
        bytes: bytes,
        source: .test
    )
}

private func resizeInput(size: TerminalViewport.Size) -> TerminalViewport.ResizeTerminalViewportInput {
    TerminalViewport.ResizeTerminalViewportInput(
        requestID: "resize",
        viewportID: "viewport-1",
        workspaceID: "workspace-1",
        paneID: "pane-1",
        size: size,
        source: .test
    )
}

private func state(paneID: PaneID = "pane-1", streamID: StreamID? = nil) -> TerminalViewport.State {
    TerminalViewport.State(
        viewportID: "viewport-1",
        workspaceID: "workspace-1",
        paneID: paneID,
        streamID: streamID,
        rendererStatus: .ready,
        streamStatus: streamID == nil ? .detached : .attached
    )
}

private enum TestError: Error {
    case failed
}

private actor TerminalStore: TerminalViewport.TerminalViewportStore {
    private var states: [ViewportID: TerminalViewport.State] = [:]

    func loadViewport(viewportID: ViewportID) async throws -> TerminalViewport.State? {
        states[viewportID]
    }

    func saveViewport(_ state: TerminalViewport.State) async throws {
        states[state.viewportID] = state
    }

    func deleteViewport(viewportID: ViewportID) async throws {
        states[viewportID] = nil
    }
}

private actor RendererHost: TerminalViewport.TerminalRendererHosting {
    private let createResult: Result<TerminalViewport.RendererDescriptor, Error>
    private(set) var focusRequests: [Bool] = []

    init(createResult: Result<TerminalViewport.RendererDescriptor, Error> = .success(TerminalViewport.RendererDescriptor(rendererID: "renderer-1", status: .ready))) {
        self.createResult = createResult
    }

    func createRenderer(_ input: TerminalViewport.CreateTerminalViewportInput) async throws -> TerminalViewport.RendererDescriptor {
        try createResult.get()
    }

    func destroyRenderer(viewportID: ViewportID) async throws {}

    func focusRenderer(viewportID: ViewportID, focused: Bool) async throws {
        focusRequests.append(focused)
    }
}

private actor RendererWriter: TerminalViewport.TerminalRendererWriting {
    private(set) var ingested: [Data] = []

    func ingestOutput(viewportID: ViewportID, bytes: Data) async throws {
        ingested.append(bytes)
    }
}

private actor RendererSizer: TerminalViewport.TerminalRendererSizing {
    private(set) var requests: [TerminalViewport.Size] = []

    func resizeRenderer(viewportID: ViewportID, size: TerminalViewport.Size) async throws {
        requests.append(size)
    }
}

private actor RuntimeWriter: TerminalViewport.TerminalRuntimeWriting {
    private(set) var requests: [TerminalViewport.SendTerminalInputInput] = []

    func writeTerminalInput(_ input: TerminalViewport.SendTerminalInputInput) async throws -> TerminalViewport.RuntimeWriteAcknowledgement {
        requests.append(input)
        return TerminalViewport.RuntimeWriteAcknowledgement(
            requestID: input.requestID,
            paneID: input.paneID,
            status: .accepted,
            inputSequence: 7
        )
    }
}

private actor RuntimeResizer: TerminalViewport.TerminalRuntimeResizing {
    private(set) var requests: [TerminalViewport.ResizeTerminalViewportInput] = []

    func resizeTerminalPane(_ input: TerminalViewport.ResizeTerminalViewportInput) async throws -> TerminalViewport.RuntimeResizeAcknowledgement {
        requests.append(input)
        return TerminalViewport.RuntimeResizeAcknowledgement(requestID: input.requestID, paneID: input.paneID, status: .accepted, size: input.size)
    }
}
