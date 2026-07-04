import Foundation
import FenrirNativeShared

public extension NativeRuntime {
    struct ServerTmuxRuntimeAdapter: RuntimeCapabilityQuerying, WorkspaceRuntimeAttaching, WorkspaceRuntimeOpening, WorkspaceRuntimeClosing, WorkspaceRuntimeSwitching, WorkspaceRuntimeDetaching, WorkspaceRuntimeReconnecting, WorkspaceRuntimeEnumerating, PaneRuntimeAttaching, PaneRuntimeFocusing, PaneStreamSubscribing, PaneInputWriting, PaneRuntimeResizing, PaneRuntimeCreating, AgentPaneRuntimeCreating, PaneAgentMetadataAttaching, PaneRuntimeClosing {
        public let transport: any ServerRPCTransport
        public let defaultWorkingDirectory: String
        public let maxBufferedStreamChunks: Int

        public init(
            transport: any ServerRPCTransport,
            defaultWorkingDirectory: String = FileManager.default.homeDirectoryForCurrentUser.path,
            maxBufferedStreamChunks: Int = 256
        ) {
            self.transport = transport
            self.defaultWorkingDirectory = defaultWorkingDirectory
            self.maxBufferedStreamChunks = max(1, maxBufferedStreamChunks)
        }

        public func discoverRuntimeCapabilities(_ input: DiscoverRuntimeCapabilitiesInput) async throws -> RuntimeCapabilities {
            RuntimeCapabilities(tmuxKernel: true, paneStreams: true, writeAcknowledgements: true)
        }

        public func attachWorkspaceRuntime(_ input: AttachWorkspaceRuntimeInput) async throws -> WorkspaceRuntimeState {
            try await snapshot(method: "tmux.workspace.getSnapshot", input: SnapshotInput(actor: actor(input.actor), workspaceId: input.workspaceID.rawValue), requestID: input.requestID, actor: input.actor).workspace
        }

        public func openWorkspaceRuntime(_ input: OpenWorkspaceRuntimeInput) async throws -> WorkspaceRuntimeState {
            try await snapshot(
                method: "tmux.workspace.ensure",
                input: EnsureWorkspaceInput(
                    actor: actor(input.actor),
                    workspaceId: input.workspaceID.rawValue,
                    projectId: input.projectID ?? input.workspaceID.rawValue,
                    cwd: input.workingDirectory ?? defaultWorkingDirectory,
                    initialGrants: [PermissionGrant(actor: actor(input.actor), permissions: [
                        "workspace:read",
                        "workspace:control",
                        "window:control",
                        "pane:read",
                        "pane:write",
                        "pane:control",
                        "process:spawn",
                        "session:destroy",
                        "permissions:admin"
                    ], grantedAt: grantedAt(), expiresAt: nil)]
                ),
                requestID: input.requestID,
                actor: input.actor
            ).workspace
        }

        public func closeWorkspaceRuntime(_ input: CloseWorkspaceRuntimeInput) async throws {
            let current = try await snapshot(method: "tmux.workspace.getSnapshot", input: SnapshotInput(actor: actor(input.actor), workspaceId: input.workspaceID.rawValue), requestID: input.requestID, actor: input.actor)
            for window in current.workspace.windows {
                try await send("tmux.window.close", WindowCloseInput(actor: actor(input.actor), workspaceId: input.workspaceID.rawValue, windowId: window.windowID.rawValue, mode: "destroy"), requestID: input.requestID, decode: ServerSnapshot.self)
            }
        }

        public func switchWorkspaceRuntime(_ input: SwitchWorkspaceRuntimeInput) async throws -> WorkspaceRuntimeState {
            try await attachWorkspaceRuntime(AttachWorkspaceRuntimeInput(requestID: input.requestID, workspaceID: input.workspaceID, actor: input.actor, source: input.source))
        }

        public func detachWorkspaceRuntime(_ input: DetachWorkspaceRuntimeInput) async throws {
            _ = try await snapshot(method: "tmux.workspace.getSnapshot", input: SnapshotInput(actor: actor(input.actor), workspaceId: input.workspaceID.rawValue), requestID: input.requestID, actor: input.actor)
        }

