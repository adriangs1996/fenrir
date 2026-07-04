import Foundation
import Testing
import FenrirNativeShared
@testable import TerminalViewport

@Suite("TerminalViewport notification ingestion (D-043)")
struct TerminalNotificationIngestionTests {
    // MARK: - OSC 9 (iTerm2 style)

    @Test("OSC 9 BEL-terminated notification is stripped and forwarded with provenance")
    func osc9BELNotificationIsStrippedAndForwarded() async throws {
        let harness = try await Harness()

        _ = try await harness.ingest(sequence: 1, bytes: osc(9, "Build finished", terminator: .bel, prefix: "before", suffix: "after"))

        #expect(await harness.renderer.ingested == [Data("before".utf8), Data("after".utf8)])
        let notifications = await harness.notifications.events
        #expect(notifications.count == 1)
        #expect(notifications.first?.title == nil)
        #expect(notifications.first?.body == "Build finished")
        #expect(notifications.first?.source == .osc9)
        #expect(notifications.first?.provenance.workspaceID == "workspace-1")
        #expect(notifications.first?.provenance.paneID == "pane-1")
        #expect(notifications.first?.provenance.viewportID == "viewport-1")
        #expect(notifications.first?.provenance.streamID == "stream-1")
        #expect(notifications.first?.provenance.sequence == 1)
    }

    @Test("OSC 9 ST-terminated notification is stripped and forwarded")
    func osc9STNotificationIsStrippedAndForwarded() async throws {
        let harness = try await Harness()

        _ = try await harness.ingest(sequence: 1, bytes: osc(9, "tests passed", terminator: .st, prefix: "left", suffix: "right"))

        #expect(await harness.renderer.ingested == [Data("left".utf8), Data("right".utf8)])
        #expect(await harness.notifications.events.map(\.body) == ["tests passed"])
    }

    @Test("OSC 9 ConEmu progress payload passes through to renderer")
    func osc9ConEmuProgressPassesThrough() async throws {
        let harness = try await Harness()
        let bytes = osc(9, "4;1;50", terminator: .bel, prefix: "a", suffix: "b")

        _ = try await harness.ingest(sequence: 1, bytes: bytes)

        #expect(await harness.renderer.ingested == [bytes])
        #expect(await harness.notifications.events.isEmpty)
        #expect(await harness.events.published.map(\.eventKind) == ["TerminalOutputIngested"])
    }

    // MARK: - OSC 777 (urxvt/ghostty style)

    @Test("OSC 777 notify carries title and body, BEL terminated")
    func osc777NotifyCarriesTitleAndBody() async throws {
        let harness = try await Harness()

        _ = try await harness.ingest(sequence: 1, bytes: osc(777, "notify;Deploy;service is live", terminator: .bel))

        let notifications = await harness.notifications.events
        #expect(notifications.map(\.title) == ["Deploy"])
        #expect(notifications.map(\.body) == ["service is live"])
        #expect(notifications.map(\.source) == [.osc777])
        #expect(await harness.renderer.ingested.isEmpty)
    }

    @Test("OSC 777 notify keeps semicolons in the body and supports ST")
    func osc777NotifyKeepsBodySemicolonsWithST() async throws {
        let harness = try await Harness()

        _ = try await harness.ingest(sequence: 1, bytes: osc(777, "notify;Title;body; with; semicolons", terminator: .st))

        let notifications = await harness.notifications.events
        #expect(notifications.map(\.title) == ["Title"])
        #expect(notifications.map(\.body) == ["body; with; semicolons"])
    }

    @Test("OSC 777 non-notify module passes through to renderer")
    func osc777NonNotifyModulePassesThrough() async throws {
        let harness = try await Harness()
        let bytes = osc(777, "somemodule;payload", terminator: .bel)

        _ = try await harness.ingest(sequence: 1, bytes: bytes)

        #expect(await harness.renderer.ingested == [bytes])
        #expect(await harness.notifications.events.isEmpty)
    }

    // MARK: - OSC 99 (kitty notify)

    @Test("OSC 99 default payload type is body")
    func osc99DefaultPayloadIsBody() async throws {
        let harness = try await Harness()

        _ = try await harness.ingest(sequence: 1, bytes: osc(99, "i=1:d=0;job done", terminator: .bel))

        let notifications = await harness.notifications.events
        #expect(notifications.map(\.title) == [nil])
        #expect(notifications.map(\.body) == ["job done"])
        #expect(notifications.map(\.source) == [.osc99])
    }

