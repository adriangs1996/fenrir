import Foundation
import FenrirNativeShared

public extension AgentInteraction {
    struct DescribeAgentInteractionModule: FenrirAction {
        public typealias Failure = AgentInteractionError

        public let clock: any AgentInteractionClock

        public init(clock: any AgentInteractionClock) {
            self.clock = clock
        }

        public func run(_ input: DescribeAgentInteractionModuleInput) async -> Result<DescribeAgentInteractionModuleResult, AgentInteractionError> {
            let timestamp = clock.now()
            return .success(DescribeAgentInteractionModuleResult(
                requestID: input.requestID,
                summary: ModuleSummary(registeredAt: timestamp),
                timestamp: timestamp
            ))
        }
    }

    struct CaptureAgentSelection: FenrirAction {
        public typealias Failure = AgentInteractionError

        let capturer: any TerminalContextCapturing
        let redactor: any TerminalContextRedacting
        let clock: any AgentInteractionClock
        let events: (any AgentInteractionEventPublishing)?

        public init(capturer: any TerminalContextCapturing, redactor: any TerminalContextRedacting, clock: any AgentInteractionClock, events: (any AgentInteractionEventPublishing)? = nil) {
            self.capturer = capturer
            self.redactor = redactor
            self.clock = clock
            self.events = events
        }

        public func run(_ input: TerminalContextRequest) async -> Result<CaptureTerminalContextResult, AgentInteractionError> {
            await AgentInteraction.capture(input, expectedKind: .selection, capturer: capturer, redactor: redactor, clock: clock, events: events)
        }
    }

    struct CaptureAgentViewport: FenrirAction {
        public typealias Failure = AgentInteractionError

        let capturer: any TerminalContextCapturing
        let redactor: any TerminalContextRedacting
        let clock: any AgentInteractionClock
        let events: (any AgentInteractionEventPublishing)?

        public init(capturer: any TerminalContextCapturing, redactor: any TerminalContextRedacting, clock: any AgentInteractionClock, events: (any AgentInteractionEventPublishing)? = nil) {
            self.capturer = capturer
            self.redactor = redactor
            self.clock = clock
            self.events = events
        }

        public func run(_ input: TerminalContextRequest) async -> Result<CaptureTerminalContextResult, AgentInteractionError> {
            await AgentInteraction.capture(input, expectedKind: .viewport, capturer: capturer, redactor: redactor, clock: clock, events: events)
        }
    }

    struct CaptureAgentLastLines: FenrirAction {
        public typealias Failure = AgentInteractionError

        let capturer: any TerminalContextCapturing
        let redactor: any TerminalContextRedacting
        let clock: any AgentInteractionClock
        let events: (any AgentInteractionEventPublishing)?

        public init(capturer: any TerminalContextCapturing, redactor: any TerminalContextRedacting, clock: any AgentInteractionClock, events: (any AgentInteractionEventPublishing)? = nil) {
            self.capturer = capturer
            self.redactor = redactor
            self.clock = clock
            self.events = events
        }

        public func run(_ input: TerminalContextRequest) async -> Result<CaptureTerminalContextResult, AgentInteractionError> {
            await AgentInteraction.capture(input, expectedKind: .lastLines, capturer: capturer, redactor: redactor, clock: clock, events: events)
        }
    }

    struct OpenAgentComposer: FenrirAction {
        public typealias Failure = AgentInteractionError

        let store: any AgentComposerStore
        let clock: any AgentInteractionClock
        let events: (any AgentInteractionEventPublishing)?

        public init(store: any AgentComposerStore, clock: any AgentInteractionClock, events: (any AgentInteractionEventPublishing)? = nil) {
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: OpenAgentComposerInput) async -> Result<AgentComposerResult, AgentInteractionError> {
            do {
                let timestamp = clock.now()
                let composer = ComposerState(
                    composerID: input.composerID,
                    target: input.target,
                    draft: input.draft,
                    attachments: input.attachments,
                    updatedAt: timestamp
                )
                try await store.openComposer(composer)
                await events?.publish(AgentInteraction.envelope(input.requestID, "AgentComposerOpened", timestamp, .composerOpened(input.composerID)))
                return .success(AgentComposerResult(requestID: input.requestID, composer: composer, timestamp: timestamp))
            } catch {
                return .failure(.unavailable)
            }
        }
    }

    struct OpenAgentComposerFromContext: FenrirAction {
        public typealias Failure = AgentInteractionError

        let capturer: any TerminalContextCapturing
        let redactor: any TerminalContextRedacting
        let store: any AgentComposerStore
        let clock: any AgentInteractionClock
        let events: (any AgentInteractionEventPublishing)?

