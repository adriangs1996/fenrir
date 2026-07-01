import Foundation
import FenrirNativeShared

public extension NativeRuntime {
    struct DiscoverRuntimeCapabilities: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let capabilityQuery: any RuntimeCapabilityQuerying
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        init(capabilityQuery: any RuntimeCapabilityQuerying, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.capabilityQuery = capabilityQuery
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: DiscoverRuntimeCapabilitiesInput) async -> Result<DiscoverRuntimeCapabilitiesResult, NativeRuntimeError> {
            do {
                let capabilities = try await capabilityQuery.discoverRuntimeCapabilities(input)
                guard NativeRuntime.supportsRequiredRuntime(capabilities) else {
                    return .failure(.capabilitiesUnavailable)
                }
                try await store.saveCapabilities(capabilities)
                let timestamp = clock.now()
                await events?.publish(NativeRuntime.envelope(input.requestID, "RuntimeCapabilitiesDiscovered", timestamp, .runtimeCapabilitiesDiscovered))
                return .success(DiscoverRuntimeCapabilitiesResult(requestID: input.requestID, capabilities: capabilities, timestamp: timestamp))
            } catch {
                return .failure(NativeRuntime.map(error, fallback: .capabilitiesUnavailable))
            }
        }
    }

    struct AttachWorkspaceRuntime: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let attacher: any WorkspaceRuntimeAttaching
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        init(attacher: any WorkspaceRuntimeAttaching, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.attacher = attacher
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: AttachWorkspaceRuntimeInput) async -> Result<AttachWorkspaceRuntimeResult, NativeRuntimeError> {
            do {
                let workspace = try await attacher.attachWorkspaceRuntime(input)
                guard workspace.workspaceID == input.workspaceID, workspace.status == .attached else {
                    return .failure(.workspaceAttachFailed)
                }
                try await store.saveWorkspace(workspace)
                let timestamp = clock.now()
                await events?.publish(NativeRuntime.envelope(input.requestID, "WorkspaceRuntimeAttached", timestamp, .workspaceRuntimeAttached(workspace.workspaceID)))
                return .success(AttachWorkspaceRuntimeResult(requestID: input.requestID, workspace: workspace, timestamp: timestamp))
            } catch {
                return .failure(NativeRuntime.map(error, fallback: .workspaceAttachFailed))
            }
        }
    }

    struct DetachWorkspaceRuntime: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let detacher: any WorkspaceRuntimeDetaching
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        init(detacher: any WorkspaceRuntimeDetaching, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.detacher = detacher
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: DetachWorkspaceRuntimeInput) async -> Result<DetachWorkspaceRuntimeResult, NativeRuntimeError> {
            do {
                try await detacher.detachWorkspaceRuntime(input)
                try await store.deleteWorkspace(workspaceID: input.workspaceID)
                let timestamp = clock.now()
                await events?.publish(NativeRuntime.envelope(input.requestID, "WorkspaceRuntimeDetached", timestamp, .workspaceRuntimeDetached(input.workspaceID)))
                return .success(DetachWorkspaceRuntimeResult(requestID: input.requestID, workspaceID: input.workspaceID, timestamp: timestamp))
            } catch {
                return .failure(NativeRuntime.map(error, fallback: .workspaceDetachFailed))
            }
        }
    }

    struct ReconnectWorkspaceRuntime: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let reconnecter: any WorkspaceRuntimeReconnecting
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        init(reconnecter: any WorkspaceRuntimeReconnecting, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.reconnecter = reconnecter
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ReconnectWorkspaceRuntimeInput) async -> Result<ReconnectWorkspaceRuntimeResult, NativeRuntimeError> {
            do {
                let workspace = try await reconnecter.reconnectWorkspaceRuntime(input)
                guard workspace.workspaceID == input.workspaceID else {
                    return .failure(.workspaceReconnectFailed)
                }
                try await store.saveWorkspace(workspace)
                let timestamp = clock.now()
                await events?.publish(NativeRuntime.envelope(input.requestID, "WorkspaceRuntimeReconnected", timestamp, .workspaceRuntimeReconnected(workspace.workspaceID)))
                return .success(ReconnectWorkspaceRuntimeResult(requestID: input.requestID, workspace: workspace, timestamp: timestamp))
            } catch {
                return .failure(NativeRuntime.map(error, fallback: .workspaceReconnectFailed))
            }
        }
    }

    struct AttachPaneRuntime: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let attacher: any PaneRuntimeAttaching
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        init(attacher: any PaneRuntimeAttaching, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.attacher = attacher
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: AttachPaneRuntimeInput) async -> Result<AttachPaneRuntimeResult, NativeRuntimeError> {
            do {
                let existing = try await store.loadPane(paneID: input.paneID)
                let backfill = NativeRuntime.backfill(for: existing?.stream)
                let pane = try await attacher.attachPaneRuntime(input, backfill: backfill)
                guard pane.workspaceID == input.workspaceID, pane.paneID == input.paneID, pane.stream.streamID == input.streamID else {
                    return .failure(.paneAttachFailed)
                }
                try await store.savePane(pane)
                let timestamp = clock.now()
                await events?.publish(NativeRuntime.envelope(input.requestID, "PaneRuntimeAttached", timestamp, .paneRuntimeAttached(input.paneID)))
                return .success(AttachPaneRuntimeResult(requestID: input.requestID, pane: pane, backfill: backfill, timestamp: timestamp))
            } catch {
                return .failure(NativeRuntime.map(error, fallback: .paneAttachFailed))
            }
        }
    }

    struct ReconnectPaneStream: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let subscriber: any PaneStreamSubscribing
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        init(subscriber: any PaneStreamSubscribing, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.subscriber = subscriber
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ReconnectPaneStreamInput) async -> Result<ReconnectPaneStreamResult, NativeRuntimeError> {
            do {
                guard let pane = try await store.loadPane(paneID: input.paneID), pane.workspaceID == input.workspaceID, pane.status == .attached else {
                    return .failure(.paneClosed)
                }
                let backfill = NativeRuntime.backfill(for: pane.stream)
                let envelopes = try await subscriber.reconnectPaneStream(input, stream: pane.stream, backfill: backfill)
                let stream = try NativeRuntime.apply(envelopes: envelopes, to: pane.stream)
                try await store.savePane(PaneRuntimeState(
                    workspaceID: pane.workspaceID,
                    paneID: pane.paneID,
                    status: stream.status == .closed ? .closed : pane.status,
                    size: pane.size,
                    stream: stream
                ))

                let timestamp = clock.now()
                for envelope in envelopes {
                    await NativeRuntime.publish(envelope, requestID: input.requestID, timestamp: timestamp, events: events)
                }
                return .success(ReconnectPaneStreamResult(requestID: input.requestID, stream: stream, envelopes: envelopes, backfill: backfill, timestamp: timestamp))
            } catch let error as NativeRuntimeError {
                return .failure(error)
            } catch {
                return .failure(.paneStreamFailed)
            }
        }
    }

    struct SendPaneInput: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let writer: any PaneInputWriting
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        init(writer: any PaneInputWriting, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.writer = writer
            self.clock = clock
            self.events = events
        }

        public func run(_ input: SendPaneInputInput) async -> Result<SendPaneInputResult, NativeRuntimeError> {
            do {
                let acknowledgement = try await writer.writePaneInput(input)
                try NativeRuntime.validate(acknowledgement, input: input)
                let timestamp = clock.now()

                switch acknowledgement.status {
                case .accepted:
                    await events?.publish(NativeRuntime.envelope(input.requestID, "PaneInputAccepted", timestamp, .paneInputAccepted(input.paneID, acknowledgement.inputSeq!)))
                case .rejected:
                    await events?.publish(NativeRuntime.envelope(input.requestID, "PaneInputRejected", timestamp, .paneInputRejected(input.paneID, acknowledgement.rejectionCode!)))
                }

                return .success(SendPaneInputResult(requestID: input.requestID, acknowledgement: acknowledgement, timestamp: timestamp))
            } catch let error as NativeRuntimeError {
                return .failure(error)
            } catch {
                return .failure(.serverUnavailable)
            }
        }
    }

    struct ResizePaneRuntime: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let resizer: any PaneRuntimeResizing
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        init(resizer: any PaneRuntimeResizing, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.resizer = resizer
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ResizePaneRuntimeInput) async -> Result<ResizePaneRuntimeResult, NativeRuntimeError> {
            do {
                let acknowledgement = try await resizer.resizePaneRuntime(input)
                try NativeRuntime.validate(acknowledgement, input: input)
                let timestamp = clock.now()
                if acknowledgement.status == .accepted {
                    if let pane = try await store.loadPane(paneID: input.paneID) {
                        try await store.savePane(PaneRuntimeState(workspaceID: pane.workspaceID, paneID: pane.paneID, status: pane.status, size: input.size, stream: pane.stream))
                    }
                    await events?.publish(NativeRuntime.envelope(input.requestID, "PaneResizeRequested", timestamp, .paneResizeRequested(input.paneID, input.size)))
                    return .success(ResizePaneRuntimeResult(requestID: input.requestID, acknowledgement: acknowledgement, timestamp: timestamp))
                }
                return .failure(.paneResizeRejected)
            } catch let error as NativeRuntimeError {
                return .failure(error)
            } catch {
                return .failure(.serverUnavailable)
            }
        }
    }

    struct ClosePaneRuntime: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let closer: any PaneRuntimeClosing
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        init(closer: any PaneRuntimeClosing, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.closer = closer
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ClosePaneRuntimeInput) async -> Result<ClosePaneRuntimeResult, NativeRuntimeError> {
            do {
                try await closer.closePaneRuntime(input)
                try await store.deletePane(paneID: input.paneID)
                let timestamp = clock.now()
                await events?.publish(NativeRuntime.envelope(input.requestID, "PaneStreamClosed", timestamp, .paneStreamClosed(input.paneID)))
                return .success(ClosePaneRuntimeResult(requestID: input.requestID, paneID: input.paneID, timestamp: timestamp))
            } catch {
                return .failure(NativeRuntime.map(error, fallback: .paneClosed))
            }
        }
    }
}