        public func reconnectWorkspaceRuntime(_ input: ReconnectWorkspaceRuntimeInput) async throws -> WorkspaceRuntimeState {
            try await snapshot(method: "tmux.workspace.reconnect", input: SnapshotInput(actor: actor(input.actor), workspaceId: input.workspaceID.rawValue), requestID: input.requestID, actor: input.actor).workspace
        }

        public func enumerateWorkspaceRuntime(_ input: EnumerateWorkspaceRuntimeInput) async throws -> (workspace: WorkspaceRuntimeState, panes: [PaneRuntimeState]) {
            let mapped = try await snapshot(method: "tmux.workspace.getSnapshot", input: SnapshotInput(actor: actor(input.actor), workspaceId: input.workspaceID.rawValue), requestID: input.requestID, actor: input.actor)
            return (mapped.workspace, mapped.panes)
        }

        public func attachPaneRuntime(_ input: AttachPaneRuntimeInput, backfill: BackfillMode) async throws -> PaneRuntimeState {
            let mapped = try await snapshot(method: "tmux.workspace.getSnapshot", input: SnapshotInput(actor: actor(input.actor), workspaceId: input.workspaceID.rawValue), requestID: input.requestID, actor: input.actor)
            guard let pane = mapped.panes.first(where: { $0.paneID == input.paneID }) else {
                throw NativeRuntimeError.orphanedTmuxResource
            }
            let stream = await subscribe(input.requestID, actor: input.actor, workspaceID: input.workspaceID, paneID: input.paneID, backfill: backfill)
            var iterator = stream.makeAsyncIterator()
            _ = try await iterator.next()
            return PaneRuntimeState(
                workspaceID: pane.workspaceID,
                paneID: pane.paneID,
                status: pane.status,
                windowID: pane.windowID,
                tmuxPaneID: pane.tmuxPaneID,
                size: pane.size,
                stream: PaneStreamState(paneID: pane.paneID, streamID: input.streamID, lastObservedSeq: pane.stream.lastObservedSeq, lowReplaySeq: pane.stream.lowReplaySeq, highReplaySeq: pane.stream.highReplaySeq, overflowCount: pane.stream.overflowCount, status: .live),
                metadata: pane.metadata
            )
        }

        public func focusPaneRuntime(_ input: FocusPaneRuntimeInput) async throws -> WorkspaceRuntimeState {
            let mapped = try await snapshot(method: "tmux.pane.focus", input: PaneFocusInput(actor: actor(input.actor), workspaceId: input.workspaceID.rawValue, paneId: input.paneID.rawValue), requestID: input.requestID, actor: input.actor)
            guard mapped.workspace.windows.contains(where: { $0.windowID == input.windowID && $0.paneIDs.contains(input.paneID) }) else {
                throw NativeRuntimeError.orphanedTmuxResource
            }
            return mapped.workspace
        }

        public func reconnectPaneStream(_ input: ReconnectPaneStreamInput, stream: PaneStreamState, backfill: BackfillMode) async -> AsyncThrowingStream<PaneStreamEnvelope, Error> {
            await subscribe(input.requestID, actor: input.actor, workspaceID: input.workspaceID, paneID: input.paneID, backfill: backfill)
        }

        public func writePaneInput(_ input: SendPaneInputInput) async throws -> PaneWriteAck {
            guard let text = String(data: input.inputBytes, encoding: .utf8), !text.isEmpty else {
                throw NativeRuntimeError.malformedWriteAcknowledgement
            }
            let result = try await send("tmux.pane.write", PaneWriteInput(workspaceId: input.workspaceID.rawValue, paneId: input.paneID.rawValue, actor: actor(input.actor), requestId: input.requestID.rawValue, data: text), requestID: input.requestID, decode: PaneWriteResult.self)
            switch result.type {
            case "accepted":
                guard let inputSeq = result.inputSeq else {
                    throw NativeRuntimeError.malformedWriteAcknowledgement
                }
                guard result.workspaceId == input.workspaceID.rawValue else {
                    throw NativeRuntimeError.malformedWriteAcknowledgement
                }
                return PaneWriteAck(requestID: RequestID(rawValue: result.requestId), paneID: PaneID(rawValue: result.paneId), status: .accepted, inputSeq: UInt64(inputSeq))
            case "rejected":
                guard result.workspaceId == input.workspaceID.rawValue else {
                    throw NativeRuntimeError.malformedWriteAcknowledgement
                }
                return PaneWriteAck(requestID: RequestID(rawValue: result.requestId), paneID: PaneID(rawValue: result.paneId), status: .rejected, rejectionCode: rejectionCode(result.code))
            default:
                throw NativeRuntimeError.malformedWriteAcknowledgement
            }
        }

