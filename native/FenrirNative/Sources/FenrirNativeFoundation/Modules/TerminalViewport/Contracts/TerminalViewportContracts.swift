import Foundation
import FenrirNativeShared

public extension TerminalViewport {
    enum RendererStatus: String, Codable, Equatable, Sendable {
        case unavailable
        case degraded
        case ready
        case disposed
    }

    enum InputMode: String, Codable, Equatable, Sendable {
        case normal
        case bracketedPaste
    }

    enum StreamStatus: String, Codable, Equatable, Sendable {
        case detached
        case attached
        case closed
    }

    enum RuntimeAckStatus: String, Codable, Equatable, Sendable {
        case accepted
        case rejected
    }

    enum RuntimeRejectionCode: String, Codable, Equatable, Sendable {
        case permissionDenied = "permission-denied"
        case backpressure
        case invalidState = "invalid-state"
    }

    enum TerminalViewportError: String, Error, Codable, Equatable, Sendable {
        case createFailed = "TerminalViewportCreateFailed"
        case destroyFailed = "TerminalViewportDestroyFailed"
        case notFound = "TerminalViewportNotFound"
        case paneIdentityMismatch = "TerminalViewportPaneIdentityMismatch"
        case rendererUnavailable = "TerminalRendererUnavailable"
        case outputApplyFailed = "TerminalOutputApplyFailed"
        case inputRejected = "TerminalInputRejected"
        case resizeFailed = "TerminalResizeFailed"
        case invalidDimensions = "TerminalViewportInvalidDimensions"
        case streamOrderViolation = "TerminalViewportStreamOrderViolation"
        case outputBackpressure = "TerminalOutputBackpressure"
        case contextCaptureFailed = "TerminalViewportContextCaptureFailed"
        case redactionFailed = "TerminalViewportRedactionFailed"
    }

    enum CaptureKind: String, Codable, Equatable, Sendable {
        case selection
        case viewport
        case lastLines
    }

    enum ScreenBufferKind: String, Codable, Equatable, Sendable {
        case primary
        case alternate
    }

    static let fenrirReservedOSCIdentifier = 8737
    static let maxPendingReservedOSCSequenceBytes = 65_536

    struct Size: Codable, Equatable, Sendable {
        public let columns: Int
        public let rows: Int
        public let pixelWidth: Int
        public let pixelHeight: Int

        public init(columns: Int, rows: Int, pixelWidth: Int, pixelHeight: Int) {
            self.columns = columns
            self.rows = rows
            self.pixelWidth = pixelWidth
            self.pixelHeight = pixelHeight
        }
    }

    struct RendererDescriptor: Codable, Equatable, Sendable {
        public let rendererID: String
        public let status: RendererStatus

        public init(rendererID: String, status: RendererStatus) {
            self.rendererID = rendererID
            self.status = status
        }
    }

    struct State: Codable, Equatable, Sendable {
        public let viewportID: ViewportID
        public let workspaceID: WorkspaceID
        public let tabID: FenrirWindowID?
        public let paneID: PaneID
        public let streamID: StreamID?
        public let lastAppliedSequence: UInt64?
        public let isFocused: Bool
        public let rendererStatus: RendererStatus
        public let streamStatus: StreamStatus
        public let size: Size?
        public let pendingReservedOSCSequence: Data

        public init(
            viewportID: ViewportID,
            workspaceID: WorkspaceID,
            tabID: FenrirWindowID? = nil,
            paneID: PaneID,
            streamID: StreamID? = nil,
            lastAppliedSequence: UInt64? = nil,
            isFocused: Bool = false,
            rendererStatus: RendererStatus,
            streamStatus: StreamStatus = .detached,
            size: Size? = nil,
            pendingReservedOSCSequence: Data = Data()
        ) {
            self.viewportID = viewportID
            self.workspaceID = workspaceID
            self.tabID = tabID
            self.paneID = paneID
            self.streamID = streamID
            self.lastAppliedSequence = lastAppliedSequence
            self.isFocused = isFocused
            self.rendererStatus = rendererStatus
            self.streamStatus = streamStatus
            self.size = size
            self.pendingReservedOSCSequence = pendingReservedOSCSequence
        }
    }

    struct RuntimeWriteAcknowledgement: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let paneID: PaneID
        public let status: RuntimeAckStatus
        public let inputSequence: UInt64?
        public let rejectionCode: RuntimeRejectionCode?

