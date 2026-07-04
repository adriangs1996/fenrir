import Foundation
import FenrirNativeShared

public extension TerminalViewport {
    struct CreateTerminalViewport: FenrirAction {
        public typealias Failure = TerminalViewportError

        let store: any TerminalViewportStore
        let rendererHost: any TerminalRendererHosting
        let clock: any TerminalViewportClock
        let events: (any TerminalViewportEventPublishing)?

        init(store: any TerminalViewportStore, rendererHost: any TerminalRendererHosting, clock: any TerminalViewportClock, events: (any TerminalViewportEventPublishing)? = nil) {
            self.store = store
            self.rendererHost = rendererHost
            self.clock = clock
            self.events = events
        }

        public func run(_ input: CreateTerminalViewportInput) async -> Result<CreateTerminalViewportResult, TerminalViewportError> {
            do {
                if let size = input.size {
                    try TerminalViewport.validate(size)
                }
                let renderer = try await rendererHost.createRenderer(input)
                guard renderer.status == .ready else {
                    return .failure(.rendererUnavailable)
                }
                let state = State(
                    viewportID: input.viewportID,
                    workspaceID: input.workspaceID,
                    tabID: input.tabID,
                    paneID: input.paneID,
                    rendererStatus: renderer.status,
                    size: input.size
                )
                try await store.saveViewport(state)
                let timestamp = clock.now()
                await events?.publish(TerminalViewport.envelope(input.requestID, "TerminalViewportCreated", timestamp, .terminalViewportCreated(input.viewportID)))
                return .success(CreateTerminalViewportResult(requestID: input.requestID, state: state, renderer: renderer, timestamp: timestamp))
            } catch let error as TerminalViewportError {
                return .failure(error)
            } catch {
                return .failure(.createFailed)
            }
        }
    }

    struct DestroyTerminalViewport: FenrirAction {
        public typealias Failure = TerminalViewportError

        let store: any TerminalViewportStore
        let rendererHost: any TerminalRendererHosting
        let clock: any TerminalViewportClock
        let events: (any TerminalViewportEventPublishing)?

        init(store: any TerminalViewportStore, rendererHost: any TerminalRendererHosting, clock: any TerminalViewportClock, events: (any TerminalViewportEventPublishing)? = nil) {
            self.store = store
            self.rendererHost = rendererHost
            self.clock = clock
            self.events = events
        }

        public func run(_ input: DestroyTerminalViewportInput) async -> Result<DestroyTerminalViewportResult, TerminalViewportError> {
            do {
                guard try await store.loadViewport(viewportID: input.viewportID) != nil else {
                    return .failure(.notFound)
                }
                try await rendererHost.destroyRenderer(viewportID: input.viewportID)
                try await store.deleteViewport(viewportID: input.viewportID)
                let timestamp = clock.now()
                await events?.publish(TerminalViewport.envelope(input.requestID, "TerminalViewportDestroyed", timestamp, .terminalViewportDestroyed(input.viewportID)))
                return .success(DestroyTerminalViewportResult(requestID: input.requestID, viewportID: input.viewportID, timestamp: timestamp))
            } catch {
                return .failure(.destroyFailed)
            }
        }
    }

    struct AttachPaneStream: FenrirAction {
        public typealias Failure = TerminalViewportError

        let store: any TerminalViewportStore
        let clock: any TerminalViewportClock
        let events: (any TerminalViewportEventPublishing)?

        init(store: any TerminalViewportStore, clock: any TerminalViewportClock, events: (any TerminalViewportEventPublishing)? = nil) {
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: AttachPaneStreamInput) async -> Result<AttachPaneStreamResult, TerminalViewportError> {
            do {
                let state = try await TerminalViewport.loadMatchingState(store, viewportID: input.viewportID, workspaceID: input.workspaceID, paneID: input.paneID)
                let next = state.updated(streamID: .some(input.streamID), lastAppliedSequence: .some(nil), streamStatus: .attached)
                try await store.saveViewport(next)
                let timestamp = clock.now()
                await events?.publish(TerminalViewport.envelope(input.requestID, "PaneStreamAttached", timestamp, .paneStreamAttached(input.viewportID, input.streamID)))
                return .success(AttachPaneStreamResult(requestID: input.requestID, state: next, timestamp: timestamp))
            } catch let error as TerminalViewportError {
                return .failure(error)
            } catch {
                return .failure(.rendererUnavailable)
            }
        }
    }

    struct DetachPaneStream: FenrirAction {
        public typealias Failure = TerminalViewportError

        let store: any TerminalViewportStore
        let clock: any TerminalViewportClock
        let events: (any TerminalViewportEventPublishing)?

        init(store: any TerminalViewportStore, clock: any TerminalViewportClock, events: (any TerminalViewportEventPublishing)? = nil) {
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: DetachPaneStreamInput) async -> Result<DetachPaneStreamResult, TerminalViewportError> {
            do {
                let state = try await TerminalViewport.loadMatchingState(store, viewportID: input.viewportID, paneID: input.paneID, streamID: input.streamID)
                let next = state.updated(streamID: .some(nil), lastAppliedSequence: .some(nil), streamStatus: .detached)
                try await store.saveViewport(next)
                let timestamp = clock.now()
                await events?.publish(TerminalViewport.envelope(input.requestID, "PaneStreamDetached", timestamp, .paneStreamDetached(input.viewportID, input.streamID)))
                return .success(DetachPaneStreamResult(requestID: input.requestID, state: next, timestamp: timestamp))
            } catch let error as TerminalViewportError {
                return .failure(error)
            } catch {
                return .failure(.rendererUnavailable)
            }
        }
    }