        public init(
            capturer: any TerminalContextCapturing,
            redactor: any TerminalContextRedacting,
            store: any AgentComposerStore,
            clock: any AgentInteractionClock,
            events: (any AgentInteractionEventPublishing)? = nil
        ) {
            self.capturer = capturer
            self.redactor = redactor
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: OpenAgentComposerFromContextInput) async -> Result<AgentComposerResult, AgentInteractionError> {
            let captured = await AgentInteraction.capture(
                input.contextRequest,
                expectedKind: input.contextRequest.kind,
                capturer: capturer,
                redactor: redactor,
                clock: clock,
                events: events
            )

            switch captured {
            case let .failure(error):
                return .failure(error)
            case let .success(result):
                let open = OpenAgentComposer(store: store, clock: clock, events: events)
                return await open.run(OpenAgentComposerInput(
                    requestID: input.requestID,
                    composerID: input.composerID,
                    target: input.target,
                    draft: input.draft,
                    attachments: [result.attachment],
                    source: input.source
                ))
            }
        }
    }

    struct EditAgentPromptDraft: FenrirAction {
        public typealias Failure = AgentInteractionError

        let store: any AgentComposerStore
        let clock: any AgentInteractionClock
        let events: (any AgentInteractionEventPublishing)?

        public init(store: any AgentComposerStore, clock: any AgentInteractionClock, events: (any AgentInteractionEventPublishing)? = nil) {
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: EditAgentPromptDraftInput) async -> Result<AgentComposerResult, AgentInteractionError> {
            do {
                let timestamp = clock.now()
                switch try await store.editComposerDraft(composerID: input.composerID, draft: input.draft, updatedAt: timestamp) {
                case let .mutated(next):
                    await events?.publish(AgentInteraction.envelope(input.requestID, "AgentPromptDraftEdited", timestamp, .promptDraftEdited(input.composerID)))
                    return .success(AgentComposerResult(requestID: input.requestID, composer: next, timestamp: timestamp))
                case .notFound:
                    return .failure(.composerNotFound)
                case .unavailableStatus:
                    return .failure(.alreadySubmitted)
                }
            } catch let error as AgentInteractionError {
                return .failure(error)
            } catch {
                return .failure(.unavailable)
            }
        }
    }

    struct SubmitAgentPrompt: FenrirAction {
        public typealias Failure = AgentInteractionError

        let store: any AgentComposerStore
        let submitter: any AgentPromptSubmitting
        let clock: any AgentInteractionClock
        let events: (any AgentInteractionEventPublishing)?

        public init(store: any AgentComposerStore, submitter: any AgentPromptSubmitting, clock: any AgentInteractionClock, events: (any AgentInteractionEventPublishing)? = nil) {
            self.store = store
            self.submitter = submitter
            self.clock = clock
            self.events = events
        }

        public func run(_ input: SubmitAgentPromptInput) async -> Result<SubmitAgentPromptResult, AgentInteractionError> {
            do {
                let submittingAt = clock.now()
                let composer: ComposerState
                switch try await store.claimComposerForSubmit(composerID: input.composerID, updatedAt: submittingAt) {
                case let .claimed(claimed):
                    composer = claimed
                case .notFound:
                    return .failure(.composerNotFound)
                case .unavailableStatus:
                    return .failure(.alreadySubmitted)
                }

                let prompt = composer.draft.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !prompt.isEmpty else {
                    _ = try? await store.finalizeComposerSubmit(composerID: input.composerID, outcome: .failed, updatedAt: clock.now())
                    return .failure(.promptEmpty)
                }

                let request = ServerPromptRequest(
                    requestID: input.requestID,
                    composerID: input.composerID,
                    target: composer.target,
                    prompt: prompt,
                    attachments: composer.attachments
                )
                let accepted: ServerPromptAccepted
                do {
                    accepted = try await submitter.submitAgentPrompt(request)
                } catch {
                    let failedAt = clock.now()
                    _ = try? await store.finalizeComposerSubmit(composerID: input.composerID, outcome: .failed, updatedAt: failedAt)
                    await events?.publish(AgentInteraction.envelope(input.requestID, "AgentPromptSubmitFailed", failedAt, .promptSubmitFailed(input.composerID, input.requestID)))
                    return .failure(.submitFailed)
                }
                let timestamp = clock.now()
                let submitted: ComposerState
                switch try await store.finalizeComposerSubmit(composerID: input.composerID, outcome: .submitted(accepted.promptID), updatedAt: timestamp) {
                case let .finalized(finalized):
                    submitted = finalized
                case .cancelled:
                    return .failure(.alreadySubmitted)
                case .notFound:
                    return .failure(.composerNotFound)
                case .unavailableStatus:
                    return .failure(.alreadySubmitted)
                }
                await events?.publish(AgentInteraction.envelope(input.requestID, "AgentPromptSubmitted", timestamp, .promptSubmitted(input.composerID, accepted.promptID)))
                return .success(SubmitAgentPromptResult(requestID: input.requestID, composer: submitted, accepted: accepted, timestamp: timestamp))
            } catch let error as AgentInteractionError {
                return .failure(error)
            } catch {
                let timestamp = clock.now()
                await events?.publish(AgentInteraction.envelope(input.requestID, "AgentPromptSubmitFailed", timestamp, .promptSubmitFailed(input.composerID, input.requestID)))
                return .failure(.submitFailed)
            }
        }
    }