    @Test("OSC 99 p=title payload carries the title")
    func osc99TitlePayloadCarriesTitle() async throws {
        let harness = try await Harness()

        _ = try await harness.ingest(sequence: 1, bytes: osc(99, "i=1:p=title;Job Title", terminator: .st))

        let notifications = await harness.notifications.events
        #expect(notifications.map(\.title) == ["Job Title"])
        #expect(notifications.map(\.body) == [""])
    }

    @Test("OSC 99 base64 body is decoded when e=1")
    func osc99Base64BodyDecoded() async throws {
        let harness = try await Harness()
        let encoded = Data("hello from kitty".utf8).base64EncodedString()

        _ = try await harness.ingest(sequence: 1, bytes: osc(99, "e=1;\(encoded)", terminator: .bel))

        #expect(await harness.notifications.events.map(\.body) == ["hello from kitty"])
    }

    @Test("OSC 99 invalid base64 payload is dropped with a typed drop event")
    func osc99InvalidBase64IsDropped() async throws {
        let harness = try await Harness()

        _ = try await harness.ingest(sequence: 1, bytes: osc(99, "e=1;!!!not-base64!!!", terminator: .bel, prefix: "x", suffix: "y"))

        #expect(await harness.notifications.events.isEmpty)
        // Drops do not split renderer writes: surrounding bytes coalesce, the
        // malformed sequence itself is stripped.
        #expect(await harness.renderer.ingested == [Data("xy".utf8)])
        let published = await harness.events.published
        #expect(published.map(\.eventKind) == ["TerminalNotificationDropped", "TerminalOutputIngested"])
        guard case let .terminalNotificationDropped(drop) = published.first?.event else {
            Issue.record("Expected terminalNotificationDropped event")
            return
        }
        #expect(drop.source == .osc99)
        #expect(drop.reason == .invalidEncoding)
        #expect(drop.provenance.sequence == 1)
    }

    @Test("OSC 99 unsupported payload type is stripped and dropped")
    func osc99UnsupportedPayloadTypeDropped() async throws {
        let harness = try await Harness()

        _ = try await harness.ingest(sequence: 1, bytes: osc(99, "p=close;whatever", terminator: .bel))

        #expect(await harness.notifications.events.isEmpty)
        #expect(await harness.renderer.ingested.isEmpty)
        let published = await harness.events.published
        guard case let .terminalNotificationDropped(drop) = published.first?.event else {
            Issue.record("Expected terminalNotificationDropped event")
            return
        }
        #expect(drop.reason == .unsupportedParameters)
    }

    // MARK: - Sanitization

    @Test("Control characters are stripped and tabs/newlines become spaces")
    func sanitizationStripsControlCharacters() async throws {
        let harness = try await Harness()
        let body = "line1\nline2\tend\u{01}\u{08}\u{0B}"

        _ = try await harness.ingest(sequence: 1, bytes: osc(9, body, terminator: .st))

        #expect(await harness.notifications.events.map(\.body) == ["line1 line2 end"])
    }

    @Test("Title is capped at 256 characters and body at 1024 characters")
    func sanitizationCapsTitleAndBodyLength() async throws {
        let harness = try await Harness()
        let longTitle = String(repeating: "t", count: 300)
        let longBody = String(repeating: "b", count: 2000)

        _ = try await harness.ingest(sequence: 1, bytes: osc(777, "notify;\(longTitle);\(longBody)", terminator: .bel))

        let notifications = await harness.notifications.events
        #expect(notifications.first?.title?.count == TerminalViewport.maxTerminalNotificationTitleCharacters)
        #expect(notifications.first?.body.count == TerminalViewport.maxTerminalNotificationBodyCharacters)
    }

    @Test("Payload that sanitizes to empty content is dropped, not forwarded")
    func emptyContentPayloadIsDropped() async throws {
        let harness = try await Harness()

        _ = try await harness.ingest(sequence: 1, bytes: osc(9, "\u{01}\u{02}  ", terminator: .bel, prefix: "keep"))

        #expect(await harness.notifications.events.isEmpty)
        #expect(await harness.renderer.ingested == [Data("keep".utf8)])
        let published = await harness.events.published
        guard case let .terminalNotificationDropped(drop) = published.first?.event else {
            Issue.record("Expected terminalNotificationDropped event")
            return
        }
        #expect(drop.source == .osc9)
        #expect(drop.reason == .emptyContent)
    }

    // MARK: - Stream mechanics