        public init(
            requestID: RequestID,
            paneID: PaneID,
            status: RuntimeAckStatus,
            inputSequence: UInt64? = nil,
            rejectionCode: RuntimeRejectionCode? = nil
        ) {
            self.requestID = requestID
            self.paneID = paneID
            self.status = status
            self.inputSequence = inputSequence
            self.rejectionCode = rejectionCode
        }
    }

    struct RuntimeResizeAcknowledgement: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let paneID: PaneID
        public let status: RuntimeAckStatus
        public let size: Size?

        public init(requestID: RequestID, paneID: PaneID, status: RuntimeAckStatus, size: Size? = nil) {
            self.requestID = requestID
            self.paneID = paneID
            self.status = status
            self.size = size
        }
    }

    struct CreateTerminalViewportInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let viewportID: ViewportID
        public let workspaceID: WorkspaceID
        public let tabID: FenrirWindowID?
        public let paneID: PaneID
        public let size: Size?
        public let source: ActionSource

        public init(requestID: RequestID, viewportID: ViewportID, workspaceID: WorkspaceID, tabID: FenrirWindowID? = nil, paneID: PaneID, size: Size? = nil, source: ActionSource) {
            self.requestID = requestID
            self.viewportID = viewportID
            self.workspaceID = workspaceID
            self.tabID = tabID
            self.paneID = paneID
            self.size = size
            self.source = source
        }
    }

    struct CreateTerminalViewportResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let state: State
        public let renderer: RendererDescriptor
        public let timestamp: FenrirTimestamp
    }

    struct DestroyTerminalViewportInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let viewportID: ViewportID
        public let source: ActionSource

        public init(requestID: RequestID, viewportID: ViewportID, source: ActionSource) {
            self.requestID = requestID
            self.viewportID = viewportID
            self.source = source
        }
    }

    struct DestroyTerminalViewportResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let viewportID: ViewportID
        public let timestamp: FenrirTimestamp
    }

    struct AttachPaneStreamInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let viewportID: ViewportID
        public let workspaceID: WorkspaceID
        public let paneID: PaneID
        public let streamID: StreamID
        public let source: ActionSource

        public init(requestID: RequestID, viewportID: ViewportID, workspaceID: WorkspaceID, paneID: PaneID, streamID: StreamID, source: ActionSource) {
            self.requestID = requestID
            self.viewportID = viewportID
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.streamID = streamID
            self.source = source
        }
    }

    struct AttachPaneStreamResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let state: State
        public let timestamp: FenrirTimestamp
    }

    struct DetachPaneStreamInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let viewportID: ViewportID
        public let paneID: PaneID
        public let streamID: StreamID
        public let source: ActionSource

        public init(requestID: RequestID, viewportID: ViewportID, paneID: PaneID, streamID: StreamID, source: ActionSource) {
            self.requestID = requestID
            self.viewportID = viewportID
            self.paneID = paneID
            self.streamID = streamID
            self.source = source
        }
    }

    struct DetachPaneStreamResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let state: State
        public let timestamp: FenrirTimestamp
    }

    struct IngestTerminalOutputInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let viewportID: ViewportID
        public let paneID: PaneID
        public let streamID: StreamID
        public let sequence: UInt64
        public let bytes: Data
        public let source: ActionSource

        public init(requestID: RequestID, viewportID: ViewportID, paneID: PaneID, streamID: StreamID, sequence: UInt64, bytes: Data, source: ActionSource) {
            self.requestID = requestID
            self.viewportID = viewportID
            self.paneID = paneID
            self.streamID = streamID
            self.sequence = sequence
            self.bytes = bytes
            self.source = source
        }
    }

    struct IngestTerminalOutputResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let state: State
        public let appliedSequence: UInt64
        public let timestamp: FenrirTimestamp
    }

    struct TerminalOutputBackpressurePolicy: Codable, Equatable, Sendable {
        public let maxChunksPerBatch: Int
        public let maxBytesPerBatch: Int
        public let maxBytesPerRendererWrite: Int

        public init(
            maxChunksPerBatch: Int = 256,
            maxBytesPerBatch: Int = 1_048_576,
            maxBytesPerRendererWrite: Int = 65_536
        ) {
            self.maxChunksPerBatch = max(1, maxChunksPerBatch)
            self.maxBytesPerBatch = max(1, maxBytesPerBatch)
            self.maxBytesPerRendererWrite = max(1, maxBytesPerRendererWrite)
        }

        public static let defaults = TerminalOutputBackpressurePolicy()
    }

    struct TerminalOutputChunk: Codable, Equatable, Sendable {
        public let sequence: UInt64
        public let bytes: Data

        public init(sequence: UInt64, bytes: Data) {
            self.sequence = sequence
            self.bytes = bytes
        }
    }

    struct ReservedOSCProvenance: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let tabID: FenrirWindowID?
        public let paneID: PaneID
        public let viewportID: ViewportID
        public let streamID: StreamID
        public let sequence: UInt64

        public init(
            workspaceID: WorkspaceID,
            tabID: FenrirWindowID? = nil,
            paneID: PaneID,
            viewportID: ViewportID,
            streamID: StreamID,
            sequence: UInt64
        ) {
            self.workspaceID = workspaceID
            self.tabID = tabID
            self.paneID = paneID
            self.viewportID = viewportID
            self.streamID = streamID
            self.sequence = sequence
        }
    }

    struct ReservedOSCSignal: Codable, Equatable, Sendable {
        public let oscIdentifier: Int
        public let payload: String
        public let provenance: ReservedOSCProvenance

        public init(oscIdentifier: Int, payload: String, provenance: ReservedOSCProvenance) {
            self.oscIdentifier = oscIdentifier
            self.payload = payload
            self.provenance = provenance
        }
    }

    struct ReservedOSCSignalSummary: Codable, Equatable, Sendable {
        public let oscIdentifier: Int
        public let payloadByteCount: Int
        public let provenance: ReservedOSCProvenance

        public init(signal: ReservedOSCSignal) {
            self.oscIdentifier = signal.oscIdentifier
            self.payloadByteCount = signal.payload.utf8.count
            self.provenance = signal.provenance
        }
    }

    struct IngestTerminalOutputBatchInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let viewportID: ViewportID
        public let paneID: PaneID
        public let streamID: StreamID
        public let chunks: [TerminalOutputChunk]
        public let policy: TerminalOutputBackpressurePolicy
        public let source: ActionSource

        public init(
            requestID: RequestID,
            viewportID: ViewportID,
            paneID: PaneID,
            streamID: StreamID,
            chunks: [TerminalOutputChunk],
            policy: TerminalOutputBackpressurePolicy = .defaults,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.viewportID = viewportID
            self.paneID = paneID
            self.streamID = streamID
            self.chunks = chunks
            self.policy = policy
            self.source = source
        }
    }

    struct IngestTerminalOutputBatchResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let state: State
        public let appliedSequence: UInt64
        public let chunkCount: Int
        public let rendererWriteCount: Int
        public let timestamp: FenrirTimestamp
    }

    struct SendTerminalInputInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let viewportID: ViewportID
        public let workspaceID: WorkspaceID
        public let paneID: PaneID
        public let inputBytes: Data
        public let inputMode: InputMode
        public let source: ActionSource

        public init(requestID: RequestID, viewportID: ViewportID, workspaceID: WorkspaceID, paneID: PaneID, inputBytes: Data, inputMode: InputMode, source: ActionSource) {
            self.requestID = requestID
            self.viewportID = viewportID
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.inputBytes = inputBytes
            self.inputMode = inputMode
            self.source = source
        }
    }

    struct SendTerminalInputResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let acknowledgement: RuntimeWriteAcknowledgement
        public let timestamp: FenrirTimestamp
    }

    struct ResizeTerminalViewportInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let viewportID: ViewportID
        public let workspaceID: WorkspaceID
        public let paneID: PaneID
        public let size: Size
        public let source: ActionSource

        public init(requestID: RequestID, viewportID: ViewportID, workspaceID: WorkspaceID, paneID: PaneID, size: Size, source: ActionSource) {
            self.requestID = requestID
            self.viewportID = viewportID
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.size = size
            self.source = source
        }
    }

    struct ResizeTerminalViewportResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let state: State
        public let acknowledgement: RuntimeResizeAcknowledgement
        public let timestamp: FenrirTimestamp
    }

    struct FocusTerminalViewportInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let viewportID: ViewportID
        public let paneID: PaneID
        public let focused: Bool
        public let source: ActionSource

        public init(requestID: RequestID, viewportID: ViewportID, paneID: PaneID, focused: Bool, source: ActionSource) {
            self.requestID = requestID
            self.viewportID = viewportID
            self.paneID = paneID
            self.focused = focused
            self.source = source
        }
    }

    struct FocusTerminalViewportResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let state: State
        public let timestamp: FenrirTimestamp
    }

    struct CaptureLimit: Codable, Equatable, Sendable {
        public let maxLines: Int?
        public let maxCharacters: Int

        public init(maxLines: Int? = nil, maxCharacters: Int) {
            self.maxLines = maxLines
            self.maxCharacters = max(0, maxCharacters)
        }
    }

    struct ContextProvenance: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let tabID: FenrirWindowID?
        public let paneID: PaneID
        public let viewportID: ViewportID
        public let streamID: StreamID?
        public let lastAppliedSequence: UInt64?

        public init(
            workspaceID: WorkspaceID,
            tabID: FenrirWindowID? = nil,
            paneID: PaneID,
            viewportID: ViewportID,
            streamID: StreamID? = nil,
            lastAppliedSequence: UInt64? = nil
        ) {
            self.workspaceID = workspaceID
            self.tabID = tabID
            self.paneID = paneID
            self.viewportID = viewportID
            self.streamID = streamID
            self.lastAppliedSequence = lastAppliedSequence
        }
    }

    struct CapturedTextBuffer: Codable, Equatable, Sendable {
        public let text: String
        public let screen: ScreenBufferKind

        public init(text: String, screen: ScreenBufferKind = .primary) {
            self.text = text
            self.screen = screen
        }
    }

    struct RedactionReport: Codable, Equatable, Sendable {
        public let replacementCount: Int
        public let labels: [String]

        public init(replacementCount: Int = 0, labels: [String] = []) {
            self.replacementCount = replacementCount
            self.labels = labels
        }
    }

    struct RedactedCapture: Codable, Equatable, Sendable {
        public let text: String
        public let report: RedactionReport

        public init(text: String, report: RedactionReport = RedactionReport()) {
            self.text = text
            self.report = report
        }
    }

    struct CapturedContext: Codable, Equatable, Sendable {
        public let provenance: ContextProvenance
        public let kind: CaptureKind
        public let screen: ScreenBufferKind
        public let text: String
        public let lineCount: Int
        public let characterCount: Int
        public let isTruncated: Bool
        public let redactionReport: RedactionReport
        public let capturedAt: FenrirTimestamp

        public init(
            provenance: ContextProvenance,
            kind: CaptureKind,
            screen: ScreenBufferKind,
            text: String,
            lineCount: Int,
            characterCount: Int,
            isTruncated: Bool,
            redactionReport: RedactionReport,
            capturedAt: FenrirTimestamp
        ) {
            self.provenance = provenance
            self.kind = kind
            self.screen = screen
            self.text = text
            self.lineCount = lineCount
            self.characterCount = characterCount
            self.isTruncated = isTruncated
            self.redactionReport = redactionReport
            self.capturedAt = capturedAt
        }
    }

    struct CapturedContextSummary: Codable, Equatable, Sendable {
        public let provenance: ContextProvenance
        public let kind: CaptureKind
        public let screen: ScreenBufferKind
        public let lineCount: Int
        public let characterCount: Int
        public let isTruncated: Bool
        public let redactionReport: RedactionReport

        public init(context: CapturedContext) {
            self.provenance = context.provenance
            self.kind = context.kind
            self.screen = context.screen
            self.lineCount = context.lineCount
            self.characterCount = context.characterCount
            self.isTruncated = context.isTruncated
            self.redactionReport = context.redactionReport
        }
    }

    struct CaptureTerminalContextInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let viewportID: ViewportID
        public let workspaceID: WorkspaceID
        public let tabID: FenrirWindowID?
        public let paneID: PaneID
        public let limit: CaptureLimit
        public let source: ActionSource

        public init(
            requestID: RequestID,
            viewportID: ViewportID,
            workspaceID: WorkspaceID,
            tabID: FenrirWindowID? = nil,
            paneID: PaneID,
            limit: CaptureLimit,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.viewportID = viewportID
            self.workspaceID = workspaceID
            self.tabID = tabID
            self.paneID = paneID
            self.limit = limit
            self.source = source
        }
    }

    typealias CaptureTerminalSelectionInput = CaptureTerminalContextInput
    typealias CaptureTerminalViewportInput = CaptureTerminalContextInput
    typealias CaptureTerminalLastLinesInput = CaptureTerminalContextInput

    struct CaptureTerminalContextResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let context: CapturedContext
        public let timestamp: FenrirTimestamp
    }

    typealias CaptureTerminalSelectionResult = CaptureTerminalContextResult
    typealias CaptureTerminalViewportResult = CaptureTerminalContextResult
    typealias CaptureTerminalLastLinesResult = CaptureTerminalContextResult

    struct SnapshotTerminalViewportInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let viewportID: ViewportID
        public let paneID: PaneID
        public let source: ActionSource

        public init(requestID: RequestID, viewportID: ViewportID, paneID: PaneID, source: ActionSource) {
            self.requestID = requestID
            self.viewportID = viewportID
            self.paneID = paneID
            self.source = source
        }
    }

    struct SnapshotTerminalViewportResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let state: State
        public let timestamp: FenrirTimestamp
    }

    enum Event: Codable, Equatable, Sendable {
        case terminalViewportCreated(ViewportID)
        case terminalViewportDestroyed(ViewportID)
        case paneStreamAttached(ViewportID, StreamID)
        case paneStreamDetached(ViewportID, StreamID)
        case terminalOutputIngested(ViewportID, UInt64)
        case terminalInputSent(ViewportID, RequestID)
        case terminalViewportResized(ViewportID, Size)
        case terminalViewportFocused(ViewportID, Bool)
        case terminalViewportSnapshotted(ViewportID)
        case terminalContextCaptured(CapturedContextSummary)
        case reservedOSCForwarded(ReservedOSCSignalSummary)
    }
}