    struct IngestTerminalOutput: FenrirAction {
        public typealias Failure = TerminalViewportError

        let store: any TerminalViewportStore
        let rendererWriter: any TerminalRendererWriting
        let reservedOSCForwarder: (any TerminalReservedOSCForwarding)?
        let notificationForwarder: (any TerminalNotificationForwarding)?
        let clock: any TerminalViewportClock
        let events: (any TerminalViewportEventPublishing)?

        public init(
            store: any TerminalViewportStore,
            rendererWriter: any TerminalRendererWriting,
            reservedOSCForwarder: (any TerminalReservedOSCForwarding)? = nil,
            notificationForwarder: (any TerminalNotificationForwarding)? = nil,
            clock: any TerminalViewportClock,
            events: (any TerminalViewportEventPublishing)? = nil
        ) {
            self.store = store
            self.rendererWriter = rendererWriter
            self.reservedOSCForwarder = reservedOSCForwarder
            self.notificationForwarder = notificationForwarder
            self.clock = clock
            self.events = events
        }

        public func run(_ input: IngestTerminalOutputInput) async -> Result<IngestTerminalOutputResult, TerminalViewportError> {
            do {
                let state = try await TerminalViewport.loadMatchingState(store, viewportID: input.viewportID, paneID: input.paneID, streamID: input.streamID)
                try TerminalViewport.validateNextSequence(input.sequence, after: state.lastAppliedSequence)
                let scanned = try TerminalViewport.scanTerminalStream(
                    from: input.bytes,
                    pending: state.pendingReservedOSCSequence,
                    state: state,
                    streamID: input.streamID,
                    sequence: input.sequence
                )
                _ = try await TerminalViewport.apply(
                    scanned.operations,
                    viewportID: input.viewportID,
                    maxBytesPerRendererWrite: TerminalOutputBackpressurePolicy.defaults.maxBytesPerRendererWrite,
                    requestID: input.requestID,
                    rendererWriter: rendererWriter,
                    clock: clock,
                    reservedOSCForwarder: reservedOSCForwarder,
                    notificationForwarder: notificationForwarder,
                    events: events
                )
                let next = state.updated(
                    lastAppliedSequence: .some(input.sequence),
                    pendingReservedOSCSequence: scanned.pending,
                    pendingKittyNotificationChunks: scanned.pendingKittyChunks
                )
                try await store.saveViewport(next)
                let timestamp = clock.now()
                await events?.publish(TerminalViewport.envelope(input.requestID, "TerminalOutputIngested", timestamp, .terminalOutputIngested(input.viewportID, input.sequence)))
                return .success(IngestTerminalOutputResult(requestID: input.requestID, state: next, appliedSequence: input.sequence, timestamp: timestamp))
            } catch let error as TerminalViewportError {
                return .failure(error)
            } catch {
                return .failure(.outputApplyFailed)
            }
        }
    }

    struct IngestTerminalOutputBatch: FenrirAction {
        public typealias Failure = TerminalViewportError

        let store: any TerminalViewportStore
        let rendererWriter: any TerminalRendererWriting
        let reservedOSCForwarder: (any TerminalReservedOSCForwarding)?
        let notificationForwarder: (any TerminalNotificationForwarding)?
        let clock: any TerminalViewportClock
        let events: (any TerminalViewportEventPublishing)?

        init(
            store: any TerminalViewportStore,
            rendererWriter: any TerminalRendererWriting,
            reservedOSCForwarder: (any TerminalReservedOSCForwarding)? = nil,
            notificationForwarder: (any TerminalNotificationForwarding)? = nil,
            clock: any TerminalViewportClock,
            events: (any TerminalViewportEventPublishing)? = nil
        ) {
            self.store = store
            self.rendererWriter = rendererWriter
            self.reservedOSCForwarder = reservedOSCForwarder
            self.notificationForwarder = notificationForwarder
            self.clock = clock
            self.events = events
        }

        public func run(_ input: IngestTerminalOutputBatchInput) async -> Result<IngestTerminalOutputBatchResult, TerminalViewportError> {
            do {
                let state = try await TerminalViewport.loadMatchingState(store, viewportID: input.viewportID, paneID: input.paneID, streamID: input.streamID)
                try TerminalViewport.validate(input.chunks, after: state.lastAppliedSequence, policy: input.policy)
                let scanned = try TerminalViewport.scanTerminalStream(
                    from: input.chunks,
                    pending: state.pendingReservedOSCSequence,
                    state: state,
                    streamID: input.streamID
                )
                let rendererWriteCount = try await TerminalViewport.apply(
                    scanned.operations,
                    viewportID: input.viewportID,
                    maxBytesPerRendererWrite: input.policy.maxBytesPerRendererWrite,
                    requestID: input.requestID,
                    rendererWriter: rendererWriter,
                    clock: clock,
                    reservedOSCForwarder: reservedOSCForwarder,
                    notificationForwarder: notificationForwarder,
                    events: events
                )
                guard let lastSequence = input.chunks.last?.sequence else {
                    throw TerminalViewportError.streamOrderViolation
                }
                let next = state.updated(
                    lastAppliedSequence: .some(lastSequence),
                    pendingReservedOSCSequence: scanned.pending,
                    pendingKittyNotificationChunks: scanned.pendingKittyChunks
                )
                try await store.saveViewport(next)
                let timestamp = clock.now()
                await events?.publish(TerminalViewport.envelope(input.requestID, "TerminalOutputIngested", timestamp, .terminalOutputIngested(input.viewportID, lastSequence)))
                return .success(IngestTerminalOutputBatchResult(
                    requestID: input.requestID,
                    state: next,
                    appliedSequence: lastSequence,
                    chunkCount: input.chunks.count,
                    rendererWriteCount: rendererWriteCount,
                    timestamp: timestamp
                ))
            } catch let error as TerminalViewportError {
                return .failure(error)
            } catch {
                return .failure(.outputApplyFailed)
            }
        }
    }

