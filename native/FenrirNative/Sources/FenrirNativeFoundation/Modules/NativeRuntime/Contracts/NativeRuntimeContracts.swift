import Foundation
import FenrirNativeShared

public extension NativeRuntime {
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
        case closed
    }

    enum WorkspaceRuntimeStatus: String, Codable, Equatable, Sendable {
        case attached
        case detached
        case reconnecting
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
        public let status: WorkspaceRuntimeStatus
        public let attachedPaneIDs: [PaneID]
        public let generation: UInt64

        public init(
            workspaceID: WorkspaceID,
            status: WorkspaceRuntimeStatus,
            attachedPaneIDs: [PaneID] = [],
            generation: UInt64 = 0
        ) {
            self.workspaceID = workspaceID
            self.status = status
            self.attachedPaneIDs = attachedPaneIDs
            self.generation = generation
        }
    }

    struct PaneRuntimeState: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let paneID: PaneID
        public let status: PaneRuntimeStatus
        public let size: PaneSize?
        public let stream: PaneStreamState

        public init(
            workspaceID: WorkspaceID,
            paneID: PaneID,
            status: PaneRuntimeStatus,
            size: PaneSize? = nil,
            stream: PaneStreamState
        ) {
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.status = status
            self.size = size
            self.stream = stream
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
        case workspaceAttachFailed = "NativeRuntimeWorkspaceAttachFailed"
        case workspaceDetachFailed = "NativeRuntimeWorkspaceDetachFailed"
        case workspaceReconnectFailed = "NativeRuntimeWorkspaceReconnectFailed"
        case paneAttachFailed = "NativeRuntimePaneAttachFailed"
        case paneStreamFailed = "NativeRuntimePaneStreamFailed"
        case malformedStreamEnvelope = "NativeRuntimeMalformedStreamEnvelope"
        case paneStreamGap = "NativeRuntimePaneStreamGap"
        case paneStreamOverflow = "NativeRuntimePaneStreamOverflow"
        case paneWriteRejected = "NativeRuntimePaneWriteRejected"
        case malformedWriteAcknowledgement = "NativeRuntimeMalformedWriteAcknowledgement"
        case paneResizeRejected = "NativeRuntimePaneResizeRejected"
        case malformedResizeAcknowledgement = "NativeRuntimeMalformedResizeAcknowledgement"
        case paneClosed = "NativeRuntimePaneClosed"
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
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.source = source
        }
    }

    struct AttachWorkspaceRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspace: WorkspaceRuntimeState
        public let timestamp: FenrirTimestamp
    }

    struct DetachWorkspaceRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
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
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.source = source
        }
    }

    struct ReconnectWorkspaceRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspace: WorkspaceRuntimeState
        public let timestamp: FenrirTimestamp
    }

    struct AttachPaneRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let paneID: PaneID
        public let streamID: StreamID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, paneID: PaneID, streamID: StreamID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.streamID = streamID
            self.source = source
        }
    }

    struct AttachPaneRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let pane: PaneRuntimeState
        public let backfill: BackfillMode
        public let timestamp: FenrirTimestamp
    }

    struct ReconnectPaneStreamInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let paneID: PaneID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, paneID: PaneID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.paneID = paneID
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
        public let inputBytes: Data
        public let source: ActionSource

        public init(
            requestID: RequestID,
            workspaceID: WorkspaceID,
            paneID: PaneID,
            inputBytes: Data,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.paneID = paneID
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
        public let size: PaneSize
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, paneID: PaneID, size: PaneSize, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.size = size
            self.source = source
        }
    }

    struct ResizePaneRuntimeResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let acknowledgement: PaneResizeAck
        public let timestamp: FenrirTimestamp
    }

    struct ClosePaneRuntimeInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let paneID: PaneID
        public let source: ActionSource

        public init(requestID: RequestID, workspaceID: WorkspaceID, paneID: PaneID, source: ActionSource) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.paneID = paneID
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
        case workspaceRuntimeDetached(WorkspaceID)
        case workspaceRuntimeReconnected(WorkspaceID)
        case paneRuntimeAttached(PaneID)
        case paneOutputReceived(PaneID, UInt64)
        case paneInputAccepted(PaneID, UInt64)
        case paneInputRejected(PaneID, WriteRejectionCode)
        case paneResizeRequested(PaneID, PaneSize)
        case paneStreamGapDetected(PaneID)
        case paneStreamOverflowDetected(PaneID)
        case paneStreamClosed(PaneID)
    }
}