        public func resizePaneRuntime(_ input: ResizePaneRuntimeInput) async throws -> PaneResizeAck {
            let pane = try await send("tmux.pane.resize", PaneResizeInput(actor: actor(input.actor), workspaceId: input.workspaceID.rawValue, paneId: input.paneID.rawValue, cols: input.size.columns, rows: input.size.rows), requestID: input.requestID, decode: ServerPane.self)
            return PaneResizeAck(requestID: input.requestID, paneID: PaneID(rawValue: pane.paneId), status: .accepted, size: PaneSize(columns: pane.cols, rows: pane.rows))
        }

        /// Creates a real tmux pane running the managed-process command
        /// (D-019/D-045) through `tmux.pane.create` and resolves it out of the
        /// returned workspace snapshot by its unique managed-process
        /// `instanceId`. The server snapshot retains closed panes, so the
        /// metadata marker — not a pane diff — is the authoritative identity.
        public func createPaneRuntime(_ input: CreatePaneRuntimeInput) async throws -> PaneRuntimeState {
            let spec = input.managedProcess
            guard
                isTrimmedNonEmpty(spec.title),
                isTrimmedNonEmpty(spec.command),
                isTrimmedNonEmpty(spec.instanceID),
                isTrimmedNonEmpty(spec.processDefID)
            else {
                throw NativeRuntimeError.paneCreateFailed
            }
            let mapped = try await snapshot(
                method: "tmux.pane.create",
                input: PaneCreateInput(
                    actor: actor(input.actor),
                    workspaceId: input.workspaceID.rawValue,
                    windowId: input.windowID.rawValue,
                    cwd: input.workingDirectory,
                    command: spec.command,
                    split: input.split.rawValue,
                    kind: "managed-process",
                    metadata: ManagedProcessPaneMetadataInput(
                        title: spec.title,
                        command: spec.command,
                        instanceId: spec.instanceID,
                        processDefId: spec.processDefID,
                        labels: spec.labels
                    )
                ),
                requestID: input.requestID,
                actor: input.actor
            )
            guard let pane = mapped.panes.first(where: { candidate in
                candidate.status != .closed && candidate.metadata?.managedProcess?.instanceID == spec.instanceID
            }) else {
                throw NativeRuntimeError.paneCreateFailed
            }
            return pane
        }

        /// Creates a real tmux pane running a validated agent resume command
        /// (D-044) through the same `tmux.pane.create` wire path as script
        /// panes, but carrying `agent` metadata. The created pane resolves by
        /// its unique `agent.providerInstanceId` marker — never by pane
        /// diffing (the server snapshot retains closed panes).
        public func createAgentPaneRuntime(_ input: CreateAgentPaneRuntimeInput) async throws -> PaneRuntimeState {
            let spec = input.agent
            guard
                isTrimmedNonEmpty(spec.title),
                isTrimmedNonEmpty(spec.command),
                isTrimmedNonEmpty(spec.providerID),
                isTrimmedNonEmpty(spec.instanceID)
            else {
                throw NativeRuntimeError.paneCreateFailed
            }
            let mapped = try await snapshot(
                method: "tmux.pane.create",
                input: PaneCreateInput(
                    actor: actor(input.actor),
                    workspaceId: input.workspaceID.rawValue,
                    windowId: input.windowID.rawValue,
                    cwd: input.workingDirectory,
                    command: spec.command,
                    split: input.split.rawValue,
                    kind: "agent",
                    metadata: AgentPaneMetadataInput(
                        title: spec.title,
                        command: spec.command,
                        providerId: spec.providerID,
                        providerInstanceId: spec.instanceID,
                        labels: spec.labels
                    )
                ),
                requestID: input.requestID,
                actor: input.actor
            )
            guard let pane = mapped.panes.first(where: { candidate in
                candidate.status != .closed && candidate.metadata?.agent?.providerInstanceID == spec.instanceID
            }) else {
                throw NativeRuntimeError.paneCreateFailed
            }
            return pane
        }

