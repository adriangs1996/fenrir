import Foundation
import FenrirNativeShared

public extension NativeRuntime {
    struct DiscoverRuntimeCapabilities: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let capabilityQuery: any RuntimeCapabilityQuerying
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        public init(capabilityQuery: any RuntimeCapabilityQuerying, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
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

        public init(attacher: any WorkspaceRuntimeAttaching, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.attacher = attacher
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: AttachWorkspaceRuntimeInput) async -> Result<AttachWorkspaceRuntimeResult, NativeRuntimeError> {
            do {
                if let existing = try await store.loadWorkspace(workspaceID: input.workspaceID), existing.status == .attached {
                    try NativeRuntime.validateActor(input.actor, matches: existing)
                    return .success(AttachWorkspaceRuntimeResult(requestID: input.requestID, workspace: existing, timestamp: clock.now()))
                }
                let workspace = try await attacher.attachWorkspaceRuntime(input)
                guard workspace.workspaceID == input.workspaceID, workspace.status == .attached else {
                    return .failure(.workspaceAttachFailed)
                }
                try NativeRuntime.validateActor(input.actor, matches: workspace)
                try NativeRuntime.validateLayout(workspace)
                try await store.saveWorkspace(workspace)
                let timestamp = clock.now()
                await events?.publish(NativeRuntime.envelope(input.requestID, "WorkspaceRuntimeAttached", timestamp, .workspaceRuntimeAttached(workspace.workspaceID)))
                return .success(AttachWorkspaceRuntimeResult(requestID: input.requestID, workspace: workspace, timestamp: timestamp))
            } catch {
                return .failure(NativeRuntime.map(error, fallback: .workspaceAttachFailed))
            }
        }
    }