    struct CancelAgentPrompt: FenrirAction {
        public typealias Failure = AgentInteractionError

        let store: any AgentComposerStore
        let clock: any AgentInteractionClock
        let events: (any AgentInteractionEventPublishing)?

        public init(store: any AgentComposerStore, clock: any AgentInteractionClock, events: (any AgentInteractionEventPublishing)? = nil) {
            self.store = store
            self.clock = clock
            self.events = events
        }

        public func run(_ input: CancelAgentComposerInput) async -> Result<AgentComposerResult, AgentInteractionError> {
            do {
                let timestamp = clock.now()
                switch try await store.cancelComposer(composerID: input.composerID, updatedAt: timestamp) {
                case let .mutated(next):
                    await events?.publish(AgentInteraction.envelope(input.requestID, "AgentComposerCancelled", timestamp, .composerCancelled(input.composerID)))
                    return .success(AgentComposerResult(requestID: input.requestID, composer: next, timestamp: timestamp))
                case .notFound:
                    return .failure(.composerNotFound)
                case .unavailableStatus:
                    return .failure(.alreadySubmitted)
                }
            } catch let error as AgentInteractionError {
                return .failure(error)
            } catch {
                return .failure(.unavailable)
            }
        }
    }
}

extension AgentInteraction {
    static func capture(
        _ input: TerminalContextRequest,
        expectedKind: ContextKind,
        capturer: any TerminalContextCapturing,
        redactor: any TerminalContextRedacting,
        clock: any AgentInteractionClock,
        events: (any AgentInteractionEventPublishing)?
    ) async -> Result<CaptureTerminalContextResult, AgentInteractionError> {
        guard input.kind == expectedKind else {
            return .failure(.contextCaptureFailed)
        }
        do {
            let captured = try await capturer.captureTerminalContext(input)
            guard captured.workspaceID == input.workspaceID,
                  captured.viewportID == input.viewportID,
                  captured.tabID == input.tabID,
                  captured.paneID == input.paneID,
                  captured.kind == input.kind else {
                return .failure(.stalePane)
            }
            let redacted: RedactedTerminalContext
            do {
                redacted = try await redactor.redactTerminalContext(captured)
            } catch let error as AgentInteractionError {
                return .failure(error)
            } catch {
                return .failure(.redactionFailed)
            }
            let bounded = bound(redacted.text, limit: input.limit)
            let timestamp = clock.now()
            let attachment = TerminalContextAttachment(
                attachmentID: input.requestID,
                workspaceID: input.workspaceID,
                viewportID: input.viewportID,
                tabID: input.tabID,
                paneID: input.paneID,
                kind: input.kind,
                text: bounded.text,
                lineCount: bounded.lineCount,
                characterCount: bounded.characterCount,
                isTruncated: bounded.isTruncated,
                redactionReport: redacted.report,
                capturedAt: timestamp
            )
            await events?.publish(envelope(input.requestID, "AgentTerminalContextCaptured", timestamp, .terminalContextCaptured(TerminalContextAttachmentSummary(attachment: attachment))))
            return .success(CaptureTerminalContextResult(requestID: input.requestID, attachment: attachment, timestamp: timestamp))
        } catch let error as AgentInteractionError {
            return .failure(error)
        } catch {
            return .failure(.contextCaptureFailed)
        }
    }

    static func envelope(_ requestID: RequestID, _ kind: String, _ timestamp: FenrirTimestamp, _ event: Event) -> EventEnvelope<Event> {
        EventEnvelope(eventID: requestID, eventKind: kind, timestamp: timestamp, event: event)
    }

    static func bound(_ text: String, limit: ContextLimit) -> (text: String, lineCount: Int, characterCount: Int, isTruncated: Bool) {
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
}

private extension AgentInteraction.ComposerState {
    func updated(
        draft: String? = nil,
        status: AgentInteraction.ComposerStatus? = nil,
        submittedPromptID: RequestID?? = nil,
        updatedAt: FenrirTimestamp
    ) -> AgentInteraction.ComposerState {
        AgentInteraction.ComposerState(
            composerID: composerID,
            target: target,
            draft: draft ?? self.draft,
            attachments: attachments,
            status: status ?? self.status,
            submittedPromptID: submittedPromptID ?? self.submittedPromptID,
            updatedAt: updatedAt
        )
    }
}

private extension String {
    var lineCount: Int {
        guard !isEmpty else {
            return 0
        }
        return split(separator: "\n", omittingEmptySubsequences: false).count
    }
}