        /// Attaches D-044 resumability metadata ({agentID, sessionID}) to an
        /// existing pane through `tmux.pane.attachMetadata`, mirroring the
        /// server's `TmuxPaneAttachMetadataInput` schema. The RPC returns the
        /// updated pane record.
        public func attachAgentPaneMetadata(_ input: AttachAgentPaneMetadataInput) async throws -> PaneRuntimeState {
            guard isTrimmedNonEmpty(input.agentID), isTrimmedNonEmpty(input.sessionID) else {
                throw NativeRuntimeError.paneMetadataAttachFailed
            }
            let pane = try await send(
                "tmux.pane.attachMetadata",
                PaneAttachMetadataInput(
                    actor: actor(input.actor),
                    workspaceId: input.workspaceID.rawValue,
                    paneId: input.paneID.rawValue,
                    metadata: AgentPaneMetadataInput(
                        title: input.title ?? input.agentID,
                        command: nil,
                        providerId: input.agentID,
                        providerInstanceId: input.sessionID,
                        labels: input.labels
                    )
                ),
                requestID: input.requestID,
                decode: ServerPane.self
            )
            guard pane.workspaceId == input.workspaceID.rawValue, pane.paneId == input.paneID.rawValue else {
                throw NativeRuntimeError.paneMetadataAttachFailed
            }
            return mapPane(pane)
        }

        public func closePaneRuntime(_ input: ClosePaneRuntimeInput) async throws {
            _ = try await send("tmux.pane.close", PaneCloseInput(actor: actor(input.actor), workspaceId: input.workspaceID.rawValue, paneId: input.paneID.rawValue, mode: "terminate"), requestID: input.requestID, decode: ServerSnapshot.self)
        }