    struct SendTerminalInput: FenrirAction {
        public typealias Failure = TerminalViewportError

        let store: any TerminalViewportStore
        let runtimeWriter: any TerminalRuntimeWriting
        let clock: any TerminalViewportClock
        let events: (any TerminalViewportEventPublishing)?

        init(store: any TerminalViewportStore, runtimeWriter: any TerminalRuntimeWriting, clock: any TerminalViewportClock, events: (any TerminalViewportEventPublishing)? = nil) {
            self.store = store
            self.runtimeWriter = runtimeWriter
            self.clock = clock
            self.events = events
        }

        public func run(_ input: SendTerminalInputInput) async -> Result<SendTerminalInputResult, TerminalViewportError> {
            do {
                _ = try await TerminalViewport.loadMatchingState(store, viewportID: input.viewportID, workspaceID: input.workspaceID, paneID: input.paneID)
                let acknowledgement = try await runtimeWriter.writeTerminalInput(input)
                try TerminalViewport.validate(acknowledgement, input: input)
                let timestamp = clock.now()
                await events?.publish(TerminalViewport.envelope(input.requestID, "TerminalInputSent", timestamp, .terminalInputSent(input.viewportID, input.requestID)))
                return .success(SendTerminalInputResult(requestID: input.requestID, acknowledgement: acknowledgement, timestamp: timestamp))
            } catch let error as TerminalViewportError {
                return .failure(error)
            } catch {
                return .failure(.inputRejected)
            }
        }
    }

    struct ResizeTerminalViewport: FenrirAction {
        public typealias Failure = TerminalViewportError

        let store: any TerminalViewportStore
        let rendererSizer: any TerminalRendererSizing
        let runtimeResizer: any TerminalRuntimeResizing
        let clock: any TerminalViewportClock
        let events: (any TerminalViewportEventPublishing)?

        init(store: any TerminalViewportStore, rendererSizer: any TerminalRendererSizing, runtimeResizer: any TerminalRuntimeResizing, clock: any TerminalViewportClock, events: (any TerminalViewportEventPublishing)? = nil) {
            self.store = store
            self.rendererSizer = rendererSizer
            self.runtimeResizer = runtimeResizer
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ResizeTerminalViewportInput) async -> Result<ResizeTerminalViewportResult, TerminalViewportError> {
            do {
                let state = try await TerminalViewport.loadMatchingState(store, viewportID: input.viewportID, workspaceID: input.workspaceID, paneID: input.paneID)
                try TerminalViewport.validate(input.size)
                let acknowledgement = try await runtimeResizer.resizeTerminalPane(input)
                try TerminalViewport.validate(acknowledgement, input: input)
                try await rendererSizer.resizeRenderer(viewportID: input.viewportID, size: input.size)
                let next = state.updated(size: input.size)
                try await store.saveViewport(next)
                let timestamp = clock.now()
                await events?.publish(TerminalViewport.envelope(input.requestID, "TerminalViewportResized", timestamp, .terminalViewportResized(input.viewportID, input.size)))
                return .success(ResizeTerminalViewportResult(requestID: input.requestID, state: next, acknowledgement: acknowledgement, timestamp: timestamp))
            } catch let error as TerminalViewportError {
                return .failure(error)
            } catch {
                return .failure(.resizeFailed)
            }
        }
    }

    struct FocusTerminalViewport: FenrirAction {
        public typealias Failure = TerminalViewportError

        let store: any TerminalViewportStore
        let rendererHost: any TerminalRendererHosting
        let clock: any TerminalViewportClock
        let events: (any TerminalViewportEventPublishing)?

        init(store: any TerminalViewportStore, rendererHost: any TerminalRendererHosting, clock: any TerminalViewportClock, events: (any TerminalViewportEventPublishing)? = nil) {
            self.store = store
            self.rendererHost = rendererHost
            self.clock = clock
            self.events = events
        }

