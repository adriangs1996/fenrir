import Foundation
import FenrirNativeShared

public extension NativeRuntime {
    struct TmuxSessionID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }
    }

    struct TmuxWindowID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }
    }

    struct TmuxPaneID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }
    }

    struct RuntimeActorIdentity: Codable, Equatable, Sendable {
        public let profileID: ProfileID
        public let authSessionID: String
        public let subject: String

        public init(profileID: ProfileID, authSessionID: String, subject: String) {
            self.profileID = profileID
            self.authSessionID = authSessionID
            self.subject = subject
        }
    }

    enum BackfillMode: Codable, Equatable, Sendable {
        case latest
        case fromSeq(UInt64)
    }

    enum PaneStreamStatus: String, Codable, Equatable, Sendable {
        case idle
        case subscribing
        case live
        case gap
        case overflow
        case closed
    }

    enum PaneRuntimeStatus: String, Codable, Equatable, Sendable {
        case attached
        case orphaned
        case closed
    }

    enum WorkspaceRuntimeStatus: String, Codable, Equatable, Sendable {
        case attached
        case detached
        case reconnecting
        case closed
        case orphaned
    }

    enum WriteAckStatus: String, Codable, Equatable, Sendable {
        case accepted
        case rejected
    }

    enum WriteRejectionCode: String, Codable, Equatable, Sendable {
        case permissionDenied = "permission-denied"
        case backpressure
        case invalidState = "invalid-state"
    }

    enum ResizeAckStatus: String, Codable, Equatable, Sendable {
        case accepted
        case rejected
    }

    enum StreamEnvelopeKind: String, Codable, Equatable, Sendable {
        case backfillStarted = "backfill-started"
        case output
        case gap
        case overflow
        case closed
    }

    struct PaneStreamState: Codable, Equatable, Sendable {
        public let paneID: PaneID
        public let streamID: StreamID?
        public let lastObservedSeq: UInt64?
        public let lowReplaySeq: UInt64?
        public let highReplaySeq: UInt64?
        public let overflowCount: UInt64
        public let status: PaneStreamStatus

        public init(
            paneID: PaneID,
            streamID: StreamID? = nil,
            lastObservedSeq: UInt64? = nil,
            lowReplaySeq: UInt64? = nil,
            highReplaySeq: UInt64? = nil,
            overflowCount: UInt64 = 0,
            status: PaneStreamStatus
        ) {
            self.paneID = paneID
            self.streamID = streamID
            self.lastObservedSeq = lastObservedSeq
            self.lowReplaySeq = lowReplaySeq
            self.highReplaySeq = highReplaySeq
            self.overflowCount = overflowCount
            self.status = status
        }
    }

    struct WorkspaceRuntimeState: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let actor: RuntimeActorIdentity?
        public let tmuxSessionID: TmuxSessionID?
        public let status: WorkspaceRuntimeStatus
        public let windows: [WindowRuntimeState]
        public let activeWindowID: FenrirWindowID?
        public let attachedPaneIDs: [PaneID]
        public let generation: UInt64

        public init(
            workspaceID: WorkspaceID,
            status: WorkspaceRuntimeStatus,
            actor: RuntimeActorIdentity? = nil,
            tmuxSessionID: TmuxSessionID? = nil,
            windows: [WindowRuntimeState] = [],
            activeWindowID: FenrirWindowID? = nil,
            attachedPaneIDs: [PaneID] = [],
            generation: UInt64 = 0
        ) {
            self.workspaceID = workspaceID
            self.actor = actor
            self.tmuxSessionID = tmuxSessionID
            self.status = status
            self.windows = windows
            self.activeWindowID = activeWindowID
            self.attachedPaneIDs = attachedPaneIDs
            self.generation = generation
        }
    }

    struct WindowRuntimeState: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID
        public let tmuxWindowID: TmuxWindowID
        public let index: Int
        public let title: String
        public let activePaneID: PaneID?
        public let paneIDs: [PaneID]

        public init(
            workspaceID: WorkspaceID,
            windowID: FenrirWindowID,
            tmuxWindowID: TmuxWindowID,
            index: Int,
            title: String,
            activePaneID: PaneID? = nil,
            paneIDs: [PaneID] = []
        ) {
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.tmuxWindowID = tmuxWindowID
            self.index = index
            self.title = title
            self.activePaneID = activePaneID
            self.paneIDs = paneIDs
        }
    }

    struct PaneRuntimeState: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID?
        public let paneID: PaneID
        public let tmuxPaneID: TmuxPaneID?
        public let status: PaneRuntimeStatus
        public let x: Int?
        public let y: Int?
        public let size: PaneSize?
        public let stream: PaneStreamState
        public let metadata: PaneRuntimeMetadata?

        public init(
            workspaceID: WorkspaceID,
            paneID: PaneID,
            status: PaneRuntimeStatus,
            windowID: FenrirWindowID? = nil,
            tmuxPaneID: TmuxPaneID? = nil,
            x: Int? = nil,
            y: Int? = nil,
            size: PaneSize? = nil,
            stream: PaneStreamState,
            metadata: PaneRuntimeMetadata? = nil
        ) {
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.paneID = paneID
            self.tmuxPaneID = tmuxPaneID
            self.status = status
            self.x = x
            self.y = y
            self.size = size
            self.stream = stream
            self.metadata = metadata
        }
    }

    struct PaneRuntimeMetadata: Codable, Equatable, Sendable {
        public let kind: String
        public let title: String?
        public let neovim: NeovimPaneRuntimeMetadata?
        public let managedProcess: ManagedProcessPaneRuntimeMetadata?
        public let agent: AgentPaneRuntimeMetadata?

        public init(
            kind: String,
            title: String? = nil,
            neovim: NeovimPaneRuntimeMetadata? = nil,
            managedProcess: ManagedProcessPaneRuntimeMetadata? = nil,
            agent: AgentPaneRuntimeMetadata? = nil
        ) {
            self.kind = kind
            self.title = title
            self.neovim = neovim
            self.managedProcess = managedProcess
            self.agent = agent
        }
    }

    /// Mirror of the server's `TmuxAgentPaneMetadata` (D-044): the agent id
    /// (`providerID`) and its agent-native session id (`providerInstanceID`)
    /// recorded on the pane so resumability survives client restarts
    /// server-side.
    struct AgentPaneRuntimeMetadata: Codable, Equatable, Sendable {
        public let providerID: String
        public let providerInstanceID: String?
        public let threadID: String?

        public init(providerID: String, providerInstanceID: String? = nil, threadID: String? = nil) {
            self.providerID = providerID
            self.providerInstanceID = providerInstanceID
            self.threadID = threadID
        }
    }

    struct ManagedProcessPaneRuntimeMetadata: Codable, Equatable, Sendable {
        public let instanceID: String
        public let processDefID: String

        public init(instanceID: String, processDefID: String) {
            self.instanceID = instanceID
            self.processDefID = processDefID
        }
    }

    struct NeovimPaneRuntimeMetadata: Codable, Equatable, Sendable {
        public let bootstrapID: String
        public let bridgeSocketPath: String
        public let profileID: String
        public let themeID: String
        public let keybindingProfileID: String
        public let files: [String]

        public init(
            bootstrapID: String,
            bridgeSocketPath: String,
            profileID: String,
            themeID: String,
            keybindingProfileID: String,
            files: [String] = []
        ) {
            self.bootstrapID = bootstrapID
            self.bridgeSocketPath = bridgeSocketPath
            self.profileID = profileID
            self.themeID = themeID
            self.keybindingProfileID = keybindingProfileID
            self.files = files
        }
    }

    struct RuntimeState: Codable, Equatable, Sendable {
        public let workspaces: [WorkspaceRuntimeState]
        public let panes: [PaneRuntimeState]

        public init(workspaces: [WorkspaceRuntimeState] = [], panes: [PaneRuntimeState] = []) {
            self.workspaces = workspaces
            self.panes = panes
        }
    }

    struct PaneWriteAck: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let paneID: PaneID
        public let status: WriteAckStatus
        public let inputSeq: UInt64?
        public let rejectionCode: WriteRejectionCode?

        public init(
            requestID: RequestID,
            paneID: PaneID,
            status: WriteAckStatus,
            inputSeq: UInt64? = nil,
            rejectionCode: WriteRejectionCode? = nil
        ) {
            self.requestID = requestID
            self.paneID = paneID
            self.status = status
            self.inputSeq = inputSeq
            self.rejectionCode = rejectionCode
        }
    }

    struct PaneSize: Codable, Equatable, Sendable {
        public let columns: Int
        public let rows: Int

        public init(columns: Int, rows: Int) {
            self.columns = columns
            self.rows = rows
        }
    }

    struct PaneResizeAck: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let paneID: PaneID
        public let status: ResizeAckStatus
        public let size: PaneSize?

        public init(requestID: RequestID, paneID: PaneID, status: ResizeAckStatus, size: PaneSize? = nil) {
            self.requestID = requestID
            self.paneID = paneID
            self.status = status
            self.size = size
        }
    }

    struct PaneStreamEnvelope: Codable, Equatable, Sendable {
        public let paneID: PaneID
        public let streamID: StreamID
        public let kind: StreamEnvelopeKind
        public let sequence: UInt64?
        public let bytes: Data?
        public let lowReplaySeq: UInt64?
        public let highReplaySeq: UInt64?

        public init(
            paneID: PaneID,
            streamID: StreamID,
            kind: StreamEnvelopeKind,
            sequence: UInt64? = nil,
            bytes: Data? = nil,
            lowReplaySeq: UInt64? = nil,
            highReplaySeq: UInt64? = nil
        ) {
            self.paneID = paneID
            self.streamID = streamID
            self.kind = kind
            self.sequence = sequence
            self.bytes = bytes
            self.lowReplaySeq = lowReplaySeq
            self.highReplaySeq = highReplaySeq
        }
    }

    struct RuntimeCapabilities: Codable, Equatable, Sendable {
        public let tmuxKernel: Bool
        public let paneStreams: Bool
        public let writeAcknowledgements: Bool
        public let paneResize: Bool
        public let paneClose: Bool

        public init(
            tmuxKernel: Bool,
            paneStreams: Bool,
            writeAcknowledgements: Bool,
            paneResize: Bool = true,
            paneClose: Bool = true
        ) {
            self.tmuxKernel = tmuxKernel
            self.paneStreams = paneStreams
            self.writeAcknowledgements = writeAcknowledgements
            self.paneResize = paneResize
            self.paneClose = paneClose
        }
    }

    enum NativeRuntimeError: String, Error, Codable, Equatable, Sendable {
        case capabilitiesUnavailable = "NativeRuntimeCapabilitiesUnavailable"
        case actorScopeMismatch = "NativeRuntimeActorScopeMismatch"
        case orphanedTmuxResource = "NativeRuntimeOrphanedTmuxResource"
        case workspaceAttachFailed = "NativeRuntimeWorkspaceAttachFailed"
        case workspaceOpenFailed = "NativeRuntimeWorkspaceOpenFailed"
        case workspaceCloseFailed = "NativeRuntimeWorkspaceCloseFailed"
        case workspaceSwitchFailed = "NativeRuntimeWorkspaceSwitchFailed"
        case workspaceDetachFailed = "NativeRuntimeWorkspaceDetachFailed"
        case workspaceReconnectFailed = "NativeRuntimeWorkspaceReconnectFailed"
        case runtimeEnumerationFailed = "NativeRuntimeEnumerationFailed"
        case paneAttachFailed = "NativeRuntimePaneAttachFailed"
        case paneFocusFailed = "NativeRuntimePaneFocusFailed"
        case paneStreamFailed = "NativeRuntimePaneStreamFailed"
        case malformedStreamEnvelope = "NativeRuntimeMalformedStreamEnvelope"
        case paneStreamGap = "NativeRuntimePaneStreamGap"
        case paneStreamOverflow = "NativeRuntimePaneStreamOverflow"
        case paneWriteRejected = "NativeRuntimePaneWriteRejected"
        case malformedWriteAcknowledgement = "NativeRuntimeMalformedWriteAcknowledgement"
        case paneResizeRejected = "NativeRuntimePaneResizeRejected"
        case malformedResizeAcknowledgement = "NativeRuntimeMalformedResizeAcknowledgement"
        case paneClosed = "NativeRuntimePaneClosed"
        case paneCreateFailed = "NativeRuntimePaneCreateFailed"
        case paneMetadataAttachFailed = "NativeRuntimePaneMetadataAttachFailed"
        case serverUnavailable = "NativeRuntimeServerUnavailable"
        case permissionDenied = "NativeRuntimePermissionDenied"
    }

    struct DiscoverRuntimeCapabilitiesInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource

        public init(requestID: RequestID, source: ActionSource) {
            self.requestID = requestID
            self.source = source
        }
    }

    struct DiscoverRuntimeCapabilitiesResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let capabilities: RuntimeCapabilities
        public let timestamp: FenrirTimestamp
    }

    struct AttachWorkspaceRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let actor: RuntimeActorIdentity
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, actor: RuntimeActorIdentity, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.actor = actor
            self.source = source
        }
    }

    struct AttachWorkspaceRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspace: WorkspaceRuntimeState
        public let timestamp: FenrirTimestamp
    }

    struct OpenWorkspaceRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let projectID: String?
        public let workingDirectory: String?
        public let actor: RuntimeActorIdentity
        public let source: ActionSource

        public init(
            requestID: RequestID,
            workspaceID: WorkspaceID,
            projectID: String? = nil,
            workingDirectory: String? = nil,
            actor: RuntimeActorIdentity,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.projectID = projectID
            self.workingDirectory = workingDirectory
            self.actor = actor
            self.source = source
        }
    }

    struct OpenWorkspaceRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspace: WorkspaceRuntimeState
        public let timestamp: FenrirTimestamp
    }

    struct CloseWorkspaceRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let actor: RuntimeActorIdentity
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, actor: RuntimeActorIdentity, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.actor = actor
            self.source = source
        }
    }

    struct CloseWorkspaceRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let timestamp: FenrirTimestamp
    }

    struct SwitchWorkspaceRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let actor: RuntimeActorIdentity
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, actor: RuntimeActorIdentity, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.actor = actor
            self.source = source
        }
    }

    struct SwitchWorkspaceRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspace: WorkspaceRuntimeState
        public let timestamp: FenrirTimestamp
    }

    struct DetachWorkspaceRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let actor: RuntimeActorIdentity
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, actor: RuntimeActorIdentity, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.actor = actor
            self.source = source
        }
    }

    struct DetachWorkspaceRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let timestamp: FenrirTimestamp
    }

    struct ReconnectWorkspaceRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let actor: RuntimeActorIdentity
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, actor: RuntimeActorIdentity, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.actor = actor
            self.source = source
        }
    }

    struct ReconnectWorkspaceRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspace: WorkspaceRuntimeState
        public let timestamp: FenrirTimestamp
    }

    struct EnumerateWorkspaceRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let actor: RuntimeActorIdentity
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, actor: RuntimeActorIdentity, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.actor = actor
            self.source = source
        }
    }

    struct EnumerateWorkspaceRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspace: WorkspaceRuntimeState
        public let windows: [WindowRuntimeState]
        public let panes: [PaneRuntimeState]
        public let timestamp: FenrirTimestamp
    }

    struct AttachPaneRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID?
        public let paneID: PaneID
        public let streamID: StreamID
        public let actor: RuntimeActorIdentity
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, windowID: FenrirWindowID? = nil, paneID: PaneID, streamID: StreamID, actor: RuntimeActorIdentity, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.paneID = paneID
            self.streamID = streamID
            self.actor = actor
            self.source = source
        }
    }

    struct AttachPaneRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let pane: PaneRuntimeState
        public let backfill: BackfillMode
        public let timestamp: FenrirTimestamp
    }

    struct FocusPaneRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID
        public let paneID: PaneID
        public let actor: RuntimeActorIdentity
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, windowID: FenrirWindowID, paneID: PaneID, actor: RuntimeActorIdentity, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.paneID = paneID
            self.actor = actor
            self.source = source
        }
    }

    struct FocusPaneRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspace: WorkspaceRuntimeState
        public let timestamp: FenrirTimestamp
    }

    struct ReconnectPaneStreamInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let paneID: PaneID
        public let actor: RuntimeActorIdentity
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, paneID: PaneID, actor: RuntimeActorIdentity, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.actor = actor
            self.source = source
        }
    }

    struct ReconnectPaneStreamResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let stream: PaneStreamState
        public let envelopes: [PaneStreamEnvelope]
        public let backfill: BackfillMode
        public let timestamp: FenrirTimestamp
    }

    struct SendPaneInputInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let paneID: PaneID
        public let actor: RuntimeActorIdentity
        public let inputBytes: Data
        public let source: ActionSource

        public init(
            requestID: RequestID,
            workspaceID: WorkspaceID,
            paneID: PaneID,
            actor: RuntimeActorIdentity,
            inputBytes: Data,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.actor = actor
            self.inputBytes = inputBytes
            self.source = source
        }
    }

    struct SendPaneInputResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let acknowledgement: PaneWriteAck
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, acknowledgement: PaneWriteAck, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.acknowledgement = acknowledgement
            self.timestamp = timestamp
        }
    }

    struct ResizePaneRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let paneID: PaneID
        public let actor: RuntimeActorIdentity
        public let size: PaneSize
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, paneID: PaneID, actor: RuntimeActorIdentity, size: PaneSize, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.actor = actor
            self.size = size
            self.source = source
        }
    }

    struct ResizePaneRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let acknowledgement: PaneResizeAck
        public let timestamp: FenrirTimestamp
    }

    /// Mirrors the server's `TmuxPaneCreateInput.split` literals
    /// ("same-window" | "horizontal" | "vertical").
    enum PaneSplitDirection: String, Codable, Equatable, Sendable {
        case sameWindow = "same-window"
        case horizontal
        case vertical
    }

    /// Managed-process pane request (D-019/D-034/D-045): scripts run as real
    /// tmux panes carrying `managed-process` metadata so they land in the pane
    /// grid and populate the sidebar dev-servers/apps groups. `instanceID`
    /// must be unique per launch; the adapter uses it to identify the pane the
    /// server created inside the returned workspace snapshot.
    struct ManagedProcessPaneSpec: Codable, Equatable, Sendable {
        public let title: String
        public let command: String
        public let instanceID: String
        public let processDefID: String
        public let labels: [String: String]

        public init(
            title: String,
            command: String,
            instanceID: String,
            processDefID: String,
            labels: [String: String] = [:]
        ) {
            self.title = title
            self.command = command
            self.instanceID = instanceID
            self.processDefID = processDefID
            self.labels = labels
        }
    }

    struct CreatePaneRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID
        public let actor: RuntimeActorIdentity
        public let split: PaneSplitDirection
        public let workingDirectory: String?
        public let managedProcess: ManagedProcessPaneSpec
        public let source: ActionSource

        public init(
            requestID: RequestID,
            workspaceID: WorkspaceID,
            windowID: FenrirWindowID,
            actor: RuntimeActorIdentity,
            managedProcess: ManagedProcessPaneSpec,
            split: PaneSplitDirection = .sameWindow,
            workingDirectory: String? = nil,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.actor = actor
            self.split = split
            self.workingDirectory = workingDirectory
            self.managedProcess = managedProcess
            self.source = source
        }
    }

    struct CreatePaneRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let pane: PaneRuntimeState
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, pane: PaneRuntimeState, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.pane = pane
            self.timestamp = timestamp
        }
    }

    /// Agent pane request (D-044 resume): a resumed agent is a NEW tmux pane
    /// with fresh pane identity running the validated resume command, carrying
    /// `agent` pane metadata (kind "agent") instead of `managed-process`.
    /// `instanceID` must be unique per launch; the adapter resolves the
    /// created pane by its `agent.providerInstanceId` marker in the returned
    /// snapshot, mirroring the managed-process identity discipline.
    struct AgentPaneSpec: Codable, Equatable, Sendable {
        public let title: String
        public let command: String
        /// Agent adapter identity recorded as `agent.providerId`.
        public let providerID: String
        /// Unique launch marker recorded as `agent.providerInstanceId`.
        public let instanceID: String
        public let labels: [String: String]

        public init(
            title: String,
            command: String,
            providerID: String,
            instanceID: String,
            labels: [String: String] = [:]
        ) {
            self.title = title
            self.command = command
            self.providerID = providerID
            self.instanceID = instanceID
            self.labels = labels
        }
    }

    struct CreateAgentPaneRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let windowID: FenrirWindowID
        public let actor: RuntimeActorIdentity
        public let split: PaneSplitDirection
        public let workingDirectory: String?
        public let agent: AgentPaneSpec
        public let source: ActionSource

        public init(
            requestID: RequestID,
            workspaceID: WorkspaceID,
            windowID: FenrirWindowID,
            actor: RuntimeActorIdentity,
            agent: AgentPaneSpec,
            split: PaneSplitDirection = .sameWindow,
            workingDirectory: String? = nil,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.windowID = windowID
            self.actor = actor
            self.split = split
            self.workingDirectory = workingDirectory
            self.agent = agent
            self.source = source
        }
    }

    /// Attaches D-044 resumability metadata ({agentID, sessionID}) to an
    /// existing pane through the server's `tmux.pane.attachMetadata`
    /// contract. Metadata only — the session id is never a command string.
    struct AttachAgentPaneMetadataInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let paneID: PaneID
        public let actor: RuntimeActorIdentity
        /// Recorded as `agent.providerId`.
        public let agentID: String
        /// Agent-native session id recorded as `agent.providerInstanceId`.
        /// Callers must validate it against the AgentIntegration session-id
        /// allowlist before it reaches this input.
        public let sessionID: String
        public let title: String?
        public let labels: [String: String]
        public let source: ActionSource

        public init(
            requestID: RequestID,
            workspaceID: WorkspaceID,
            paneID: PaneID,
            actor: RuntimeActorIdentity,
            agentID: String,
            sessionID: String,
            title: String? = nil,
            labels: [String: String] = [:],
            source: ActionSource
        ) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.actor = actor
            self.agentID = agentID
            self.sessionID = sessionID
            self.title = title
            self.labels = labels
            self.source = source
        }
    }

    struct ClosePaneRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let paneID: PaneID
        public let actor: RuntimeActorIdentity
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, paneID: PaneID, actor: RuntimeActorIdentity, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.actor = actor
            self.source = source
        }
    }

    struct ClosePaneRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let paneID: PaneID
        public let timestamp: FenrirTimestamp
    }

    enum Event: Codable, Equatable, Sendable {
        case runtimeCapabilitiesDiscovered
        case workspaceRuntimeAttached(WorkspaceID)
        case workspaceRuntimeOpened(WorkspaceID)
        case workspaceRuntimeClosed(WorkspaceID)
        case workspaceRuntimeSwitched(WorkspaceID)
        case workspaceRuntimeDetached(WorkspaceID)
        case workspaceRuntimeReconnected(WorkspaceID)
        case workspaceRuntimeEnumerated(WorkspaceID)
        case paneRuntimeAttached(PaneID)
        case paneRuntimeCreated(PaneID)
        case paneRuntimeFocused(PaneID)
        case paneOutputReceived(PaneID, UInt64)
        case paneInputAccepted(PaneID, UInt64)
        case paneInputRejected(PaneID, WriteRejectionCode)
        case paneResizeRequested(PaneID, PaneSize)
        case paneStreamGapDetected(PaneID)
        case paneStreamOverflowDetected(PaneID)
        case paneStreamClosed(PaneID)
    }
}
