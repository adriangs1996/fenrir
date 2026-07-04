import Foundation
import Testing
import FenrirNativeShared
@testable import TerminalViewport

@Suite("TerminalViewport kitty OSC 99 chunk reassembly (D-043)")
struct KittyNotificationChunkingTests {
    @Test("Two-chunk kitty notification reassembles into a single notification")
    func twoChunkNotificationReassemblesOnce() async throws {
        let harness = try await Harness()

        let first = try await harness.ingest(sequence: 1, bytes: osc99("i=7:d=1;Hello "))
        #expect(await harness.notifications.events.isEmpty)
        #expect(first.state.pendingKittyNotificationChunks == [
            TerminalViewport.PendingKittyNotificationChunk(chunkID: "7", body: "Hello ")
        ])

        let second = try await harness.ingest(sequence: 2, bytes: osc99("i=7:d=0;world"))

        #expect(await harness.notifications.events.map(\.body) == ["Hello world"])
        #expect(await harness.notifications.events.map(\.title) == [nil])
        #expect(second.state.pendingKittyNotificationChunks.isEmpty)
        // Both chunk sequences are stripped from the render stream.
        #expect(await harness.renderer.ingested.isEmpty)
    }

    @Test("Chunked title and body merge into one notification on finalize")
    func chunkedTitleAndBodyMerge() async throws {
        let harness = try await Harness()

        _ = try await harness.ingest(sequence: 1, bytes: osc99("i=a:d=1:p=title;Deploy"))
        _ = try await harness.ingest(sequence: 2, bytes: osc99("i=a:d=0;service is live"))

        let notifications = await harness.notifications.events
        #expect(notifications.map(\.title) == ["Deploy"])
        #expect(notifications.map(\.body) == ["service is live"])
        #expect(notifications.map(\.source) == [.osc99])
    }

    @Test("Absent d finalizes a pending id by merging the final chunk")
    func absentDoneFlagFinalizesPendingID() async throws {
        let harness = try await Harness()

        _ = try await harness.ingest(sequence: 1, bytes: osc99("i=x:d=1;part-"))
        _ = try await harness.ingest(sequence: 2, bytes: osc99("i=x;two"))

        #expect(await harness.notifications.events.map(\.body) == ["part-two"])
    }

    @Test("Single-chunk kitty payloads are unchanged by the chunking path")
    func singleChunkPayloadsUnchanged() async throws {
        let harness = try await Harness()

        let result = try await harness.ingest(sequence: 1, bytes: osc99("i=1:d=0;job done"))
        _ = try await harness.ingest(sequence: 2, bytes: osc99("p=title;Job Title"))

        let notifications = await harness.notifications.events
        #expect(notifications.map(\.body) == ["job done", ""])
        #expect(notifications.map(\.title) == [nil, "Job Title"])
        #expect(result.state.pendingKittyNotificationChunks.isEmpty)
    }

    @Test("A fifth pending id evicts the oldest with a typed drop event")
    func excessPendingIDsEvictOldest() async throws {
        let harness = try await Harness()

        for (index, id) in ["a", "b", "c", "d"].enumerated() {
            _ = try await harness.ingest(sequence: UInt64(index + 1), bytes: osc99("i=\(id):d=1;chunk-\(id)"))
        }
        let evicting = try await harness.ingest(sequence: 5, bytes: osc99("i=e:d=1;chunk-e"))

        #expect(evicting.state.pendingKittyNotificationChunks.map(\.chunkID) == ["b", "c", "d", "e"])
        let drops = await harness.events.published.compactMap { envelope -> TerminalViewport.TerminalNotificationDropSummary? in
            guard case let .terminalNotificationDropped(drop) = envelope.event else {
                return nil
            }
            return drop
        }
        #expect(drops.map(\.reason) == [.chunkBufferEvicted])
        #expect(drops.map(\.source) == [.osc99])
        #expect(drops.map(\.provenance.sequence) == [5])

        // Finalizing the evicted id only carries the final chunk's text.
        _ = try await harness.ingest(sequence: 6, bytes: osc99("i=a:d=0;tail"))
        #expect(await harness.notifications.events.map(\.body) == ["tail"])
    }

    @Test("A pending id growing past the per-id byte cap is dropped")
    func oversizePendingIDIsDropped() async throws {
        let harness = try await Harness()
        let half = String(repeating: "x", count: TerminalViewport.maxPendingKittyNotificationChunkBytes / 2 + 1)

        _ = try await harness.ingest(sequence: 1, bytes: osc99("i=big:d=1;\(half)"))
        let overflowed = try await harness.ingest(sequence: 2, bytes: osc99("i=big:d=1;\(half)"))

        #expect(overflowed.state.pendingKittyNotificationChunks.isEmpty)
        #expect(await harness.notifications.events.isEmpty)
        let drops = await harness.events.published.compactMap { envelope -> TerminalViewport.TerminalNotificationDropSummary? in
            guard case let .terminalNotificationDropped(drop) = envelope.event else {
                return nil
            }
            return drop
        }
        #expect(drops.map(\.reason) == [.chunkBufferOverflow])

        // A later finalize for the dropped id starts fresh.
        _ = try await harness.ingest(sequence: 3, bytes: osc99("i=big:d=0;fresh"))
        #expect(await harness.notifications.events.map(\.body) == ["fresh"])
    }

    @Test("A single oversize chunk never enters the buffer")
    func singleOversizeChunkIsDroppedImmediately() async throws {
        let harness = try await Harness()
        let oversize = String(repeating: "y", count: TerminalViewport.maxPendingKittyNotificationChunkBytes + 1)

        let result = try await harness.ingest(sequence: 1, bytes: osc99("i=huge:d=1;\(oversize)"))

        #expect(result.state.pendingKittyNotificationChunks.isEmpty)
        let drops = await harness.events.published.compactMap { envelope -> TerminalViewport.TerminalNotificationDropSummary? in
            guard case let .terminalNotificationDropped(drop) = envelope.event else {
                return nil
            }
            return drop
        }
        #expect(drops.map(\.reason) == [.chunkBufferOverflow])
    }

    @Test("Buffered chunks do not split surrounding renderer bytes")
    func bufferedChunkKeepsRendererBytesCoalesced() async throws {
        let harness = try await Harness()
        var bytes = Data("before".utf8)
        bytes.append(osc99("i=1:d=1;quiet"))
        bytes.append(Data("after".utf8))

        _ = try await harness.ingest(sequence: 1, bytes: bytes)

        #expect(await harness.renderer.ingested == [Data("beforeafter".utf8)])
        #expect(await harness.notifications.events.isEmpty)
    }
}