        public func run(_ input: FocusTerminalViewportInput) async -> Result<FocusTerminalViewportResult, TerminalViewportError> {
            do {
                let state = try await TerminalViewport.loadMatchingState(store, viewportID: input.viewportID, paneID: input.paneID)
                try await rendererHost.focusRenderer(viewportID: input.viewportID, focused: input.focused)
                let next = state.updated(isFocused: input.focused)
                try await store.saveViewport(next)
                let timestamp = clock.now()
                await events?.publish(TerminalViewport.envelope(input.requestID, "TerminalViewportFocused", timestamp, .terminalViewportFocused(input.viewportID, input.focused)))
                return .success(FocusTerminalViewportResult(requestID: input.requestID, state: next, timestamp: timestamp))
            } catch let error as TerminalViewportError {
                return .failure(error)
            } catch {
                return .failure(.rendererUnavailable)
            }
        }
    }

    struct SnapshotTerminalViewport: FenrirAction {
        public typealias Failure = TerminalViewportError

        let store: any TerminalViewportStore
        let clock: any TerminalViewportClock
        let events: (any TerminalViewportEventPublishing)?

        init(store: any TerminalViewportStore, clock: any TerminalViewportClock, events: (any TerminalViewportEventPublishing)? = nil) {
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: SnapshotTerminalViewportInput) async -> Result<SnapshotTerminalViewportResult, TerminalViewportError> {
            do {
                let state = try await TerminalViewport.loadMatchingState(store, viewportID: input.viewportID, paneID: input.paneID)
                let timestamp = clock.now()
                await events?.publish(TerminalViewport.envelope(input.requestID, "TerminalViewportSnapshotted", timestamp, .terminalViewportSnapshotted(input.viewportID)))
                return .success(SnapshotTerminalViewportResult(requestID: input.requestID, state: state, timestamp: timestamp))
            } catch let error as TerminalViewportError {
                return .failure(error)
            } catch {
                return .failure(.notFound)
            }
        }
    }

    struct CaptureTerminalSelection: FenrirAction {
        public typealias Failure = TerminalViewportError

        let store: any TerminalViewportStore
        let reader: any TerminalRendererContextReading
        let redactor: (any TerminalContextRedacting)?
        let clock: any TerminalViewportClock
        let events: (any TerminalViewportEventPublishing)?

        public init(
            store: any TerminalViewportStore,
            reader: any TerminalRendererContextReading,
            redactor: (any TerminalContextRedacting)? = nil,
            clock: any TerminalViewportClock,
            events: (any TerminalViewportEventPublishing)? = nil
        ) {
            self.store = store
            self.reader = reader
            self.redactor = redactor
            self.clock = clock
            self.events = events
        }

        public func run(_ input: CaptureTerminalSelectionInput) async -> Result<CaptureTerminalSelectionResult, TerminalViewportError> {
            await TerminalViewport.capture(input, kind: .selection, store: store, reader: reader, redactor: redactor, clock: clock, events: events)
        }
    }

    struct CaptureTerminalViewport: FenrirAction {
        public typealias Failure = TerminalViewportError

        let store: any TerminalViewportStore
        let reader: any TerminalRendererContextReading
        let redactor: (any TerminalContextRedacting)?
        let clock: any TerminalViewportClock
        let events: (any TerminalViewportEventPublishing)?

        public init(
            store: any TerminalViewportStore,
            reader: any TerminalRendererContextReading,
            redactor: (any TerminalContextRedacting)? = nil,
            clock: any TerminalViewportClock,
            events: (any TerminalViewportEventPublishing)? = nil
        ) {
            self.store = store
            self.reader = reader
            self.redactor = redactor
            self.clock = clock
            self.events = events
        }

        public func run(_ input: CaptureTerminalViewportInput) async -> Result<CaptureTerminalViewportResult, TerminalViewportError> {
            await TerminalViewport.capture(input, kind: .viewport, store: store, reader: reader, redactor: redactor, clock: clock, events: events)
        }
    }

    struct CaptureTerminalLastLines: FenrirAction {
        public typealias Failure = TerminalViewportError

        let store: any TerminalViewportStore
        let reader: any TerminalRendererContextReading
        let redactor: (any TerminalContextRedacting)?
        let clock: any TerminalViewportClock
        let events: (any TerminalViewportEventPublishing)?

        public init(
            store: any TerminalViewportStore,
            reader: any TerminalRendererContextReading,
            redactor: (any TerminalContextRedacting)? = nil,
            clock: any TerminalViewportClock,
            events: (any TerminalViewportEventPublishing)? = nil
        ) {
            self.store = store
            self.reader = reader
            self.redactor = redactor
            self.clock = clock
            self.events = events
        }

        public func run(_ input: CaptureTerminalLastLinesInput) async -> Result<CaptureTerminalLastLinesResult, TerminalViewportError> {
            await TerminalViewport.capture(input, kind: .lastLines, store: store, reader: reader, redactor: redactor, clock: clock, events: events)
        }
    }
}