private extension NativeRuntime {
    static func envelope(_ requestID: RequestID, _ kind: String, _ timestamp: FenrirTimestamp, _ event: Event) -> EventEnvelope<Event> {
        EventEnvelope(eventID: requestID, eventKind: kind, timestamp: timestamp, event: event)
    }

    static func supportsRequiredRuntime(_ capabilities: RuntimeCapabilities) -> Bool {
        capabilities.tmuxKernel && capabilities.paneStreams && capabilities.writeAcknowledgements
    }

    static func backfill(for stream: PaneStreamState?) -> BackfillMode {
        guard let lastObservedSeq = stream?.lastObservedSeq else {
            return .latest
        }
        return .fromSeq(lastObservedSeq)
    }

    static func validate(_ acknowledgement: PaneWriteAck, input: SendPaneInputInput) throws {
        guard acknowledgement.requestID == input.requestID, acknowledgement.paneID == input.paneID else {
            throw NativeRuntimeError.malformedWriteAcknowledgement
        }
        switch (acknowledgement.status, acknowledgement.inputSeq, acknowledgement.rejectionCode) {
        case (.accepted, _?, nil):
            return
        case (.rejected, nil, _?):
            throw NativeRuntimeError.paneWriteRejected
        default:
            throw NativeRuntimeError.malformedWriteAcknowledgement
        }
    }