    @Test("Notification OSC split across batch chunks is buffered and forwarded exactly once")
    func splitNotificationAcrossChunksForwardsOnce() async throws {
        let harness = try await Harness()
        let action = TerminalViewport.IngestTerminalOutputBatch(
            store: harness.store,
            rendererWriter: harness.renderer,
            notificationForwarder: harness.notifications,
            clock: FixedClock()
        )

        _ = try await action.run(TerminalViewport.IngestTerminalOutputBatchInput(
            requestID: "batch",
            viewportID: "viewport-1",
            paneID: "pane-1",
            streamID: "stream-1",
            chunks: [
                TerminalViewport.TerminalOutputChunk(sequence: 1, bytes: Data("A\u{1B}]9;par".utf8)),
                TerminalViewport.TerminalOutputChunk(sequence: 2, bytes: Data("tial\u{7}B".utf8))
            ],
            policy: .init(maxChunksPerBatch: 4, maxBytesPerBatch: 128, maxBytesPerRendererWrite: 128),
            source: .test
        )).get()

        #expect(await harness.renderer.ingested == [Data("A".utf8), Data("B".utf8)])
        #expect(await harness.notifications.events.map(\.body) == ["partial"])
    }

    @Test("Chunk ending mid-introducer is buffered instead of rendered")
    func chunkEndingMidIntroducerIsBuffered() async throws {
        let harness = try await Harness()

        let first = try await harness.ingest(sequence: 1, bytes: Data("A\u{1B}]7".utf8))
        #expect(first.state.pendingReservedOSCSequence == Data("\u{1B}]7".utf8))
        #expect(await harness.renderer.ingested == [Data("A".utf8)])

        _ = try await harness.ingest(sequence: 2, bytes: Data("77;notify;t;b\u{7}Z".utf8))

        #expect(await harness.notifications.events.map(\.title) == ["t"])
        #expect(await harness.renderer.ingested == [Data("A".utf8), Data("Z".utf8)])
    }

    @Test("Untracked OSC identifiers sharing a tracked digit prefix pass through")
    func untrackedIdentifiersPassThrough() async throws {
        let harness = try await Harness()
        let bytes = Data("x\u{1B}]999;normal\u{7}\u{1B}]90;other\u{7}y".utf8)

        _ = try await harness.ingest(sequence: 1, bytes: bytes)

        #expect(await harness.renderer.ingested == [bytes])
        #expect(await harness.notifications.events.isEmpty)
    }

    @Test("Reserved 8737 presence signal keeps its behavior alongside notifications")
    func reservedPresenceSignalUnchangedAlongsideNotifications() async throws {
        let harness = try await Harness()
        var bytes = Data("a".utf8)
        bytes.append(osc(TerminalViewport.fenrirReservedOSCIdentifier, "busy", terminator: .bel))
        bytes.append(osc(9, "notice", terminator: .bel))
        bytes.append(Data("z".utf8))

        _ = try await harness.ingest(sequence: 1, bytes: bytes)

        #expect(await harness.reserved.signals.map(\.payload) == ["busy"])
        #expect(await harness.reserved.signals.map(\.oscIdentifier) == [TerminalViewport.fenrirReservedOSCIdentifier])
        #expect(await harness.notifications.events.map(\.body) == ["notice"])
        #expect(await harness.renderer.ingested == [Data("a".utf8), Data("z".utf8)])
    }

    @Test("Notification forwarder failure is advisory and does not fail ingestion")
    func notificationForwarderFailureIsAdvisory() async throws {
        let harness = try await Harness(notifications: NotificationForwarder(throwAfterForwardCount: 1))

        let result = try await harness.ingest(sequence: 1, bytes: osc(9, "boom", terminator: .bel, prefix: "before", suffix: "after"))

        #expect(result.appliedSequence == 1)
        #expect(await harness.renderer.ingested == [Data("before".utf8), Data("after".utf8)])
        #expect(await harness.notifications.events.map(\.body) == ["boom"])
    }

    @Test("Notification event summary omits title and body content")
    func notificationEventSummaryOmitsContent() async throws {
        let harness = try await Harness()

        _ = try await harness.ingest(sequence: 1, bytes: osc(777, "notify;secret-title;secret-body", terminator: .bel))

        let published = await harness.events.published
        #expect(published.map(\.eventKind) == ["TerminalNotificationForwarded", "TerminalOutputIngested"])
        #expect(!String(describing: published).contains("secret-title"))
        #expect(!String(describing: published).contains("secret-body"))
        guard case let .terminalNotificationForwarded(summary) = published.first?.event else {
            Issue.record("Expected terminalNotificationForwarded event")
            return
        }
        #expect(summary.source == .osc777)
        #expect(summary.titleCharacterCount == "secret-title".count)
        #expect(summary.bodyCharacterCount == "secret-body".count)
        #expect(summary.provenance.sequence == 1)
    }