extension TerminalViewport {
    static func capture(
        _ input: CaptureTerminalContextInput,
        kind: CaptureKind,
        store: any TerminalViewportStore,
        reader: any TerminalRendererContextReading,
        redactor: (any TerminalContextRedacting)?,
        clock: any TerminalViewportClock,
        events: (any TerminalViewportEventPublishing)?
    ) async -> Result<CaptureTerminalContextResult, TerminalViewportError> {
        do {
            let state = try await loadMatchingState(store, viewportID: input.viewportID, workspaceID: input.workspaceID, tabID: input.tabID, paneID: input.paneID)
            let buffer: CapturedTextBuffer
            do {
                switch kind {
                case .selection:
                    buffer = try await reader.readSelection(viewportID: input.viewportID)
                case .viewport:
                    buffer = try await reader.readViewport(viewportID: input.viewportID)
                case .lastLines:
                    buffer = try await reader.readLastLines(viewportID: input.viewportID, maxLines: input.limit.maxLines)
                }
            } catch {
                return .failure(.contextCaptureFailed)
            }

            let provenance = ContextProvenance(
                workspaceID: state.workspaceID,
                tabID: state.tabID,
                paneID: state.paneID,
                viewportID: state.viewportID,
                streamID: state.streamID,
                lastAppliedSequence: state.lastAppliedSequence
            )
            let bounded = bound(buffer.text, limit: input.limit)
            let timestamp = clock.now()
            let initial = CapturedContext(
                provenance: provenance,
                kind: kind,
                screen: buffer.screen,
                text: bounded.text,
                lineCount: bounded.lineCount,
                characterCount: bounded.characterCount,
                isTruncated: bounded.isTruncated,
                redactionReport: RedactionReport(),
                capturedAt: timestamp
            )
            let context: CapturedContext
            if let redactor {
                let redacted: RedactedCapture
                do {
                    redacted = try await redactor.redactTerminalContext(initial)
                } catch {
                    return .failure(.redactionFailed)
                }
                let redactedBounded = bound(redacted.text, limit: input.limit)
                context = CapturedContext(
                    provenance: provenance,
                    kind: kind,
                    screen: buffer.screen,
                    text: redactedBounded.text,
                    lineCount: redactedBounded.lineCount,
                    characterCount: redactedBounded.characterCount,
                    isTruncated: bounded.isTruncated || redactedBounded.isTruncated,
                    redactionReport: redacted.report,
                    capturedAt: timestamp
                )
            } else {
                context = initial
            }
            await events?.publish(envelope(input.requestID, "TerminalContextCaptured", timestamp, .terminalContextCaptured(CapturedContextSummary(context: context))))
            return .success(CaptureTerminalContextResult(requestID: input.requestID, context: context, timestamp: timestamp))
        } catch let error as TerminalViewportError {
            return .failure(error)
        } catch {
            return .failure(.contextCaptureFailed)
        }
    }

    static func envelope(_ requestID: RequestID, _ kind: String, _ timestamp: FenrirTimestamp, _ event: Event) -> EventEnvelope<Event> {
        EventEnvelope(eventID: requestID, eventKind: kind, timestamp: timestamp, event: event)
    }

    static func loadMatchingState(
        _ store: any TerminalViewportStore,
        viewportID: ViewportID,
        workspaceID: WorkspaceID? = nil,
        tabID: FenrirWindowID? = nil,
        paneID: PaneID,
        streamID: StreamID? = nil
    ) async throws -> State {
        guard let state = try await store.loadViewport(viewportID: viewportID) else {
            throw TerminalViewportError.notFound
        }
        guard state.paneID == paneID, workspaceID == nil || state.workspaceID == workspaceID else {
            throw TerminalViewportError.paneIdentityMismatch
        }
        guard tabID == nil || state.tabID == tabID else {
            throw TerminalViewportError.paneIdentityMismatch
        }
        guard streamID == nil || state.streamID == streamID else {
            throw TerminalViewportError.paneIdentityMismatch
        }
        return state
    }

    static func bound(_ text: String, limit: CaptureLimit) -> (text: String, lineCount: Int, characterCount: Int, isTruncated: Bool) {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        let lineBounded: String
        var truncated = false

        if let maxLines = limit.maxLines, maxLines >= 0, lines.count > maxLines {
            lineBounded = lines.suffix(maxLines).joined(separator: "\n")
            truncated = true
        } else {
            lineBounded = text
        }

        if lineBounded.count > limit.maxCharacters {
            let suffix = String(lineBounded.suffix(limit.maxCharacters))
            truncated = true
            return (suffix, suffix.lineCount, suffix.count, truncated)
        }

        return (lineBounded, lineBounded.lineCount, lineBounded.count, truncated)
    }

    static func validate(_ size: Size) throws {
        guard size.columns > 0, size.rows > 0, size.pixelWidth > 0, size.pixelHeight > 0 else {
            throw TerminalViewportError.invalidDimensions
        }
    }

    static func validateNextSequence(_ sequence: UInt64, after previous: UInt64?) throws {
        guard let previous else {
            guard sequence > 0 else {
                throw TerminalViewportError.streamOrderViolation
            }
            return
        }
        guard sequence == previous + 1 else {
            throw TerminalViewportError.streamOrderViolation
        }
    }

    static func validate(_ chunks: [TerminalOutputChunk], after previous: UInt64?, policy: TerminalOutputBackpressurePolicy) throws {
        guard !chunks.isEmpty else {
            throw TerminalViewportError.streamOrderViolation
        }
        guard chunks.count <= policy.maxChunksPerBatch else {
            throw TerminalViewportError.outputBackpressure
        }
        let totalBytes = chunks.reduce(0) { $0 + $1.bytes.count }
        guard totalBytes <= policy.maxBytesPerBatch else {
            throw TerminalViewportError.outputBackpressure
        }

        var last = previous
        for chunk in chunks {
            try validateNextSequence(chunk.sequence, after: last)
            last = chunk.sequence
        }
    }