        private func subscribe(_ requestID: RequestID, actor: RuntimeActorIdentity, workspaceID: WorkspaceID, paneID: PaneID, backfill: BackfillMode) async -> AsyncThrowingStream<PaneStreamEnvelope, Error> {
            AsyncThrowingStream { continuation in
                do {
                    let input = PaneStreamSubscribeInput(
                        workspaceId: workspaceID.rawValue,
                        paneId: paneID.rawValue,
                        actor: self.actor(actor),
                        afterSeq: afterSeq(backfill),
                        backfill: serverBackfill(backfill),
                        slowClientPolicy: "fast-forward",
                        maxBufferedChunks: maxBufferedStreamChunks
                    )
                    let request = try ServerRPCRequest(requestID: requestID, method: "tmux.pane.subscribeStream", payload: encode(input))
                    let task = Task {
                        do {
                            let responseStream = await transport.stream(request)
                            for try await data in responseStream {
                                try continuation.yield(decode(PaneStreamEvent.self, from: data).envelope())
                            }
                            continuation.finish()
                        } catch {
                            continuation.finish(throwing: error)
                        }
                    }
                    continuation.onTermination = { _ in task.cancel() }
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }

        private func snapshot<Input: Encodable>(method: String, input: Input, requestID: RequestID, actor: RuntimeActorIdentity) async throws -> (workspace: WorkspaceRuntimeState, panes: [PaneRuntimeState]) {
            try map(try await send(method, input, requestID: requestID, decode: ServerSnapshot.self), actor: actor)
        }

        @discardableResult
        private func send<Input: Encodable, Output: Decodable>(_ method: String, _ input: Input, requestID: RequestID, decode output: Output.Type) async throws -> Output {
            let request = try ServerRPCRequest(requestID: requestID, method: method, payload: encode(input))
            return try self.decode(Output.self, from: try await transport.request(request))
        }

        private func encode<Input: Encodable>(_ input: Input) throws -> Data {
            let encoder = JSONEncoder()
            return try encoder.encode(input)
        }

        private func decode<Output: Decodable>(_ output: Output.Type, from data: Data) throws -> Output {
            try JSONDecoder().decode(Output.self, from: data)
        }

        private func actor(_ actor: RuntimeActorIdentity) -> ServerActor {
            ServerActor(sessionId: actor.authSessionID, subject: actor.subject)
        }

        private func map(_ snapshot: ServerSnapshot, actor: RuntimeActorIdentity) throws -> (workspace: WorkspaceRuntimeState, panes: [PaneRuntimeState]) {
            let windowPanes = Dictionary(grouping: snapshot.panes, by: \.windowId)
            let windows = snapshot.windows.map { window in
                let panes = windowPanes[window.windowId] ?? []
                return WindowRuntimeState(
                    workspaceID: WorkspaceID(rawValue: window.workspaceId),
                    windowID: FenrirWindowID(rawValue: window.windowId),
                    tmuxWindowID: TmuxWindowID(rawValue: window.tmuxWindowId),
                    index: window.tmuxWindowIndex,
                    title: window.name,
                    activePaneID: window.activePaneId.map(PaneID.init(rawValue:)),
                    paneIDs: panes.map { PaneID(rawValue: $0.paneId) }
                )
            }
            let panes = snapshot.panes.map(mapPane)
            let workspace = WorkspaceRuntimeState(
                workspaceID: WorkspaceID(rawValue: snapshot.workspace.workspaceId),
                status: workspaceStatus(snapshot.workspace.status),
                actor: actor,
                tmuxSessionID: TmuxSessionID(rawValue: snapshot.workspace.tmuxSessionName),
                windows: windows,
                activeWindowID: snapshot.workspace.activeWindowId.map(FenrirWindowID.init(rawValue:)),
                attachedPaneIDs: panes.filter { $0.status == .attached }.map(\.paneID),
                generation: UInt64(snapshot.revision)
            )
            return (workspace, panes)
        }

        private func mapPane(_ pane: ServerPane) -> PaneRuntimeState {
            PaneRuntimeState(
                workspaceID: WorkspaceID(rawValue: pane.workspaceId),
                paneID: PaneID(rawValue: pane.paneId),
                status: paneStatus(pane.status),
                windowID: FenrirWindowID(rawValue: pane.windowId),
                tmuxPaneID: TmuxPaneID(rawValue: pane.tmuxPaneId),
                x: pane.x,
                y: pane.y,
                size: PaneSize(columns: pane.cols, rows: pane.rows),
                stream: PaneStreamState(paneID: PaneID(rawValue: pane.paneId), streamID: StreamID(rawValue: pane.stream.streamId), lastObservedSeq: UInt64(pane.stream.highSeq), lowReplaySeq: UInt64(pane.stream.lowSeq), highReplaySeq: UInt64(pane.stream.highSeq), overflowCount: UInt64(pane.stream.droppedCount), status: .live),
                metadata: pane.metadata.runtimeMetadata()
            )
        }

        private func workspaceStatus(_ status: String) -> WorkspaceRuntimeStatus {
            switch status {
            case "running":
                .attached
            case "starting":
                .reconnecting
            case "detached":
                .detached
            case "exited":
                .closed
            default:
                .orphaned
            }
        }

        private func paneStatus(_ status: String) -> PaneRuntimeStatus {
            switch status {
            case "starting", "running":
                .attached
            case "closed", "exited":
                .closed
            default:
                .orphaned
            }
        }

        private func afterSeq(_ backfill: BackfillMode) -> Int? {
            if case .fromSeq(let sequence) = backfill {
                return Int(sequence)
            }
            return nil
        }

        private func serverBackfill(_ backfill: BackfillMode) -> String {
            switch backfill {
            case .latest:
                "latest"
            case .fromSeq:
                "from-seq"
            }
        }

        private func grantedAt() -> String {
            ISO8601DateFormatter().string(from: Date())
        }

        private func isTrimmedNonEmpty(_ value: String) -> Bool {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return !trimmed.isEmpty && trimmed == value
        }

        private func rejectionCode(_ code: String?) -> WriteRejectionCode {
            switch code {
            case "permission-denied":
                .permissionDenied
            case "backpressure":
                .backpressure
            default:
                .invalidState
            }
        }
    }
}

private struct ServerActor: Codable, Equatable, Sendable {
    let sessionId: String
    let subject: String
}

private struct SnapshotInput: Codable, Equatable, Sendable {
    let actor: ServerActor
    let workspaceId: String
}

private struct EnsureWorkspaceInput: Codable, Equatable, Sendable {
    let actor: ServerActor
    let workspaceId: String
    let projectId: String
    let cwd: String
    let initialGrants: [PermissionGrant]
}

private struct PermissionGrant: Codable, Equatable, Sendable {
    let actor: ServerActor
    let permissions: [String]
    let grantedAt: String
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case actor
        case permissions
        case grantedAt
        case expiresAt
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(actor, forKey: .actor)
        try container.encode(permissions, forKey: .permissions)
        try container.encode(grantedAt, forKey: .grantedAt)
        if let expiresAt {
            try container.encode(expiresAt, forKey: .expiresAt)
        } else {
            try container.encodeNil(forKey: .expiresAt)
        }
    }
}

private struct WindowCloseInput: Codable, Equatable, Sendable {
    let actor: ServerActor
    let workspaceId: String
    let windowId: String
    let mode: String
}

private struct PaneFocusInput: Codable, Equatable, Sendable {
    let actor: ServerActor
    let workspaceId: String
    let paneId: String
}

/// Wire shape of the server's `TmuxPaneCreateInput` union members
/// (packages/contracts/src/terminalKernel.ts) — managed-process and agent
/// panes share the base fields and differ only in `kind` + `metadata`.
/// Optional keys (`cwd`) are omitted when nil to satisfy `Schema.optional`;
/// the metadata payloads encode explicit nulls because the server schema
/// requires every metadata key.
private struct PaneCreateInput<Metadata: Encodable & Equatable & Sendable>: Encodable, Equatable, Sendable {
    let actor: ServerActor
    let workspaceId: String
    let windowId: String
    let cwd: String?
    let command: String
    let split: String
    let kind: String
    let metadata: Metadata
}

/// Wire shape of the server's `TmuxPaneAttachMetadataInput` (D-044): attaches
/// a full operational metadata record to an existing pane.
private struct PaneAttachMetadataInput: Encodable, Equatable, Sendable {
    let actor: ServerActor
    let workspaceId: String
    let paneId: String
    let metadata: AgentPaneMetadataInput
}

/// Wire shape of the server's `TmuxAgentOperationalPaneMetadata`: kind
/// "agent" with `agent.providerId` / `agent.providerInstanceId` carrying the
/// D-044 agent identity + agent-native session (or unique launch) id. Every
/// unused metadata slot encodes an explicit null per the server schema.
private struct AgentPaneMetadataInput: Encodable, Equatable, Sendable {
    let title: String
    let command: String?
    let providerId: String
    let providerInstanceId: String
    let labels: [String: String]