    struct OpenWorkspaceRuntime: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let opener: any WorkspaceRuntimeOpening
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        public init(opener: any WorkspaceRuntimeOpening, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.opener = opener
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: OpenWorkspaceRuntimeInput) async -> Result<OpenWorkspaceRuntimeResult, NativeRuntimeError> {
            do {
                if let existing = try await store.loadWorkspace(workspaceID: input.workspaceID), existing.status == .attached {
                    try NativeRuntime.validateActor(input.actor, matches: existing)
                    return .success(OpenWorkspaceRuntimeResult(requestID: input.requestID, workspace: existing, timestamp: clock.now()))
                }
                let workspace = try await opener.openWorkspaceRuntime(input)
                guard workspace.status == .attached else {
                    return .failure(.workspaceOpenFailed)
                }
                try NativeRuntime.validateActor(input.actor, matches: workspace)
                try NativeRuntime.validateLayout(workspace)
                try await store.saveWorkspace(workspace)
                let timestamp = clock.now()
                await events?.publish(NativeRuntime.envelope(input.requestID, "WorkspaceRuntimeOpened", timestamp, .workspaceRuntimeOpened(workspace.workspaceID)))
                return .success(OpenWorkspaceRuntimeResult(requestID: input.requestID, workspace: workspace, timestamp: timestamp))
            } catch let error as NativeRuntimeError {
                return .failure(error)
            } catch {
                return .failure(.workspaceOpenFailed)
            }
        }
    }

    struct CloseWorkspaceRuntime: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let closer: any WorkspaceRuntimeClosing
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        public init(closer: any WorkspaceRuntimeClosing, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.closer = closer
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: CloseWorkspaceRuntimeInput) async -> Result<CloseWorkspaceRuntimeResult, NativeRuntimeError> {
            do {
                if let existing = try await store.loadWorkspace(workspaceID: input.workspaceID) {
                    try NativeRuntime.validateActor(input.actor, matches: existing)
                }
                try await closer.closeWorkspaceRuntime(input)
                try await store.deleteWorkspace(workspaceID: input.workspaceID)
                let timestamp = clock.now()
                await events?.publish(NativeRuntime.envelope(input.requestID, "WorkspaceRuntimeClosed", timestamp, .workspaceRuntimeClosed(input.workspaceID)))
                return .success(CloseWorkspaceRuntimeResult(requestID: input.requestID, workspaceID: input.workspaceID, timestamp: timestamp))
            } catch let error as NativeRuntimeError {
                return .failure(error)
            } catch {
                return .failure(.workspaceCloseFailed)
            }
        }
    }

    struct SwitchWorkspaceRuntime: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let switcher: any WorkspaceRuntimeSwitching
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        public init(switcher: any WorkspaceRuntimeSwitching, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.switcher = switcher
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: SwitchWorkspaceRuntimeInput) async -> Result<SwitchWorkspaceRuntimeResult, NativeRuntimeError> {
            do {
                if let existing = try await store.loadWorkspace(workspaceID: input.workspaceID) {
                    try NativeRuntime.validateActor(input.actor, matches: existing)
                }
                let workspace = try await switcher.switchWorkspaceRuntime(input)
                guard workspace.workspaceID == input.workspaceID, workspace.status == .attached else {
                    return .failure(.workspaceSwitchFailed)
                }
                try NativeRuntime.validateActor(input.actor, matches: workspace)
                try NativeRuntime.validateLayout(workspace)
                try await store.saveWorkspace(workspace)
                let timestamp = clock.now()
                await events?.publish(NativeRuntime.envelope(input.requestID, "WorkspaceRuntimeSwitched", timestamp, .workspaceRuntimeSwitched(workspace.workspaceID)))
                return .success(SwitchWorkspaceRuntimeResult(requestID: input.requestID, workspace: workspace, timestamp: timestamp))
            } catch let error as NativeRuntimeError {
                return .failure(error)
            } catch {
                return .failure(.workspaceSwitchFailed)
            }
        }
    }

    struct DetachWorkspaceRuntime: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let detacher: any WorkspaceRuntimeDetaching
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        public init(detacher: any WorkspaceRuntimeDetaching, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.detacher = detacher
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: DetachWorkspaceRuntimeInput) async -> Result<DetachWorkspaceRuntimeResult, NativeRuntimeError> {
            do {
                if let existing = try await store.loadWorkspace(workspaceID: input.workspaceID) {
                    try NativeRuntime.validateActor(input.actor, matches: existing)
                }
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

        public init(reconnecter: any WorkspaceRuntimeReconnecting, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.reconnecter = reconnecter
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ReconnectWorkspaceRuntimeInput) async -> Result<ReconnectWorkspaceRuntimeResult, NativeRuntimeError> {
            do {
                if let existing = try await store.loadWorkspace(workspaceID: input.workspaceID) {
                    try NativeRuntime.validateActor(input.actor, matches: existing)
                }
                let workspace = try await reconnecter.reconnectWorkspaceRuntime(input)
                guard workspace.workspaceID == input.workspaceID else {
                    return .failure(.workspaceReconnectFailed)
                }
                try NativeRuntime.validateActor(input.actor, matches: workspace)
                try NativeRuntime.validateLayout(workspace)
                try await store.saveWorkspace(workspace)
                let timestamp = clock.now()
                await events?.publish(NativeRuntime.envelope(input.requestID, "WorkspaceRuntimeReconnected", timestamp, .workspaceRuntimeReconnected(workspace.workspaceID)))
                return .success(ReconnectWorkspaceRuntimeResult(requestID: input.requestID, workspace: workspace, timestamp: timestamp))
            } catch {
                return .failure(NativeRuntime.map(error, fallback: .workspaceReconnectFailed))
            }
        }
    }

    struct EnumerateWorkspaceRuntime: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let enumerator: any WorkspaceRuntimeEnumerating
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        public init(enumerator: any WorkspaceRuntimeEnumerating, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.enumerator = enumerator
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: EnumerateWorkspaceRuntimeInput) async -> Result<EnumerateWorkspaceRuntimeResult, NativeRuntimeError> {
            do {
                let snapshot = try await enumerator.enumerateWorkspaceRuntime(input)
                guard snapshot.workspace.workspaceID == input.workspaceID else {
                    return .failure(.runtimeEnumerationFailed)
                }
                try NativeRuntime.validateActor(input.actor, matches: snapshot.workspace)
                try NativeRuntime.validateLayout(snapshot.workspace, panes: snapshot.panes)
                try await store.saveWorkspace(snapshot.workspace)
                for pane in snapshot.panes {
                    try await store.savePane(pane)
                }
                let timestamp = clock.now()
                await events?.publish(NativeRuntime.envelope(input.requestID, "WorkspaceRuntimeEnumerated", timestamp, .workspaceRuntimeEnumerated(input.workspaceID)))
                return .success(EnumerateWorkspaceRuntimeResult(requestID: input.requestID, workspace: snapshot.workspace, windows: snapshot.workspace.windows, panes: snapshot.panes, timestamp: timestamp))
            } catch let error as NativeRuntimeError {
                return .failure(error)
            } catch {
                return .failure(.runtimeEnumerationFailed)
            }
        }
    }

    struct AttachPaneRuntime: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let attacher: any PaneRuntimeAttaching
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        public init(attacher: any PaneRuntimeAttaching, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.attacher = attacher
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: AttachPaneRuntimeInput) async -> Result<AttachPaneRuntimeResult, NativeRuntimeError> {
            do {
                let workspace = try await NativeRuntime.loadWorkspaceForActor(input.workspaceID, actor: input.actor, store: store)
                let existing = try await store.loadPane(paneID: input.paneID)
                let backfill = NativeRuntime.backfill(for: existing?.stream)
                let pane = try await attacher.attachPaneRuntime(input, backfill: backfill)
                guard pane.workspaceID == input.workspaceID, pane.paneID == input.paneID, pane.stream.streamID == input.streamID else {
                    return .failure(.paneAttachFailed)
                }
                if let windowID = input.windowID, pane.windowID != windowID {
                    return .failure(.paneAttachFailed)
                }
                try NativeRuntime.validatePane(pane, belongsTo: workspace, expectedWindowID: input.windowID)
                try await store.savePane(pane)
                let timestamp = clock.now()
                await events?.publish(NativeRuntime.envelope(input.requestID, "PaneRuntimeAttached", timestamp, .paneRuntimeAttached(input.paneID)))
                return .success(AttachPaneRuntimeResult(requestID: input.requestID, pane: pane, backfill: backfill, timestamp: timestamp))
            } catch {
                return .failure(NativeRuntime.map(error, fallback: .paneAttachFailed))
            }
        }
    }

    struct FocusPaneRuntime: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let focuser: any PaneRuntimeFocusing
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        public init(focuser: any PaneRuntimeFocusing, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.focuser = focuser
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: FocusPaneRuntimeInput) async -> Result<FocusPaneRuntimeResult, NativeRuntimeError> {
            do {
                if let existing = try await store.loadWorkspace(workspaceID: input.workspaceID) {
                    try NativeRuntime.validateActor(input.actor, matches: existing)
                    guard existing.windows.contains(where: { $0.windowID == input.windowID && $0.paneIDs.contains(input.paneID) }) else {
                        return .failure(.paneFocusFailed)
                    }
                }
                let workspace = try await focuser.focusPaneRuntime(input)
                guard workspace.workspaceID == input.workspaceID,
                      workspace.activeWindowID == input.windowID,
                      workspace.windows.contains(where: { $0.windowID == input.windowID && $0.activePaneID == input.paneID })
                else {
                    return .failure(.paneFocusFailed)
                }
                try NativeRuntime.validateActor(input.actor, matches: workspace)
                try NativeRuntime.validateLayout(workspace)
                try await store.saveWorkspace(workspace)
                let timestamp = clock.now()
                await events?.publish(NativeRuntime.envelope(input.requestID, "PaneRuntimeFocused", timestamp, .paneRuntimeFocused(input.paneID)))
                return .success(FocusPaneRuntimeResult(requestID: input.requestID, workspace: workspace, timestamp: timestamp))
            } catch let error as NativeRuntimeError {
                return .failure(error)
            } catch {
                return .failure(.paneFocusFailed)
            }
        }
    }

    struct ReconnectPaneStream: FenrirAction {
        public typealias Failure = NativeRuntimeError

        let subscriber: any PaneStreamSubscribing
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        public init(subscriber: any PaneStreamSubscribing, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.subscriber = subscriber
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ReconnectPaneStreamInput) async -> Result<ReconnectPaneStreamResult, NativeRuntimeError> {
            do {
                let workspace = try await NativeRuntime.loadWorkspaceForActor(input.workspaceID, actor: input.actor, store: store)
                guard let pane = try await store.loadPane(paneID: input.paneID), pane.workspaceID == input.workspaceID, pane.status == .attached else {
                    return .failure(.paneClosed)
                }
                try NativeRuntime.validatePane(pane, belongsTo: workspace)
                let backfill = NativeRuntime.backfill(for: pane.stream)
                var envelopes: [PaneStreamEnvelope] = []
                let envelopeStream = await subscriber.reconnectPaneStream(input, stream: pane.stream, backfill: backfill)
                for try await envelope in envelopeStream {
                    envelopes.append(envelope)
                }
                let stream = try NativeRuntime.apply(envelopes: envelopes, to: pane.stream)
                try await store.savePane(PaneRuntimeState(
                    workspaceID: pane.workspaceID,
                    paneID: pane.paneID,
                    status: stream.status == .closed ? .closed : pane.status,
                    windowID: pane.windowID,
                    tmuxPaneID: pane.tmuxPaneID,
                    size: pane.size,
                    stream: stream,
                    metadata: pane.metadata
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
        let store: any NativeRuntimeStore
        let clock: any NativeRuntimeClock
        let events: (any NativeRuntimeEventPublishing)?

        public init(writer: any PaneInputWriting, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.writer = writer
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: SendPaneInputInput) async -> Result<SendPaneInputResult, NativeRuntimeError> {
            do {
                let workspace = try await NativeRuntime.loadWorkspaceForActor(input.workspaceID, actor: input.actor, store: store)
                guard let pane = try await store.loadPane(paneID: input.paneID), pane.workspaceID == input.workspaceID, pane.status == .attached else {
                    return .failure(.paneClosed)
                }
                try NativeRuntime.validatePane(pane, belongsTo: workspace)
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

        public init(resizer: any PaneRuntimeResizing, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.resizer = resizer
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ResizePaneRuntimeInput) async -> Result<ResizePaneRuntimeResult, NativeRuntimeError> {
            do {
                let capabilities = try await NativeRuntime.loadCapabilities(store: store)
                guard capabilities.paneResize else {
                    return .failure(.capabilitiesUnavailable)
                }
                let workspace = try await NativeRuntime.loadWorkspaceForActor(input.workspaceID, actor: input.actor, store: store)
                guard let pane = try await store.loadPane(paneID: input.paneID), pane.workspaceID == input.workspaceID, pane.status == .attached else {
                    return .failure(.paneClosed)
                }
                try NativeRuntime.validatePane(pane, belongsTo: workspace)
                let acknowledgement = try await resizer.resizePaneRuntime(input)
                try NativeRuntime.validate(acknowledgement, input: input)
                let timestamp = clock.now()
                if acknowledgement.status == .accepted {
                    try await store.savePane(PaneRuntimeState(workspaceID: pane.workspaceID, paneID: pane.paneID, status: pane.status, windowID: pane.windowID, tmuxPaneID: pane.tmuxPaneID, size: input.size, stream: pane.stream, metadata: pane.metadata))
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

        public init(closer: any PaneRuntimeClosing, store: any NativeRuntimeStore, clock: any NativeRuntimeClock, events: (any NativeRuntimeEventPublishing)? = nil) {
            self.closer = closer
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: ClosePaneRuntimeInput) async -> Result<ClosePaneRuntimeResult, NativeRuntimeError> {
            do {
                let capabilities = try await NativeRuntime.loadCapabilities(store: store)
                guard capabilities.paneClose else {
                    return .failure(.capabilitiesUnavailable)
                }
                let workspace = try await NativeRuntime.loadWorkspaceForActor(input.workspaceID, actor: input.actor, store: store)
                guard let pane = try await store.loadPane(paneID: input.paneID), pane.workspaceID == input.workspaceID, pane.status == .attached else {
                    return .failure(.paneClosed)
                }
                try NativeRuntime.validatePane(pane, belongsTo: workspace)
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

    static func validateActor(_ expected: RuntimeActorIdentity, matches workspace: WorkspaceRuntimeState) throws {
        guard workspace.actor == expected else {
            throw NativeRuntimeError.actorScopeMismatch
        }
    }

    static func loadCapabilities(store: any NativeRuntimeStore) async throws -> RuntimeCapabilities {
        guard let capabilities = try await store.loadCapabilities(),
              supportsRequiredRuntime(capabilities)
        else {
            throw NativeRuntimeError.capabilitiesUnavailable
        }
        return capabilities
    }

    static func loadWorkspaceForActor(
        _ workspaceID: WorkspaceID,
        actor: RuntimeActorIdentity,
        store: any NativeRuntimeStore
    ) async throws -> WorkspaceRuntimeState {
        guard let workspace = try await store.loadWorkspace(workspaceID: workspaceID),
              workspace.status == .attached || workspace.status == .reconnecting
        else {
            throw NativeRuntimeError.workspaceAttachFailed
        }
        try validateActor(actor, matches: workspace)
        try validateLayout(workspace)
        return workspace
    }

    static func validatePane(
        _ pane: PaneRuntimeState,
        belongsTo workspace: WorkspaceRuntimeState,
        expectedWindowID: FenrirWindowID? = nil
    ) throws {
        guard pane.workspaceID == workspace.workspaceID,
              pane.status == .attached,
              pane.tmuxPaneID != nil,
              workspace.attachedPaneIDs.contains(pane.paneID)
        else {
            throw NativeRuntimeError.orphanedTmuxResource
        }

        let matchingWindow = workspace.windows.first { window in
            window.paneIDs.contains(pane.paneID)
        }
        guard let matchingWindow else {
            throw NativeRuntimeError.orphanedTmuxResource
        }
        if let paneWindowID = pane.windowID, paneWindowID != matchingWindow.windowID {
            throw NativeRuntimeError.orphanedTmuxResource
        }
        if let expectedWindowID, expectedWindowID != matchingWindow.windowID {
            throw NativeRuntimeError.orphanedTmuxResource
        }
    }

    static func validateLayout(_ workspace: WorkspaceRuntimeState, panes: [PaneRuntimeState] = []) throws {
        if workspace.status == .orphaned {
            throw NativeRuntimeError.orphanedTmuxResource
        }
        if workspace.status == .attached, workspace.tmuxSessionID == nil {
            throw NativeRuntimeError.orphanedTmuxResource
        }

        let windowIDs = Set(workspace.windows.map(\.windowID))
        guard windowIDs.count == workspace.windows.count else {
            throw NativeRuntimeError.orphanedTmuxResource
        }
        if let activeWindowID = workspace.activeWindowID, !windowIDs.contains(activeWindowID) {
            throw NativeRuntimeError.orphanedTmuxResource
        }

        let declaredPaneIDs = Set(workspace.windows.flatMap(\.paneIDs))
        for window in workspace.windows {
            guard window.workspaceID == workspace.workspaceID else {
                throw NativeRuntimeError.orphanedTmuxResource
            }
            if let activePaneID = window.activePaneID, !window.paneIDs.contains(activePaneID) {
                throw NativeRuntimeError.orphanedTmuxResource
            }
        }

        for pane in panes {
            guard pane.workspaceID == workspace.workspaceID,
                  pane.status != .orphaned,
                  declaredPaneIDs.contains(pane.paneID)
            else {
                throw NativeRuntimeError.orphanedTmuxResource
            }
            if let windowID = pane.windowID, !windowIDs.contains(windowID) {
                throw NativeRuntimeError.orphanedTmuxResource
            }
        }
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
            case .backfillStarted:
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
                    status: .live
                )
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
        case .backfillStarted:
            return
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