    static func coalescedRendererWrites(from chunks: [TerminalOutputChunk], maxBytesPerWrite: Int) -> [Data] {
        let limit = max(1, maxBytesPerWrite)
        var writes: [Data] = []
        var current = Data()

        for chunk in chunks where !chunk.bytes.isEmpty {
            var cursor = chunk.bytes.startIndex
            while cursor < chunk.bytes.endIndex {
                let remainingCapacity = limit - current.count
                let end = chunk.bytes.index(cursor, offsetBy: min(remainingCapacity, chunk.bytes.distance(from: cursor, to: chunk.bytes.endIndex)))
                current.append(chunk.bytes.subdata(in: cursor..<end))
                cursor = end

                guard current.count >= limit else {
                    continue
                }
                writes.append(current)
                current = Data()
            }
        }

        if !current.isEmpty {
            writes.append(current)
        }
        return writes
    }

    static func scanTerminalStream(
        from bytes: Data,
        pending: Data,
        state: State,
        streamID: StreamID,
        sequence: UInt64
    ) throws -> (operations: [TerminalStreamOperation], pending: Data, pendingKittyChunks: [PendingKittyNotificationChunk]) {
        try TerminalStreamScanner(
            state: state,
            streamID: streamID
        ).scan(chunks: [TerminalOutputChunk(sequence: sequence, bytes: bytes)], pending: pending)
    }

    static func scanTerminalStream(
        from chunks: [TerminalOutputChunk],
        pending: Data,
        state: State,
        streamID: StreamID
    ) throws -> (operations: [TerminalStreamOperation], pending: Data, pendingKittyChunks: [PendingKittyNotificationChunk]) {
        try TerminalStreamScanner(state: state, streamID: streamID).scan(chunks: chunks, pending: pending)
    }

    static func apply(
        _ operations: [TerminalStreamOperation],
        viewportID: ViewportID,
        maxBytesPerRendererWrite: Int,
        requestID: RequestID,
        rendererWriter: any TerminalRendererWriting,
        clock: any TerminalViewportClock,
        reservedOSCForwarder: (any TerminalReservedOSCForwarding)?,
        notificationForwarder: (any TerminalNotificationForwarding)? = nil,
        events: (any TerminalViewportEventPublishing)?
    ) async throws -> Int {
        let limit = max(1, maxBytesPerRendererWrite)
        var pendingRendererBytes = Data()
        var rendererWriteCount = 0

        func flushRendererBytes() async throws {
            var cursor = pendingRendererBytes.startIndex
            while cursor < pendingRendererBytes.endIndex {
                let end = pendingRendererBytes.index(
                    cursor,
                    offsetBy: min(limit, pendingRendererBytes.distance(from: cursor, to: pendingRendererBytes.endIndex))
                )
                try await rendererWriter.ingestOutput(viewportID: viewportID, bytes: pendingRendererBytes.subdata(in: cursor..<end))
                rendererWriteCount += 1
                cursor = end
            }
            pendingRendererBytes = Data()
        }

        for operation in operations {
            switch operation {
            case let .rendererBytes(bytes):
                pendingRendererBytes.append(bytes)
                if pendingRendererBytes.count >= limit {
                    try await flushRendererBytes()
                }
            case let .reservedSignal(signal):
                try await flushRendererBytes()
                do {
                    try await reservedOSCForwarder?.forwardReservedOSC(signal)
                    let timestamp = clock.now()
                    await events?.publish(envelope(requestID, "ReservedOSCForwarded", timestamp, .reservedOSCForwarded(ReservedOSCSignalSummary(signal: signal))))
                } catch {
                    continue
                }
            case let .terminalNotification(notification):
                try await flushRendererBytes()
                do {
                    try await notificationForwarder?.forwardTerminalNotification(notification)
                    let timestamp = clock.now()
                    await events?.publish(envelope(requestID, "TerminalNotificationForwarded", timestamp, .terminalNotificationForwarded(TerminalNotificationEventSummary(event: notification))))
                } catch {
                    continue
                }
            case let .terminalNotificationDropped(drop):
                let timestamp = clock.now()
                await events?.publish(envelope(requestID, "TerminalNotificationDropped", timestamp, .terminalNotificationDropped(drop)))
            }
        }

        try await flushRendererBytes()
        return rendererWriteCount
    }

    static func validate(_ acknowledgement: RuntimeWriteAcknowledgement, input: SendTerminalInputInput) throws {
        guard acknowledgement.requestID == input.requestID, acknowledgement.paneID == input.paneID else {
            throw TerminalViewportError.inputRejected
        }
        switch (acknowledgement.status, acknowledgement.inputSequence, acknowledgement.rejectionCode) {
        case (.accepted, _?, nil):
            return
        case (.rejected, nil, _?):
            throw TerminalViewportError.inputRejected
        default:
            throw TerminalViewportError.inputRejected
        }
    }

    static func validate(_ acknowledgement: RuntimeResizeAcknowledgement, input: ResizeTerminalViewportInput) throws {
        guard acknowledgement.requestID == input.requestID, acknowledgement.paneID == input.paneID else {
            throw TerminalViewportError.resizeFailed
        }
        switch (acknowledgement.status, acknowledgement.size) {
        case (.accepted, input.size):
            return
        case (.rejected, nil):
            throw TerminalViewportError.resizeFailed
        default:
            throw TerminalViewportError.resizeFailed
        }
    }
}