// MARK: - Harness

private func osc99(_ payload: String) -> Data {
    Data("\u{1B}]99;\(payload)\u{7}".utf8)
}

private struct Harness {
    let store: TerminalStore
    let renderer: RendererWriter
    let notifications: NotificationForwarder
    let events: EventCollector
    private let action: TerminalViewport.IngestTerminalOutput

    init() async throws {
        store = TerminalStore()
        renderer = RendererWriter()
        notifications = NotificationForwarder()
        events = EventCollector()
        try await store.saveViewport(TerminalViewport.State(
            viewportID: "viewport-1",
            workspaceID: "workspace-1",
            paneID: "pane-1",
            streamID: "stream-1",
            rendererStatus: .ready,
            streamStatus: .attached
        ))
        action = TerminalViewport.IngestTerminalOutput(
            store: store,
            rendererWriter: renderer,
            notificationForwarder: notifications,
            clock: FixedClock(),
            events: events
        )
    }

    func ingest(sequence: UInt64, bytes: Data) async throws -> TerminalViewport.IngestTerminalOutputResult {
        try await action.run(TerminalViewport.IngestTerminalOutputInput(
            requestID: RequestID(rawValue: "kitty-\(sequence)"),
            viewportID: "viewport-1",
            paneID: "pane-1",
            streamID: "stream-1",
            sequence: sequence,
            bytes: bytes,
            source: .test
        )).get()
    }
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

private actor RendererWriter: TerminalViewport.TerminalRendererWriting {
    private(set) var ingested: [Data] = []

    func ingestOutput(viewportID: ViewportID, bytes: Data) async throws {
        ingested.append(bytes)
    }
}

private actor NotificationForwarder: TerminalViewport.TerminalNotificationForwarding {
    private(set) var events: [TerminalViewport.TerminalNotificationEvent] = []

    func forwardTerminalNotification(_ event: TerminalViewport.TerminalNotificationEvent) async throws {
        events.append(event)
    }
}

private actor EventCollector: TerminalViewport.TerminalViewportEventPublishing {
    private(set) var published: [EventEnvelope<TerminalViewport.Event>] = []

    func publish(_ event: EventEnvelope<TerminalViewport.Event>) async {
        published.append(event)
    }
}