    enum CodingKeys: String, CodingKey {
        case kind
        case title
        case process
        case labels
        case neovim
        case agent
        case workflow
        case managedProcess
        case remoteProcess
        case browserLab
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode("agent", forKey: .kind)
        try container.encode(title, forKey: .title)
        if let command {
            try container.encode(PaneProcessMetadataInput(command: command), forKey: .process)
        } else {
            try container.encodeNil(forKey: .process)
        }
        try container.encode(labels, forKey: .labels)
        try container.encodeNil(forKey: .neovim)
        try container.encode(
            AgentPaneMetadataRefInput(providerId: providerId, providerInstanceId: providerInstanceId),
            forKey: .agent
        )
        try container.encodeNil(forKey: .workflow)
        try container.encodeNil(forKey: .managedProcess)
        try container.encodeNil(forKey: .remoteProcess)
        try container.encodeNil(forKey: .browserLab)
    }
}

/// Wire shape of the server's `TmuxAgentPaneMetadata`: `providerInstanceId`
/// and `threadId` are required nullable keys, so nil encodes explicit null.
private struct AgentPaneMetadataRefInput: Codable, Equatable, Sendable {
    let providerId: String
    let providerInstanceId: String?
    let threadId: String?

    init(providerId: String, providerInstanceId: String? = nil, threadId: String? = nil) {
        self.providerId = providerId
        self.providerInstanceId = providerInstanceId
        self.threadId = threadId
    }

