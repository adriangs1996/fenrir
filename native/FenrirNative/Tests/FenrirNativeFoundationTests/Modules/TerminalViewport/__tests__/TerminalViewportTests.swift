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

    @Test("Stale chunks at or below the watermark are silently dropped, never re-applied")
    func ingestDropsStaleReplayedChunks() async throws {
        let store = TerminalStore()
        let renderer = RendererWriter()
        try await store.saveViewport(state(streamID: "stream-1"))
        let ingest = TerminalViewport.IngestTerminalOutput(store: store, rendererWriter: renderer, clock: FixedClock())
        let batch = TerminalViewport.IngestTerminalOutputBatch(store: store, rendererWriter: renderer, clock: FixedClock())

        _ = try await ingest.run(outputInput(sequence: 1, bytes: Data("one".utf8))).get()
        _ = try await ingest.run(outputInput(sequence: 2, bytes: Data("two".utf8))).get()

        // A replayed single chunk (backfill overlap) is a no-op success.
        let replayed = try await ingest.run(outputInput(sequence: 2, bytes: Data("two".utf8))).get()
        #expect(replayed.appliedSequence == 2)
        #expect(await renderer.ingested == [Data("one".utf8), Data("two".utf8)])

        // A batch straddling the watermark applies only the fresh tail.
        let straddling = try await batch.run(TerminalViewport.IngestTerminalOutputBatchInput(
            requestID: "batch-straddle",
            viewportID: "viewport-1",
            paneID: "pane-1",
            streamID: "stream-1",
            chunks: [
                TerminalViewport.TerminalOutputChunk(sequence: 1, bytes: Data("one".utf8)),
                TerminalViewport.TerminalOutputChunk(sequence: 2, bytes: Data("two".utf8)),
                TerminalViewport.TerminalOutputChunk(sequence: 3, bytes: Data("three".utf8)),
            ],
            source: .test
        )).get()
        #expect(straddling.appliedSequence == 3)
        #expect(straddling.chunkCount == 1)
        #expect(await renderer.ingested == [Data("one".utf8), Data("two".utf8), Data("three".utf8)])

        // A fully stale batch is a no-op success at the current watermark.
        let stale = try await batch.run(TerminalViewport.IngestTerminalOutputBatchInput(
            requestID: "batch-stale",
            viewportID: "viewport-1",
            paneID: "pane-1",
            streamID: "stream-1",
            chunks: [TerminalViewport.TerminalOutputChunk(sequence: 2, bytes: Data("two".utf8))],
            source: .test
        )).get()
        #expect(stale.appliedSequence == 3)
        #expect(stale.chunkCount == 0)
        #expect(await renderer.ingested == [Data("one".utf8), Data("two".utf8), Data("three".utf8)])
    }

    @Test("HandleTerminalStreamGap resets the sequence watermark and pending buffers so post-gap chunks apply")
    func handleTerminalStreamGapRecoversFromDrops() async throws {
        let store = TerminalStore()
        let renderer = RendererWriter()
        try await store.saveViewport(state(streamID: "stream-1"))
        let ingest = TerminalViewport.IngestTerminalOutput(store: store, rendererWriter: renderer, clock: FixedClock())
        let gap = TerminalViewport.HandleTerminalStreamGap(store: store, clock: FixedClock())

        _ = try await ingest.run(outputInput(sequence: 1, bytes: Data("one".utf8))).get()
        // Leave a partially buffered reserved OSC whose remainder was lost with the gap.
        _ = try await ingest.run(outputInput(sequence: 2, bytes: Data("\u{1B}]\(TerminalViewport.fenrirReservedOSCIdentifier);partial".utf8))).get()

        let acknowledged = try await gap.run(gapInput()).get()
        #expect(acknowledged.state.lastAppliedSequence == nil)
        #expect(acknowledged.state.pendingReservedOSCSequence.isEmpty)

        let resumed = try await ingest.run(outputInput(sequence: 7, bytes: Data("after".utf8))).get()
        #expect(resumed.appliedSequence == 7)
        #expect(await renderer.ingested.last == Data("after".utf8))
    }

    @Test("IngestTerminalOutput strips and forwards reserved OSC terminated by BEL")
    func ingestTerminalOutputStripsAndForwardsReservedOSCBEL() async throws {
        let store = TerminalStore()
        let renderer = RendererWriter()
        let forwarder = ReservedOSCForwarder()
        try await store.saveViewport(state(tabID: "tab-1", streamID: "stream-1"))
        let action = TerminalViewport.IngestTerminalOutput(
            store: store,
            rendererWriter: renderer,
            reservedOSCForwarder: forwarder,
            clock: FixedClock()
        )

        _ = try await action.run(outputInput(sequence: 1, bytes: reservedOSC(payload: "busy", terminator: .bel, prefix: "before", suffix: "after"))).get()

        #expect(await renderer.ingested == [Data("before".utf8), Data("after".utf8)])
        let signals = await forwarder.signals
        #expect(signals.map(\.oscIdentifier) == [TerminalViewport.fenrirReservedOSCIdentifier])
        #expect(signals.map(\.payload) == ["busy"])
        #expect(signals.first?.provenance.workspaceID == "workspace-1")
        #expect(signals.first?.provenance.tabID == "tab-1")
        #expect(signals.first?.provenance.paneID == "pane-1")
        #expect(signals.first?.provenance.viewportID == "viewport-1")
        #expect(signals.first?.provenance.streamID == "stream-1")
        #expect(signals.first?.provenance.sequence == 1)
    }

    @Test("IngestTerminalOutput applies reserved OSC operations in stream order")
    func ingestTerminalOutputAppliesReservedOSCOperationsInStreamOrder() async throws {
        let store = TerminalStore()
        let recorder = TerminalOperationRecorder()
        let renderer = RendererWriter(recorder: recorder)
        let forwarder = ReservedOSCForwarder(recorder: recorder)
        try await store.saveViewport(state(streamID: "stream-1"))
        let action = TerminalViewport.IngestTerminalOutput(
            store: store,
            rendererWriter: renderer,
            reservedOSCForwarder: forwarder,
            clock: FixedClock()
        )

        _ = try await action.run(outputInput(sequence: 1, bytes: reservedOSC(payload: "busy", terminator: .bel, prefix: "before", suffix: "after"))).get()

        #expect(await recorder.operations == [
            .renderer(Data("before".utf8)),
            .signal("busy"),
            .renderer(Data("after".utf8))
        ])
    }

    @Test("IngestTerminalOutput strips and forwards reserved OSC terminated by ST")
    func ingestTerminalOutputStripsAndForwardsReservedOSCST() async throws {
        let store = TerminalStore()
        let renderer = RendererWriter()
        let forwarder = ReservedOSCForwarder()
        try await store.saveViewport(state(streamID: "stream-1"))
        let action = TerminalViewport.IngestTerminalOutput(
            store: store,
            rendererWriter: renderer,
            reservedOSCForwarder: forwarder,
            clock: FixedClock()
        )

        _ = try await action.run(outputInput(sequence: 1, bytes: reservedOSC(payload: #"{"state":"done"}"#, terminator: .st, prefix: "left", suffix: "right"))).get()

        #expect(await renderer.ingested == [Data("left".utf8), Data("right".utf8)])
        #expect(await forwarder.signals.map(\.payload) == [#"{"state":"done"}"#])
    }

    @Test("IngestTerminalOutput preserves non-reserved OSC bytes for renderer")
    func ingestTerminalOutputPreservesNormalOSC() async throws {
        let store = TerminalStore()
        let renderer = RendererWriter()
        let forwarder = ReservedOSCForwarder()
        try await store.saveViewport(state(streamID: "stream-1"))
        let action = TerminalViewport.IngestTerminalOutput(
            store: store,
            rendererWriter: renderer,
            reservedOSCForwarder: forwarder,
            clock: FixedClock()
        )
        let bytes = Data("x\u{1B}]999;normal\u{7}y".utf8)

        _ = try await action.run(outputInput(sequence: 1, bytes: bytes)).get()

        #expect(await renderer.ingested == [bytes])
        #expect(await forwarder.signals.isEmpty)
    }

    @Test("IngestTerminalOutputBatch buffers split reserved OSC and forwards exactly once")
    func ingestTerminalOutputBatchBuffersSplitReservedOSC() async throws {
        let store = TerminalStore()
        let renderer = RendererWriter()
        let forwarder = ReservedOSCForwarder()
        try await store.saveViewport(state(streamID: "stream-1"))
        let action = TerminalViewport.IngestTerminalOutputBatch(
            store: store,
            rendererWriter: renderer,
            reservedOSCForwarder: forwarder,
            clock: FixedClock()
        )
        let prefix = Data("A\u{1B}]8737;part".utf8)
        let suffix = Data("ial\u{7}B".utf8)

        let result = try await action.run(TerminalViewport.IngestTerminalOutputBatchInput(
            requestID: "batch",
            viewportID: "viewport-1",
            paneID: "pane-1",
            streamID: "stream-1",
            chunks: [
                TerminalViewport.TerminalOutputChunk(sequence: 1, bytes: prefix),
                TerminalViewport.TerminalOutputChunk(sequence: 2, bytes: suffix)
            ],
            policy: .init(maxChunksPerBatch: 4, maxBytesPerBatch: 128, maxBytesPerRendererWrite: 128),
            source: .test
        )).get()

        #expect(result.appliedSequence == 2)
        #expect(await renderer.ingested == [Data("A".utf8), Data("B".utf8)])
        #expect(await forwarder.signals.map(\.payload) == ["partial"])
    }

    @Test("IngestTerminalOutput ignores advisory reserved OSC forwarder failure and commits sequence")
    func ingestTerminalOutputIgnoresReservedOSCForwarderFailureAndCommitsSequence() async throws {
        let store = TerminalStore()
        let renderer = RendererWriter()
        let forwarder = ReservedOSCForwarder(throwAfterForwardCount: 1)
        try await store.saveViewport(state(streamID: "stream-1"))
        let action = TerminalViewport.IngestTerminalOutput(
            store: store,
            rendererWriter: renderer,
            reservedOSCForwarder: forwarder,
            clock: FixedClock()
        )
        let input = outputInput(sequence: 1, bytes: reservedOSC(payload: "presence", terminator: .bel, prefix: "before", suffix: "after"))

        let result = try await action.run(input).get()
        let retry = await action.run(input)

        #expect(result.appliedSequence == 1)
        #expect(result.state.lastAppliedSequence == 1)
        #expect((try await store.loadViewport(viewportID: "viewport-1"))?.lastAppliedSequence == 1)
        #expect(await renderer.ingested == [Data("before".utf8), Data("after".utf8)])
        #expect(await forwarder.signals.map(\.payload) == ["presence"])
        // A replayed chunk is a no-op success (idempotent dedup) — and above
        // all it must NOT re-render bytes or re-forward the signal.
        #expect(try retry.get().appliedSequence == 1)
        #expect(await renderer.ingested == [Data("before".utf8), Data("after".utf8)])
        #expect(await forwarder.signals.map(\.payload) == ["presence"])
    }

    @Test("Reserved OSC event summary omits raw payload text")
    func reservedOSCEventSummaryOmitsPayload() async throws {
        let store = TerminalStore()
        let renderer = RendererWriter()
        let forwarder = ReservedOSCForwarder()
        let events = TerminalEventCollector()
        try await store.saveViewport(state(streamID: "stream-1"))
        let action = TerminalViewport.IngestTerminalOutput(
            store: store,
            rendererWriter: renderer,
            reservedOSCForwarder: forwarder,
            clock: FixedClock(),
            events: events
        )

        _ = try await action.run(outputInput(sequence: 1, bytes: reservedOSC(payload: "secret-payload", terminator: .bel))).get()

        let published = await events.published
        #expect(published.map(\.eventKind) == ["ReservedOSCForwarded", "TerminalOutputIngested"])
        #expect(!String(describing: published).contains("secret-payload"))
        guard case let .reservedOSCForwarded(summary) = published.first?.event else {
            Issue.record("Expected reservedOSCForwarded event")
            return
        }
        #expect(summary.oscIdentifier == TerminalViewport.fenrirReservedOSCIdentifier)
        #expect(summary.payloadByteCount == "secret-payload".utf8.count)
        #expect(summary.provenance.sequence == 1)
    }

    @Test("IngestTerminalOutput fails boundedly when pending reserved OSC exceeds limit")
    func ingestTerminalOutputRejectsOverlongPendingReservedOSC() async throws {
        let store = TerminalStore()
        let renderer = RendererWriter()
        let forwarder = ReservedOSCForwarder()
        try await store.saveViewport(state(streamID: "stream-1"))
        let action = TerminalViewport.IngestTerminalOutput(
            store: store,
            rendererWriter: renderer,
            reservedOSCForwarder: forwarder,
            clock: FixedClock()
        )
        let payload = String(repeating: "x", count: TerminalViewport.maxPendingReservedOSCSequenceBytes + 1)
        let bytes = Data("\u{1B}]\(TerminalViewport.fenrirReservedOSCIdentifier);\(payload)".utf8)

        let result = await action.run(outputInput(sequence: 1, bytes: bytes))

        #expect(result == .failure(TerminalViewport.TerminalViewportError.outputBackpressure))
        #expect(await renderer.ingested.isEmpty)
        #expect(await forwarder.signals.isEmpty)
    }

    @Test("IngestTerminalOutputBatch coalesces contiguous high-volume chunks before renderer writes")
    func ingestTerminalOutputBatchCoalescesHighVolumeChunks() async throws {
        let store = TerminalStore()
        let renderer = RendererWriter()
        try await store.saveViewport(state(streamID: "stream-1"))
        let action = TerminalViewport.IngestTerminalOutputBatch(store: store, rendererWriter: renderer, clock: FixedClock())
        let chunks = (1...100).map { sequence in
            TerminalViewport.TerminalOutputChunk(sequence: UInt64(sequence), bytes: Data("x".utf8))
        }

        let result = try await action.run(TerminalViewport.IngestTerminalOutputBatchInput(
            requestID: "batch",
            viewportID: "viewport-1",
            paneID: "pane-1",
            streamID: "stream-1",
            chunks: chunks,
            policy: .init(maxChunksPerBatch: 128, maxBytesPerBatch: 256, maxBytesPerRendererWrite: 256),
            source: .test
        )).get()

        #expect(result.appliedSequence == 100)
        #expect(result.chunkCount == 100)
        #expect(result.rendererWriteCount == 1)
        #expect(await renderer.ingested == [Data(String(repeating: "x", count: 100).utf8)])
    }

    @Test("IngestTerminalOutputBatch splits oversized single chunks by renderer write cap")
    func ingestTerminalOutputBatchSplitsOversizedSingleChunk() async throws {
        let store = TerminalStore()
        let renderer = RendererWriter()
        try await store.saveViewport(state(streamID: "stream-1"))
        let action = TerminalViewport.IngestTerminalOutputBatch(store: store, rendererWriter: renderer, clock: FixedClock())
        let chunk = TerminalViewport.TerminalOutputChunk(
            sequence: 1,
            bytes: Data("abcdefghij".utf8)
        )

        let result = try await action.run(TerminalViewport.IngestTerminalOutputBatchInput(
            requestID: "batch",
            viewportID: "viewport-1",
            paneID: "pane-1",
            streamID: "stream-1",
            chunks: [chunk],
            policy: .init(maxChunksPerBatch: 2, maxBytesPerBatch: 16, maxBytesPerRendererWrite: 4),
            source: .test
        )).get()

        #expect(result.rendererWriteCount == 3)
        #expect(await renderer.ingested == [
            Data("abcd".utf8),
            Data("efgh".utf8),
            Data("ij".utf8)
        ])
    }

    @Test("IngestTerminalOutputBatch rejects batches past explicit backpressure limits")
    func ingestTerminalOutputBatchRejectsBackpressureLimits() async throws {
        let store = TerminalStore()
        let renderer = RendererWriter()
        try await store.saveViewport(state(streamID: "stream-1"))
        let action = TerminalViewport.IngestTerminalOutputBatch(store: store, rendererWriter: renderer, clock: FixedClock())
        let chunks = (1...3).map { sequence in
            TerminalViewport.TerminalOutputChunk(sequence: UInt64(sequence), bytes: Data("x".utf8))
        }

        let result = await action.run(TerminalViewport.IngestTerminalOutputBatchInput(
            requestID: "batch",
            viewportID: "viewport-1",
            paneID: "pane-1",
            streamID: "stream-1",
            chunks: chunks,
            policy: .init(maxChunksPerBatch: 2, maxBytesPerBatch: 256, maxBytesPerRendererWrite: 256),
            source: .test
        ))

        #expect(result == .failure(TerminalViewport.TerminalViewportError.outputBackpressure))
        #expect(await renderer.ingested.isEmpty)
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

    @Test("CaptureTerminalSelection accepts an empty buffer with provenance")
    func captureSelectionAcceptsEmptyBufferWithProvenance() async throws {
        let store = TerminalStore()
        try await store.saveViewport(state(tabID: "tab-1", streamID: "stream-1"))
        let action = TerminalViewport.CaptureTerminalSelection(
            store: store,
            reader: ContextReader(selection: .init(text: "")),
            clock: FixedClock()
        )

        let result = try await action.run(captureInput()).get()

        #expect(result.context.provenance.workspaceID == "workspace-1")
        #expect(result.context.provenance.tabID == "tab-1")
        #expect(result.context.provenance.paneID == "pane-1")
        #expect(result.context.provenance.viewportID == "viewport-1")
        #expect(result.context.provenance.streamID == "stream-1")
        #expect(result.context.text == "")
        #expect(result.context.lineCount == 0)
        #expect(result.context.characterCount == 0)
        #expect(!result.context.isTruncated)
    }

    @Test("CaptureTerminalSelection preserves multiline selection")
    func captureSelectionPreservesMultilineSelection() async throws {
        let store = TerminalStore()
        try await store.saveViewport(state(tabID: "tab-1"))
        let action = TerminalViewport.CaptureTerminalSelection(
            store: store,
            reader: ContextReader(selection: .init(text: "alpha\nbeta\ngamma")),
            clock: FixedClock()
        )

        let result = try await action.run(captureInput()).get()

        #expect(result.context.kind == .selection)
        #expect(result.context.screen == .primary)
        #expect(result.context.text == "alpha\nbeta\ngamma")
        #expect(result.context.lineCount == 3)
        #expect(result.context.characterCount == 16)
    }

    @Test("CaptureTerminalViewport identifies alternate screen content")
    func captureViewportCapturesAlternateScreen() async throws {
        let store = TerminalStore()
        try await store.saveViewport(state(tabID: "tab-1"))
        let action = TerminalViewport.CaptureTerminalViewport(
            store: store,
            reader: ContextReader(viewport: .init(text: "vim buffer\nstatus", screen: .alternate)),
            clock: FixedClock()
        )

        let result = try await action.run(captureInput()).get()

        #expect(result.context.kind == .viewport)
        #expect(result.context.screen == .alternate)
        #expect(result.context.text == "vim buffer\nstatus")
    }

    @Test("CaptureTerminalLastLines truncates large output by line and character limits")
    func captureLastLinesTruncatesLargeOutput() async throws {
        let store = TerminalStore()
        try await store.saveViewport(state(tabID: "tab-1"))
        let action = TerminalViewport.CaptureTerminalLastLines(
            store: store,
            reader: ContextReader(lastLines: .init(text: "one\ntwo\nthree\nfour")),
            clock: FixedClock()
        )

        let result = try await action.run(captureInput(limit: .init(maxLines: 2, maxCharacters: 9))).get()

        #expect(result.context.text == "hree\nfour")
        #expect(result.context.lineCount == 2)
        #expect(result.context.characterCount == 9)
        #expect(result.context.isTruncated)
    }

    @Test("CaptureTerminalViewport applies redaction hook after size bounding")
    func captureViewportAppliesRedactionHook() async throws {
        let store = TerminalStore()
        try await store.saveViewport(state(tabID: "tab-1"))
        let action = TerminalViewport.CaptureTerminalViewport(
            store: store,
            reader: ContextReader(viewport: .init(text: "token=SECRET")),
            redactor: ContextRedactor(replacements: ["SECRET": "[REDACTED]"], labels: ["secret"]),
            clock: FixedClock()
        )

        let result = try await action.run(captureInput()).get()

        #expect(result.context.text == "token=[REDACTED]")
        #expect(result.context.redactionReport == .init(replacementCount: 1, labels: ["secret"]))
    }

    @Test("CaptureTerminalViewport rejects stale pane provenance")
    func captureViewportRejectsStalePane() async throws {
        let store = TerminalStore()
        try await store.saveViewport(state(tabID: "tab-other"))
        let action = TerminalViewport.CaptureTerminalViewport(
            store: store,
            reader: ContextReader(viewport: .init(text: "stale")),
            clock: FixedClock()
        )

        let result = await action.run(captureInput())

        #expect(result == .failure(TerminalViewport.TerminalViewportError.paneIdentityMismatch))
    }

    @Test("CaptureTerminalViewport event summary omits captured content")
    func captureViewportEventSummaryOmitsCapturedContent() async throws {
        let store = TerminalStore()
        let events = TerminalEventCollector()
        try await store.saveViewport(state(tabID: "tab-1"))
        let action = TerminalViewport.CaptureTerminalViewport(
            store: store,
            reader: ContextReader(viewport: .init(text: "secret terminal content")),
            clock: FixedClock(),
            events: events
        )

        _ = try await action.run(captureInput()).get()

        let published = await events.published
        #expect(published.map(\.eventKind) == ["TerminalContextCaptured"])
        #expect(!String(describing: published).contains("secret terminal content"))
        guard case let .terminalContextCaptured(summary) = published.first?.event else {
            Issue.record("Expected terminalContextCaptured event")
            return
        }
        #expect(summary.provenance.tabID == "tab-1")
        #expect(summary.characterCount == 23)
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

private func gapInput() -> TerminalViewport.HandleTerminalStreamGapInput {
    TerminalViewport.HandleTerminalStreamGapInput(
        requestID: "gap",
        viewportID: "viewport-1",
        paneID: "pane-1",
        streamID: "stream-1",
        source: .test
    )
}

private enum OSCTerminator {
    case bel
    case st
}

private func reservedOSC(payload: String, terminator: OSCTerminator, prefix: String = "", suffix: String = "") -> Data {
    let terminatorBytes: String
    switch terminator {
    case .bel:
        terminatorBytes = "\u{7}"
    case .st:
        terminatorBytes = "\u{1B}\\"
    }
    return Data("\(prefix)\u{1B}]\(TerminalViewport.fenrirReservedOSCIdentifier);\(payload)\(terminatorBytes)\(suffix)".utf8)
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

private func captureInput(limit: TerminalViewport.CaptureLimit = .init(maxCharacters: 100)) -> TerminalViewport.CaptureTerminalContextInput {
    TerminalViewport.CaptureTerminalContextInput(
        requestID: "capture",
        viewportID: "viewport-1",
        workspaceID: "workspace-1",
        tabID: "tab-1",
        paneID: "pane-1",
        limit: limit,
        source: .test
    )
}

private func state(paneID: PaneID = "pane-1", tabID: FenrirWindowID? = nil, streamID: StreamID? = nil) -> TerminalViewport.State {
    TerminalViewport.State(
        viewportID: "viewport-1",
        workspaceID: "workspace-1",
        tabID: tabID,
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

private enum RecordedTerminalOperation: Equatable {
    case renderer(Data)
    case signal(String)
}

private actor TerminalOperationRecorder {
    private(set) var operations: [RecordedTerminalOperation] = []

    func record(_ operation: RecordedTerminalOperation) {
        operations.append(operation)
    }
}

private actor RendererWriter: TerminalViewport.TerminalRendererWriting {
    private(set) var ingested: [Data] = []
    private let recorder: TerminalOperationRecorder?

    init(recorder: TerminalOperationRecorder? = nil) {
        self.recorder = recorder
    }

    func ingestOutput(viewportID: ViewportID, bytes: Data) async throws {
        ingested.append(bytes)
        await recorder?.record(.renderer(bytes))
    }
}

private actor ReservedOSCForwarder: TerminalViewport.TerminalReservedOSCForwarding {
    private(set) var signals: [TerminalViewport.ReservedOSCSignal] = []
    private let recorder: TerminalOperationRecorder?
    private let throwAfterForwardCount: Int?

    init(recorder: TerminalOperationRecorder? = nil, throwAfterForwardCount: Int? = nil) {
        self.recorder = recorder
        self.throwAfterForwardCount = throwAfterForwardCount
    }

    func forwardReservedOSC(_ signal: TerminalViewport.ReservedOSCSignal) async throws {
        signals.append(signal)
        await recorder?.record(.signal(signal.payload))
        if let throwAfterForwardCount, signals.count >= throwAfterForwardCount {
            throw TestError.failed
        }
    }
}

private actor RendererSizer: TerminalViewport.TerminalRendererSizing {
    private(set) var requests: [TerminalViewport.Size] = []

    func resizeRenderer(viewportID: ViewportID, size: TerminalViewport.Size) async throws {
        requests.append(size)
    }
}

private actor ContextReader: TerminalViewport.TerminalRendererContextReading {
    let selection: TerminalViewport.CapturedTextBuffer
    let viewport: TerminalViewport.CapturedTextBuffer
    let lastLines: TerminalViewport.CapturedTextBuffer
    private(set) var lastLinesRequests: [Int?] = []

    init(
        selection: TerminalViewport.CapturedTextBuffer = .init(text: ""),
        viewport: TerminalViewport.CapturedTextBuffer = .init(text: ""),
        lastLines: TerminalViewport.CapturedTextBuffer = .init(text: "")
    ) {
        self.selection = selection
        self.viewport = viewport
        self.lastLines = lastLines
    }

    func readSelection(viewportID: ViewportID) async throws -> TerminalViewport.CapturedTextBuffer {
        selection
    }

    func readViewport(viewportID: ViewportID) async throws -> TerminalViewport.CapturedTextBuffer {
        viewport
    }

    func readLastLines(viewportID: ViewportID, maxLines: Int?) async throws -> TerminalViewport.CapturedTextBuffer {
        lastLinesRequests.append(maxLines)
        return lastLines
    }
}

private struct ContextRedactor: TerminalViewport.TerminalContextRedacting {
    let replacements: [String: String]
    let labels: [String]

    init(replacements: [String: String], labels: [String]) {
        self.replacements = replacements
        self.labels = labels
    }

    func redactTerminalContext(_ context: TerminalViewport.CapturedContext) async throws -> TerminalViewport.RedactedCapture {
        var text = context.text
        var count = 0
        for (needle, replacement) in replacements {
            let original = text
            text = text.replacingOccurrences(of: needle, with: replacement)
            if text != original {
                count += 1
            }
        }
        return TerminalViewport.RedactedCapture(text: text, report: .init(replacementCount: count, labels: labels))
    }
}

private actor TerminalEventCollector: TerminalViewport.TerminalViewportEventPublishing {
    private(set) var published: [EventEnvelope<TerminalViewport.Event>] = []

    func publish(_ event: EventEnvelope<TerminalViewport.Event>) async {
        published.append(event)
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