private extension TerminalViewport.State {
    func updated(
        streamID: StreamID?? = nil,
        lastAppliedSequence: UInt64?? = nil,
        isFocused: Bool? = nil,
        streamStatus: TerminalViewport.StreamStatus? = nil,
        size: TerminalViewport.Size? = nil,
        pendingReservedOSCSequence: Data? = nil,
        pendingKittyNotificationChunks: [TerminalViewport.PendingKittyNotificationChunk]? = nil
    ) -> TerminalViewport.State {
        TerminalViewport.State(
            viewportID: viewportID,
            workspaceID: workspaceID,
            tabID: tabID,
            paneID: paneID,
            streamID: streamID ?? self.streamID,
            lastAppliedSequence: lastAppliedSequence ?? self.lastAppliedSequence,
            isFocused: isFocused ?? self.isFocused,
            rendererStatus: rendererStatus,
            streamStatus: streamStatus ?? self.streamStatus,
            size: size ?? self.size,
            pendingReservedOSCSequence: pendingReservedOSCSequence ?? self.pendingReservedOSCSequence,
            pendingKittyNotificationChunks: pendingKittyNotificationChunks ?? self.pendingKittyNotificationChunks
        )
    }
}

extension TerminalViewport {
    enum TerminalStreamOperation: Equatable, Sendable {
        case rendererBytes(Data)
        case reservedSignal(ReservedOSCSignal)
        case terminalNotification(TerminalNotificationEvent)
        case terminalNotificationDropped(TerminalNotificationDropSummary)
    }
}

/// Single render-input-boundary scanner (D-038/D-043): detects and strips the
/// reserved presence OSC and the standard notification OSCs (9, 99, 777;notify)
/// before bytes reach the renderer, buffering sequences split across chunks.
private struct TerminalStreamScanner {
    private let state: TerminalViewport.State
    private let streamID: StreamID

    init(state: TerminalViewport.State, streamID: StreamID) {
        self.state = state
        self.streamID = streamID
    }

    func scan(
        chunks: [TerminalViewport.TerminalOutputChunk],
        pending: Data
    ) throws -> (operations: [TerminalViewport.TerminalStreamOperation], pending: Data, pendingKittyChunks: [TerminalViewport.PendingKittyNotificationChunk]) {
        var pendingBytes = [UInt8](pending)
        var pendingKittyChunks = state.pendingKittyNotificationChunks
        var operations: [TerminalViewport.TerminalStreamOperation] = []

        for chunk in chunks {
            let scanned = try scanChunk([UInt8](chunk.bytes), pending: pendingBytes, pendingKittyChunks: pendingKittyChunks, sequence: chunk.sequence)
            pendingBytes = scanned.pending
            pendingKittyChunks = scanned.pendingKittyChunks
            operations.append(contentsOf: scanned.operations)
        }

        return (operations, Data(pendingBytes), pendingKittyChunks)
    }

    private enum OSCIntroducer {
        case none
        /// The chunk ends inside what could still become a tracked introducer.
        case potentialTrackedPrefix
        case tracked(identifier: Int, payloadStart: Int)
    }

    private func scanChunk(
        _ bytes: [UInt8],
        pending: [UInt8],
        pendingKittyChunks: [TerminalViewport.PendingKittyNotificationChunk],
        sequence: UInt64
    ) throws -> (operations: [TerminalViewport.TerminalStreamOperation], pending: [UInt8], pendingKittyChunks: [TerminalViewport.PendingKittyNotificationChunk]) {
        let source = pending + bytes
        var operations: [TerminalViewport.TerminalStreamOperation] = []
        var kittyChunks = pendingKittyChunks
        var rendererBytes: [UInt8] = []
        var index = 0

        func flushRendererBytes() {
            guard !rendererBytes.isEmpty else {
                return
            }
            operations.append(.rendererBytes(Data(rendererBytes)))
            rendererBytes = []
        }

        while index < source.count {
            switch introducer(in: source, at: index) {
            case .none:
                rendererBytes.append(source[index])
                index += 1
            case .potentialTrackedPrefix:
                flushRendererBytes()
                return (operations, Array(source[index...]), kittyChunks)
            case let .tracked(identifier, payloadStart):
                guard let terminator = findTerminator(in: source, startingAt: payloadStart) else {
                    flushRendererBytes()
                    let pendingSequence = Array(source[index...])
                    guard pendingSequence.count <= TerminalViewport.maxPendingReservedOSCSequenceBytes else {
                        throw TerminalViewport.TerminalViewportError.outputBackpressure
                    }
                    return (operations, pendingSequence, kittyChunks)
                }

                let payloadBytes = Array(source[payloadStart..<terminator.payloadEnd])
                if let sequenceOperations = streamOperations(identifier: identifier, payloadBytes: payloadBytes, sequence: sequence, pendingKittyChunks: &kittyChunks) {
                    flushRendererBytes()
                    operations.append(contentsOf: sequenceOperations)
                } else {
                    rendererBytes.append(contentsOf: source[index..<terminator.sequenceEnd])
                }
                index = terminator.sequenceEnd
            }
        }

        flushRendererBytes()
        return (operations, [], kittyChunks)
    }