    enum CodingKeys: String, CodingKey {
        case providerId
        case providerInstanceId
        case threadId
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(providerId, forKey: .providerId)
        if let providerInstanceId {
            try container.encode(providerInstanceId, forKey: .providerInstanceId)
        } else {
            try container.encodeNil(forKey: .providerInstanceId)
        }
        if let threadId {
            try container.encode(threadId, forKey: .threadId)
        } else {
            try container.encodeNil(forKey: .threadId)
        }
    }
}

private struct ManagedProcessPaneMetadataInput: Encodable, Equatable, Sendable {
    let title: String
    let command: String
    let instanceId: String
    let processDefId: String
    let labels: [String: String]

    enum CodingKeys: String, CodingKey {
        case kind
        case title
        case process
        case labels
        case neovim
        case agent
        case workflow
        case managedProcess
        case remoteProcess
        case browserLab
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode("managed-process", forKey: .kind)
        try container.encode(title, forKey: .title)
        try container.encode(PaneProcessMetadataInput(command: command), forKey: .process)
        try container.encode(labels, forKey: .labels)
        try container.encodeNil(forKey: .neovim)
        try container.encodeNil(forKey: .agent)
        try container.encodeNil(forKey: .workflow)
        try container.encode(
            ManagedProcessRefInput(instanceId: instanceId, processDefId: processDefId),
            forKey: .managedProcess
        )
        try container.encodeNil(forKey: .remoteProcess)
        try container.encodeNil(forKey: .browserLab)
    }
}

private struct ManagedProcessRefInput: Codable, Equatable, Sendable {
    let instanceId: String
    let processDefId: String
}

/// Wire shape of the server's `TmuxPaneProcessMetadata`: every field is a
/// required key, so nullable ones encode explicit nulls.
private struct PaneProcessMetadataInput: Encodable, Equatable, Sendable {
    let command: String

    enum CodingKeys: String, CodingKey {
        case command
        case argv
        case envKeys
        case pid
        case startedAt
        case exitedAt
        case exitCode
        case exitSignal
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(command, forKey: .command)
        try container.encode([String](), forKey: .argv)
        try container.encode([String](), forKey: .envKeys)
        try container.encodeNil(forKey: .pid)
        try container.encodeNil(forKey: .startedAt)
        try container.encodeNil(forKey: .exitedAt)
        try container.encodeNil(forKey: .exitCode)
        try container.encodeNil(forKey: .exitSignal)
    }
}

private struct PaneCloseInput: Codable, Equatable, Sendable {
    let actor: ServerActor
    let workspaceId: String
    let paneId: String
    let mode: String
}

private struct PaneResizeInput: Codable, Equatable, Sendable {
    let actor: ServerActor
    let workspaceId: String
    let paneId: String
    let cols: Int
    let rows: Int
}

private struct PaneWriteInput: Codable, Equatable, Sendable {
    let workspaceId: String
    let paneId: String
    let actor: ServerActor
    let requestId: String
    let data: String
}

private struct PaneStreamSubscribeInput: Codable, Equatable, Sendable {
    let workspaceId: String
    let paneId: String
    let actor: ServerActor
    let afterSeq: Int?
    let backfill: String
    let slowClientPolicy: String
    let maxBufferedChunks: Int
}

private struct ServerSnapshot: Codable, Equatable, Sendable {
    let workspace: ServerWorkspace
    let windows: [ServerWindow]
    let panes: [ServerPane]
    let revision: Int
}

private struct ServerWorkspace: Codable, Equatable, Sendable {
    let workspaceId: String
    let tmuxSessionName: String
    let status: String
    let activeWindowId: String?
}

private struct ServerWindow: Codable, Equatable, Sendable {
    let windowId: String
    let workspaceId: String
    let tmuxWindowId: String
    let tmuxWindowIndex: Int
    let name: String
    let status: String
    let activePaneId: String?
}

private struct ServerPane: Codable, Equatable, Sendable {
    let paneId: String
    let workspaceId: String
    let windowId: String
    let tmuxPaneId: String
    let cols: Int
    let rows: Int
    let x: Int?
    let y: Int?
    let status: String
    let metadata: ServerPaneMetadata
    let stream: ServerPaneStreamDescriptor
}

private struct ServerPaneMetadata: Codable, Equatable, Sendable {
    let kind: String
    let title: String?
    let neovim: ServerNeovimBootstrapMetadata?
    let managedProcess: ManagedProcessRefInput?
    let agent: AgentPaneMetadataRefInput?

