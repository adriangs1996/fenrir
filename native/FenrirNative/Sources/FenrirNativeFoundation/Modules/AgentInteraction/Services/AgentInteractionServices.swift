import Foundation
import FenrirNativeShared

public extension AgentInteraction {
    protocol AgentInteractionClock: Sendable {
        func now() -> FenrirTimestamp
    }

    protocol AgentComposerStore: Sendable {
        func openComposer(_ composer: ComposerState) async throws
        func editComposerDraft(composerID: AgentComposerID, draft: String, updatedAt: FenrirTimestamp) async throws -> ComposerMutationResult
        func cancelComposer(composerID: AgentComposerID, updatedAt: FenrirTimestamp) async throws -> ComposerMutationResult
        func claimComposerForSubmit(composerID: AgentComposerID, updatedAt: FenrirTimestamp) async throws -> ComposerSubmitClaim
        func finalizeComposerSubmit(composerID: AgentComposerID, outcome: ComposerSubmitOutcome, updatedAt: FenrirTimestamp) async throws -> ComposerSubmitFinalization
    }

    protocol TerminalContextCapturing: Sendable {
        func captureTerminalContext(_ request: TerminalContextRequest) async throws -> CapturedTerminalContext
    }

    protocol TerminalContextRedacting: Sendable {
        func redactTerminalContext(_ context: CapturedTerminalContext) async throws -> RedactedTerminalContext
    }

    protocol AgentPromptSubmitting: Sendable {
        func submitAgentPrompt(_ request: ServerPromptRequest) async throws -> ServerPromptAccepted
    }

    protocol AgentInteractionEventPublishing: Sendable {
        func publish(_ event: EventEnvelope<Event>) async
    }

    struct RedactedTerminalContext: Codable, Equatable, Sendable {
        public let text: String
        public let report: RedactionReport

        public init(text: String, report: RedactionReport = RedactionReport()) {
            self.text = text
            self.report = report
        }
    }
}
