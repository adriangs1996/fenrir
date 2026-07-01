import Foundation
import FenrirNativeShared

public extension TerminalViewport {
    enum RendererStatus: String, Codable, Equatable, Sendable {
        case unavailable
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
    }

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
        public let paneID: PaneID
        public let streamID: StreamID?
        public let lastAppliedSequence: UInt64?
        public let isFocused: Bool
        public let rendererStatus: RendererStatus
        public let streamStatus: StreamStatus
        public let size: Size?

        public init(
            viewportID: ViewportID,
            workspaceID: WorkspaceID,
            paneID: PaneID,
            streamID: StreamID? = nil,
            lastAppliedSequence: UInt64? = nil,
            isFocused: Bool = false,
            rendererStatus: RendererStatus,
            streamStatus: StreamStatus = .detached,
            size: Size? = nil
        ) {
            self.viewportID = viewportID
            self.workspaceID = workspaceID
            self.paneID = paneID
            self.streamID = streamID
            self.lastAppliedSequence = lastAppliedSequence
            self.isFocused = isFocused
            self.rendererStatus = rendererStatus
            self.streamStatus = streamStatus
            self.size = size
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
        public let paneID: PaneID
        public let size: Size?
        public let source: ActionSource

        public init(requestID: RequestID, viewportID: ViewportID, workspaceID: WorkspaceID, paneID: PaneID, size: Size? = nil, source: ActionSource) {
            self.requestID = requestID
            self.viewportID = viewportID
            self.workspaceID = workspaceID
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
    }
}
