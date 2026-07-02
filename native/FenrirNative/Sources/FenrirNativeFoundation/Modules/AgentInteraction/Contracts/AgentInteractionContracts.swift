import Foundation
import FenrirNativeShared

public extension AgentInteraction {
    enum AgentInteractionError: String, Error, Codable, Equatable, Sendable {
        case unavailable = "AgentInteractionUnavailable"
        case composerNotFound = "AgentInteractionComposerNotFound"
        case stalePane = "AgentInteractionStalePane"
        case contextCaptureFailed = "AgentInteractionContextCaptureFailed"
        case redactionFailed = "AgentInteractionRedactionFailed"
        case promptEmpty = "AgentInteractionPromptEmpty"
        case submitFailed = "AgentInteractionSubmitFailed"
        case alreadySubmitted = "AgentInteractionAlreadySubmitted"
    }

    enum ContextKind: String, Codable, Equatable, Sendable {
        case selection
        case viewport
        case lastLines
    }

    enum ComposerStatus: String, Codable, Equatable, Sendable {
        case open
        case submitting
        case submitted
        case cancelled
    }

    struct ContextLimit: Codable, Equatable, Sendable {
        public let maxLines: Int?
        public let maxCharacters: Int

        public init(maxLines: Int? = nil, maxCharacters: Int) {
            self.maxLines = maxLines
            self.maxCharacters = max(0, maxCharacters)
        }
    }

    struct TerminalContextRequest: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let workspaceID: WorkspaceID
        public let viewportID: ViewportID
        public let tabID: FenrirWindowID?
        public let paneID: PaneID
        public let kind: ContextKind
        public let limit: ContextLimit
        public let source: ActionSource