    func runtimeMetadata() -> NativeRuntime.PaneRuntimeMetadata {
        NativeRuntime.PaneRuntimeMetadata(
            kind: kind,
            title: title,
            neovim: neovim.map {
                NativeRuntime.NeovimPaneRuntimeMetadata(
                    bootstrapID: $0.bootstrapId,
                    bridgeSocketPath: $0.bridgeSocketPath,
                    profileID: $0.profileId,
                    themeID: $0.themeId,
                    keybindingProfileID: $0.keybindingProfileId,
                    files: $0.files
                )
            },
            managedProcess: managedProcess.map {
                NativeRuntime.ManagedProcessPaneRuntimeMetadata(
                    instanceID: $0.instanceId,
                    processDefID: $0.processDefId
                )
            },
            agent: agent.map {
                NativeRuntime.AgentPaneRuntimeMetadata(
                    providerID: $0.providerId,
                    providerInstanceID: $0.providerInstanceId,
                    threadID: $0.threadId
                )
            }
        )
    }
}

private struct ServerNeovimBootstrapMetadata: Codable, Equatable, Sendable {
    let bootstrapId: String
    let profileId: String
    let themeId: String
    let keybindingProfileId: String
    let bridgeSocketPath: String
    let files: [String]
}

private struct ServerPaneStreamDescriptor: Codable, Equatable, Sendable {
    let streamId: String
    let paneId: String
    let lowSeq: Int
    let highSeq: Int
    let droppedCount: Int
}

private struct PaneWriteResult: Codable, Equatable, Sendable {
    let type: String
    let workspaceId: String
    let paneId: String
    let requestId: String
    let inputSeq: Int?
    let code: String?
}

private struct PaneStreamEvent: Codable, Equatable, Sendable {
    let type: String
    let descriptor: ServerPaneStreamDescriptor
    let seq: Int?
    let data: String?
    let fromSeq: Int?
    let toSeq: Int?
    let requestedAfterSeq: Int?
    let resumedAtSeq: Int?

    func envelope() throws -> NativeRuntime.PaneStreamEnvelope {
        let paneID = PaneID(rawValue: descriptor.paneId)
        let streamID = StreamID(rawValue: descriptor.streamId)
        switch type {
        case "backfill-started":
            return NativeRuntime.PaneStreamEnvelope(paneID: paneID, streamID: streamID, kind: .backfillStarted, lowReplaySeq: UInt64(fromSeq ?? descriptor.lowSeq), highReplaySeq: UInt64(toSeq ?? descriptor.highSeq))
        case "chunk":
            guard let seq, let data else {
                throw NativeRuntime.NativeRuntimeError.malformedStreamEnvelope
            }
            return NativeRuntime.PaneStreamEnvelope(paneID: paneID, streamID: streamID, kind: .output, sequence: UInt64(seq), bytes: Data(data.utf8))
        case "gap":
            return NativeRuntime.PaneStreamEnvelope(paneID: paneID, streamID: streamID, kind: .gap, lowReplaySeq: UInt64(requestedAfterSeq ?? descriptor.lowSeq), highReplaySeq: UInt64(resumedAtSeq ?? descriptor.highSeq))
        case "overflow":
            return NativeRuntime.PaneStreamEnvelope(paneID: paneID, streamID: streamID, kind: .overflow)
        case "closed":
            return NativeRuntime.PaneStreamEnvelope(paneID: paneID, streamID: streamID, kind: .closed)
        default:
            throw NativeRuntime.NativeRuntimeError.malformedStreamEnvelope
        }
    }
}