    @Test("Unterminated notification OSC past the pending cap fails boundedly")
    func unterminatedNotificationPastPendingCapFails() async throws {
        let harness = try await Harness()
        let payload = String(repeating: "x", count: TerminalViewport.maxPendingReservedOSCSequenceBytes + 1)

        let result = await harness.ingestExpectingFailure(sequence: 1, bytes: Data("\u{1B}]9;\(payload)".utf8))

        #expect(result == .failure(TerminalViewport.TerminalViewportError.outputBackpressure))
        #expect(await harness.renderer.ingested.isEmpty)
        #expect(await harness.notifications.events.isEmpty)
    }
}

// MARK: - Harness

private struct Harness {
    let store: TerminalStore
    let renderer: RendererWriter
    let reserved: ReservedForwarder
    let notifications: NotificationForwarder
    let events: EventCollector
    private let action: TerminalViewport.IngestTerminalOutput

    init(notifications: NotificationForwarder = NotificationForwarder()) async throws {
        store = TerminalStore()
        renderer = RendererWriter()
        reserved = ReservedForwarder()
        self.notifications = notifications
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
            reservedOSCForwarder: reserved,
            notificationForwarder: notifications,
            clock: FixedClock(),
            events: events
        )
    }

    func ingest(sequence: UInt64, bytes: Data) async throws -> TerminalViewport.IngestTerminalOutputResult {
        try await action.run(input(sequence: sequence, bytes: bytes)).get()
    }

    func ingestExpectingFailure(sequence: UInt64, bytes: Data) async -> Result<TerminalViewport.IngestTerminalOutputResult, TerminalViewport.TerminalViewportError> {
        await action.run(input(sequence: sequence, bytes: bytes))
    }

    private func input(sequence: UInt64, bytes: Data) -> TerminalViewport.IngestTerminalOutputInput {
        TerminalViewport.IngestTerminalOutputInput(
            requestID: RequestID(rawValue: "notify-\(sequence)"),
            viewportID: "viewport-1",
            paneID: "pane-1",
            streamID: "stream-1",
            sequence: sequence,
            bytes: bytes,
            source: .test
        )
    }
}

private enum Terminator {
    case bel
    case st
}

private func osc(_ identifier: Int, _ payload: String, terminator: Terminator, prefix: String = "", suffix: String = "") -> Data {
    let terminatorText: String
    switch terminator {
    case .bel:
        terminatorText = "\u{7}"
    case .st:
        terminatorText = "\u{1B}\\"
    }
    return Data("\(prefix)\u{1B}]\(identifier);\(payload)\(terminatorText)\(suffix)".utf8)
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

private actor RendererWriter: TerminalViewport.TerminalRendererWriting {
    private(set) var ingested: [Data] = []

    func ingestOutput(viewportID: ViewportID, bytes: Data) async throws {
        ingested.append(bytes)
    }
}

private actor ReservedForwarder: TerminalViewport.TerminalReservedOSCForwarding {
    private(set) var signals: [TerminalViewport.ReservedOSCSignal] = []

    func forwardReservedOSC(_ signal: TerminalViewport.ReservedOSCSignal) async throws {
        signals.append(signal)
    }
}

private actor NotificationForwarder: TerminalViewport.TerminalNotificationForwarding {
    private(set) var events: [TerminalViewport.TerminalNotificationEvent] = []
    private let throwAfterForwardCount: Int?

    init(throwAfterForwardCount: Int? = nil) {
        self.throwAfterForwardCount = throwAfterForwardCount
    }

    func forwardTerminalNotification(_ event: TerminalViewport.TerminalNotificationEvent) async throws {
        events.append(event)
        if let throwAfterForwardCount, events.count >= throwAfterForwardCount {
            throw TestError.failed
        }
    }
}

private actor EventCollector: TerminalViewport.TerminalViewportEventPublishing {
    private(set) var published: [EventEnvelope<TerminalViewport.Event>] = []

    func publish(_ event: EventEnvelope<TerminalViewport.Event>) async {
        published.append(event)
    }
}