    /// Classify the bytes at `index` as the start of a tracked OSC sequence.
    /// Tracked identifiers are matched exactly at the `;` boundary, so OSC 999
    /// or OSC 9999 never shadow OSC 9/99.
    private func introducer(in bytes: [UInt8], at index: Int) -> OSCIntroducer {
        guard bytes[index] == Self.escape else {
            return .none
        }
        guard index + 1 < bytes.count else {
            return .potentialTrackedPrefix
        }
        guard bytes[index + 1] == Self.rightBracket else {
            return .none
        }

        var cursor = index + 2
        var digits: [UInt8] = []
        while cursor < bytes.count, (0x30...0x39).contains(bytes[cursor]) {
            digits.append(bytes[cursor])
            cursor += 1
            if digits.count > Self.maxTrackedIdentifierDigits {
                return .none
            }
        }

        let digitsString = String(decoding: digits, as: UTF8.self)
        guard cursor < bytes.count else {
            let extendsToTracked = Self.trackedIdentifierStrings.contains { $0.hasPrefix(digitsString) }
            return extendsToTracked ? .potentialTrackedPrefix : .none
        }
        guard
            bytes[cursor] == Self.semicolon,
            let identifier = Int(digitsString),
            Self.trackedIdentifiers.contains(identifier)
        else {
            return .none
        }
        return .tracked(identifier: identifier, payloadStart: cursor + 1)
    }

    /// Build the stream operations for a complete tracked sequence. Returns
    /// nil when the sequence should pass through to the renderer untouched
    /// (e.g. ConEmu progress on OSC 9, a non-notify OSC 777 module). A single
    /// sequence can yield several operations (kitty chunk-buffer eviction
    /// drops preceding the triggering payload's outcome) or none at all (a
    /// kitty chunk absorbed into the reassembly buffer).
    private func streamOperations(
        identifier: Int,
        payloadBytes: [UInt8],
        sequence: UInt64,
        pendingKittyChunks: inout [TerminalViewport.PendingKittyNotificationChunk]
    ) -> [TerminalViewport.TerminalStreamOperation]? {
        if identifier == TerminalViewport.fenrirReservedOSCIdentifier {
            return [.reservedSignal(TerminalViewport.ReservedOSCSignal(
                oscIdentifier: identifier,
                payload: String(decoding: payloadBytes, as: UTF8.self),
                provenance: provenance(sequence: sequence)
            ))]
        }
        guard let source = TerminalViewport.TerminalNotificationSource(oscIdentifier: identifier) else {
            return nil
        }
        let parsed = TerminalNotificationParser.parse(source: source, payloadBytes: payloadBytes, pendingKittyChunks: pendingKittyChunks)
        if parsed.outcomes == [.passThrough] {
            return nil
        }
        pendingKittyChunks = parsed.pendingKittyChunks

        var operations: [TerminalViewport.TerminalStreamOperation] = []
        for outcome in parsed.outcomes {
            switch outcome {
            case let .notification(title, body):
                operations.append(.terminalNotification(TerminalViewport.TerminalNotificationEvent(
                    title: title,
                    body: body,
                    source: source,
                    provenance: provenance(sequence: sequence)
                )))
            case let .dropped(reason):
                operations.append(.terminalNotificationDropped(TerminalViewport.TerminalNotificationDropSummary(
                    source: source,
                    reason: reason,
                    provenance: provenance(sequence: sequence)
                )))
            case .buffered, .passThrough:
                continue
            }
        }
        return operations
    }

    private func provenance(sequence: UInt64) -> TerminalViewport.TerminalStreamProvenance {
        TerminalViewport.TerminalStreamProvenance(
            workspaceID: state.workspaceID,
            tabID: state.tabID,
            paneID: state.paneID,
            viewportID: state.viewportID,
            streamID: streamID,
            sequence: sequence
        )
    }

    private func findTerminator(in bytes: [UInt8], startingAt start: Int) -> (payloadEnd: Int, sequenceEnd: Int)? {
        var index = start
        while index < bytes.count {
            if bytes[index] == Self.bel {
                return (payloadEnd: index, sequenceEnd: index + 1)
            }
            if bytes[index] == Self.escape, index + 1 < bytes.count, bytes[index + 1] == Self.backslash {
                return (payloadEnd: index, sequenceEnd: index + 2)
            }
            index += 1
        }
        return nil
    }

    private static let escape: UInt8 = 0x1B
    private static let bel: UInt8 = 0x07
    private static let backslash: UInt8 = 0x5C
    private static let rightBracket: UInt8 = 0x5D
    private static let semicolon: UInt8 = 0x3B
    private static let trackedIdentifiers: Set<Int> = {
        var identifiers = Set(TerminalViewport.TerminalNotificationSource.allCases.map(\.oscIdentifier))
        identifiers.insert(TerminalViewport.fenrirReservedOSCIdentifier)
        return identifiers
    }()
    private static let trackedIdentifierStrings: [String] = trackedIdentifiers.map { String($0) }
    private static let maxTrackedIdentifierDigits: Int = trackedIdentifierStrings.map(\.count).max() ?? 0
}

private extension String {
    var lineCount: Int {
        guard !isEmpty else {
            return 0
        }
        return split(separator: "\n", omittingEmptySubsequences: false).count
    }
}