    static func validate(_ acknowledgement: PaneResizeAck, input: ResizePaneRuntimeInput) throws {
        guard acknowledgement.requestID == input.requestID, acknowledgement.paneID == input.paneID else {
            throw NativeRuntimeError.malformedResizeAcknowledgement
        }
        switch (acknowledgement.status, acknowledgement.size) {
        case (.accepted, input.size):
            return
        case (.rejected, nil):
            throw NativeRuntimeError.paneResizeRejected
        default:
            throw NativeRuntimeError.malformedResizeAcknowledgement
        }
    }

    static func apply(envelopes: [PaneStreamEnvelope], to stream: PaneStreamState) throws -> PaneStreamState {
        var next = stream
        for envelope in envelopes {
            guard envelope.paneID == stream.paneID, envelope.streamID == stream.streamID else {
                throw NativeRuntimeError.malformedStreamEnvelope
            }
            switch envelope.kind {
            case .output:
                guard
                    let sequence = envelope.sequence,
                    envelope.bytes != nil,
                    envelope.lowReplaySeq == nil,
                    envelope.highReplaySeq == nil
                else {
                    throw NativeRuntimeError.malformedStreamEnvelope
                }
                if let last = next.lastObservedSeq, sequence <= last {
                    throw NativeRuntimeError.malformedStreamEnvelope
                }
                next = PaneStreamState(
                    paneID: next.paneID,
                    streamID: next.streamID,
                    lastObservedSeq: sequence,
                    lowReplaySeq: next.lowReplaySeq,
                    highReplaySeq: max(next.highReplaySeq ?? sequence, sequence),
                    overflowCount: next.overflowCount,
                    status: .live
                )
            case .gap:
                guard
                    envelope.sequence == nil,
                    envelope.bytes == nil,
                    let lowReplaySeq = envelope.lowReplaySeq,
                    let highReplaySeq = envelope.highReplaySeq,
                    lowReplaySeq <= highReplaySeq
                else {
                    throw NativeRuntimeError.malformedStreamEnvelope
                }
                next = PaneStreamState(
                    paneID: next.paneID,
                    streamID: next.streamID,
                    lastObservedSeq: next.lastObservedSeq,
                    lowReplaySeq: lowReplaySeq,
                    highReplaySeq: highReplaySeq,
                    overflowCount: next.overflowCount,
                    status: .gap
                )
            case .overflow:
                guard envelope.sequence == nil, envelope.bytes == nil, envelope.lowReplaySeq == nil, envelope.highReplaySeq == nil else {
                    throw NativeRuntimeError.malformedStreamEnvelope
                }
                next = PaneStreamState(
                    paneID: next.paneID,
                    streamID: next.streamID,
                    lastObservedSeq: next.lastObservedSeq,
                    lowReplaySeq: next.lowReplaySeq,
                    highReplaySeq: next.highReplaySeq,
                    overflowCount: next.overflowCount + 1,
                    status: .overflow
                )
            case .closed:
                guard envelope.sequence == nil, envelope.bytes == nil, envelope.lowReplaySeq == nil, envelope.highReplaySeq == nil else {
                    throw NativeRuntimeError.malformedStreamEnvelope
                }
                next = PaneStreamState(
                    paneID: next.paneID,
                    streamID: next.streamID,
                    lastObservedSeq: next.lastObservedSeq,
                    lowReplaySeq: next.lowReplaySeq,
                    highReplaySeq: next.highReplaySeq,
                    overflowCount: next.overflowCount,
                    status: .closed
                )
            }
        }
        return next
    }

    static func publish(_ envelope: PaneStreamEnvelope, requestID: RequestID, timestamp: FenrirTimestamp, events: (any NativeRuntimeEventPublishing)?) async {
        switch envelope.kind {
        case .output:
            if let sequence = envelope.sequence {
                await events?.publish(self.envelope(requestID, "PaneOutputReceived", timestamp, .paneOutputReceived(envelope.paneID, sequence)))
            }
        case .gap:
            await events?.publish(self.envelope(requestID, "PaneStreamGapDetected", timestamp, .paneStreamGapDetected(envelope.paneID)))
        case .overflow:
            await events?.publish(self.envelope(requestID, "PaneStreamOverflowDetected", timestamp, .paneStreamOverflowDetected(envelope.paneID)))
        case .closed:
            await events?.publish(self.envelope(requestID, "PaneStreamClosed", timestamp, .paneStreamClosed(envelope.paneID)))
        }
    }

    static func map(_ error: Error, fallback: NativeRuntimeError) -> NativeRuntimeError {
        if let error = error as? NativeRuntimeError {
            return error
        }
        return fallback
    }
}