        public init(
            requestID: RequestID,
            workspaceID: WorkspaceID,
            viewportID: ViewportID,
            tabID: FenrirWindowID? = nil,
            paneID: PaneID,
            kind: ContextKind,
            limit: ContextLimit,
            source: ActionSource
        ) {
            self.requestID = requestID
            self.workspaceID = workspaceID
            self.viewportID = viewportID
            self.tabID = tabID
            self.paneID = paneID
            self.kind = kind
            self.limit = limit
            self.source = source
        }
    }

    struct CapturedTerminalContext: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let viewportID: ViewportID
        public let tabID: FenrirWindowID?
        public let paneID: PaneID
        public let kind: ContextKind
        public let text: String

        public init(workspaceID: WorkspaceID, viewportID: ViewportID, tabID: FenrirWindowID? = nil, paneID: PaneID, kind: ContextKind, text: String) {
            self.workspaceID = workspaceID
            self.viewportID = viewportID
            self.tabID = tabID
            self.paneID = paneID
            self.kind = kind
            self.text = text
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

    struct TerminalContextAttachment: Codable, Equatable, Sendable {
        public let attachmentID: RequestID
        public let workspaceID: WorkspaceID
        public let viewportID: ViewportID
        public let tabID: FenrirWindowID?
        public let paneID: PaneID
        public let kind: ContextKind
        public let text: String
        public let lineCount: Int
        public let characterCount: Int
        public let isTruncated: Bool
        public let redactionReport: RedactionReport
        public let capturedAt: FenrirTimestamp

        public init(
            attachmentID: RequestID,
            workspaceID: WorkspaceID,
            viewportID: ViewportID,
            tabID: FenrirWindowID? = nil,
            paneID: PaneID,
            kind: ContextKind,
            text: String,
            lineCount: Int,
            characterCount: Int,
            isTruncated: Bool,
            redactionReport: RedactionReport,
            capturedAt: FenrirTimestamp
        ) {
            self.attachmentID = attachmentID
            self.workspaceID = workspaceID
            self.viewportID = viewportID
            self.tabID = tabID
            self.paneID = paneID
            self.kind = kind
            self.text = text
            self.lineCount = lineCount
            self.characterCount = characterCount
            self.isTruncated = isTruncated
            self.redactionReport = redactionReport
            self.capturedAt = capturedAt
        }
    }

    struct TerminalContextAttachmentSummary: Codable, Equatable, Sendable {
        public let attachmentID: RequestID
        public let workspaceID: WorkspaceID
        public let viewportID: ViewportID
        public let tabID: FenrirWindowID?
        public let paneID: PaneID
        public let kind: ContextKind
        public let lineCount: Int
        public let characterCount: Int
        public let isTruncated: Bool
        public let redactionReport: RedactionReport
        public let capturedAt: FenrirTimestamp

        public init(attachment: TerminalContextAttachment) {
            self.attachmentID = attachment.attachmentID
            self.workspaceID = attachment.workspaceID
            self.viewportID = attachment.viewportID
            self.tabID = attachment.tabID
            self.paneID = attachment.paneID
            self.kind = attachment.kind
            self.lineCount = attachment.lineCount
            self.characterCount = attachment.characterCount
            self.isTruncated = attachment.isTruncated
            self.redactionReport = attachment.redactionReport
            self.capturedAt = attachment.capturedAt
        }
    }

    struct CaptureTerminalContextResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let attachment: TerminalContextAttachment
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, attachment: TerminalContextAttachment, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.attachment = attachment
            self.timestamp = timestamp
        }
    }

    struct AgentComposerID: FenrirID, ExpressibleByStringLiteral {
        public let rawValue: String

        public init(rawValue: String) {
            self.rawValue = rawValue
        }

        public init(stringLiteral value: String) {
            self.init(rawValue: value)
        }
    }

    struct TargetWorkspace: Codable, Equatable, Sendable {
        public let workspaceID: WorkspaceID
        public let originatingPaneID: PaneID?
        public let originatingViewportID: ViewportID?

        public init(workspaceID: WorkspaceID, originatingPaneID: PaneID? = nil, originatingViewportID: ViewportID? = nil) {
            self.workspaceID = workspaceID
            self.originatingPaneID = originatingPaneID
            self.originatingViewportID = originatingViewportID
        }
    }

    struct ComposerState: Codable, Equatable, Sendable {
        public let composerID: AgentComposerID
        public let target: TargetWorkspace
        public let draft: String
        public let attachments: [TerminalContextAttachment]
        public let status: ComposerStatus
        public let submittedPromptID: RequestID?
        public let updatedAt: FenrirTimestamp

        public init(
            composerID: AgentComposerID,
            target: TargetWorkspace,
            draft: String,
            attachments: [TerminalContextAttachment] = [],
            status: ComposerStatus = .open,
            submittedPromptID: RequestID? = nil,
            updatedAt: FenrirTimestamp
        ) {
            self.composerID = composerID
            self.target = target
            self.draft = draft
            self.attachments = attachments
            self.status = status
            self.submittedPromptID = submittedPromptID
            self.updatedAt = updatedAt
        }
    }

    enum ComposerMutationResult: Codable, Equatable, Sendable {
        case mutated(ComposerState)
        case notFound
        case unavailableStatus(ComposerStatus)
    }

    enum ComposerSubmitClaim: Codable, Equatable, Sendable {
        case claimed(ComposerState)
        case notFound
        case unavailableStatus(ComposerStatus)
    }

    enum ComposerSubmitOutcome: Codable, Equatable, Sendable {
        case submitted(RequestID)
        case failed
    }

    enum ComposerSubmitFinalization: Codable, Equatable, Sendable {
        case finalized(ComposerState)
        case cancelled(ComposerState)
        case notFound
        case unavailableStatus(ComposerStatus)
    }

    struct OpenAgentComposerInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let composerID: AgentComposerID
        public let target: TargetWorkspace
        public let draft: String
        public let attachments: [TerminalContextAttachment]
        public let source: ActionSource

        public init(requestID: RequestID, composerID: AgentComposerID, target: TargetWorkspace, draft: String = "", attachments: [TerminalContextAttachment] = [], source: ActionSource) {
            self.requestID = requestID
            self.composerID = composerID
            self.target = target
            self.draft = draft
            self.attachments = attachments
            self.source = source
        }
    }

    struct AgentComposerResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let composer: ComposerState
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, composer: ComposerState, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.composer = composer
            self.timestamp = timestamp
        }
    }

    struct OpenAgentComposerFromContextInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let contextRequest: TerminalContextRequest
        public let composerID: AgentComposerID
        public let target: TargetWorkspace
        public let draft: String
        public let source: ActionSource

        public init(
            requestID: RequestID,
            contextRequest: TerminalContextRequest,
            composerID: AgentComposerID,
            target: TargetWorkspace,
            draft: String = "",
            source: ActionSource
        ) {
            self.requestID = requestID
            self.contextRequest = contextRequest
            self.composerID = composerID
            self.target = target
            self.draft = draft
            self.source = source
        }
    }

    struct EditAgentPromptDraftInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let composerID: AgentComposerID
        public let draft: String
        public let source: ActionSource

        public init(requestID: RequestID, composerID: AgentComposerID, draft: String, source: ActionSource) {
            self.requestID = requestID
            self.composerID = composerID
            self.draft = draft
            self.source = source
        }
    }

    struct SubmitAgentPromptInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let composerID: AgentComposerID
        public let source: ActionSource

        public init(requestID: RequestID, composerID: AgentComposerID, source: ActionSource) {
            self.requestID = requestID
            self.composerID = composerID
            self.source = source
        }
    }

    struct ServerPromptRequest: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let composerID: AgentComposerID
        public let target: TargetWorkspace
        public let prompt: String
        public let attachments: [TerminalContextAttachment]

        public init(requestID: RequestID, composerID: AgentComposerID, target: TargetWorkspace, prompt: String, attachments: [TerminalContextAttachment]) {
            self.requestID = requestID
            self.composerID = composerID
            self.target = target
            self.prompt = prompt
            self.attachments = attachments
        }
    }

    struct ServerPromptAccepted: Codable, Equatable, Sendable {
        public let promptID: RequestID
        public let acceptedAt: FenrirTimestamp

        public init(promptID: RequestID, acceptedAt: FenrirTimestamp) {
            self.promptID = promptID
            self.acceptedAt = acceptedAt
        }
    }

    struct SubmitAgentPromptResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let composer: ComposerState
        public let accepted: ServerPromptAccepted
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, composer: ComposerState, accepted: ServerPromptAccepted, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.composer = composer
            self.accepted = accepted
            self.timestamp = timestamp
        }
    }

    struct CancelAgentComposerInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let composerID: AgentComposerID
        public let source: ActionSource

        public init(requestID: RequestID, composerID: AgentComposerID, source: ActionSource) {
            self.requestID = requestID
            self.composerID = composerID
            self.source = source
        }
    }

    struct ModuleSummary: Codable, Equatable, Sendable {
        public let moduleName: String
        public let registeredAt: FenrirTimestamp

        public init(moduleName: String = "AgentInteraction", registeredAt: FenrirTimestamp) {
            self.moduleName = moduleName
            self.registeredAt = registeredAt
        }
    }

    struct DescribeAgentInteractionModuleInput: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let source: ActionSource

        public init(requestID: RequestID, source: ActionSource) {
            self.requestID = requestID
            self.source = source
        }
    }

    struct DescribeAgentInteractionModuleResult: Codable, Equatable, Sendable {
        public let requestID: RequestID
        public let summary: ModuleSummary
        public let timestamp: FenrirTimestamp

        public init(requestID: RequestID, summary: ModuleSummary, timestamp: FenrirTimestamp) {
            self.requestID = requestID
            self.summary = summary
            self.timestamp = timestamp
        }
    }

    enum Event: Codable, Equatable, Sendable {
        case moduleRegistered(String)
        case terminalContextCaptured(TerminalContextAttachmentSummary)
        case composerOpened(AgentComposerID)
        case promptDraftEdited(AgentComposerID)
        case promptSubmitted(AgentComposerID, RequestID)
        case promptSubmitFailed(AgentComposerID, RequestID)
        case composerCancelled(AgentComposerID)
    }
}
