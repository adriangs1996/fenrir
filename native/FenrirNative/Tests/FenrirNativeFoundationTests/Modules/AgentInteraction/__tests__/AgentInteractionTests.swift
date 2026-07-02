import AppKit
import Foundation
import Testing
import FenrirNativeShared
@testable import AgentInteraction

@Suite("AgentInteraction module registration")
struct AgentInteractionTests {
    @Test("DescribeAgentInteractionModule exposes the AgentInteraction target")
    func describeModule() async throws {
        let action = AgentInteraction.DescribeAgentInteractionModule(clock: FixedClock())

        let result = try await action.run(.init(requestID: "agent-interaction", source: .test)).get()

        #expect(result.summary.moduleName == "AgentInteraction")
        #expect(result.requestID == "agent-interaction")
    }

    @Test("CaptureAgentLastLines bounds context by last lines and characters")
    func captureLastLinesBoundsContext() async throws {
        let capturer = ContextCapturer(text: "one\ntwo\nthree\nfour")
        let action = AgentInteraction.CaptureAgentLastLines(capturer: capturer, redactor: ContextRedactor(), clock: FixedClock())

        let result = try await action.run(contextRequest(kind: .lastLines, limit: .init(maxLines: 2, maxCharacters: 9))).get()

        #expect(result.attachment.text == "hree\nfour")
        #expect(result.attachment.lineCount == 2)
        #expect(result.attachment.characterCount == 9)
        #expect(result.attachment.isTruncated)
    }

    @Test("CaptureAgentViewport applies redaction hook before packaging")
    func captureViewportAppliesRedactionHook() async throws {
        let capturer = ContextCapturer(text: "token=SECRET")
        let redactor = ContextRedactor(replacements: ["SECRET": "[REDACTED]"], labels: ["secret"])
        let action = AgentInteraction.CaptureAgentViewport(capturer: capturer, redactor: redactor, clock: FixedClock())

        let result = try await action.run(contextRequest(kind: .viewport, limit: .init(maxCharacters: 100))).get()

        #expect(result.attachment.text == "token=[REDACTED]")
        #expect(result.attachment.redactionReport.replacementCount == 1)
        #expect(result.attachment.redactionReport.labels == ["secret"])
    }

    @Test("CaptureAgentViewport publishes bounded context event contract")
    func captureViewportPublishesContextEventContract() async throws {
        let events = EventCollector()
        let action = AgentInteraction.CaptureAgentViewport(
            capturer: ContextCapturer(text: "line 1\nline 2 token=SECRET\nline 3"),
            redactor: ContextRedactor(replacements: ["SECRET": "[REDACTED]"], labels: ["secret"]),
            clock: FixedClock(),
            events: events
        )

        let result = try await action.run(contextRequest(kind: .viewport, limit: .init(maxLines: 2, maxCharacters: 100))).get()

        let published = await events.published
        #expect(published.map(\.eventKind) == ["AgentTerminalContextCaptured"])
        guard case let .terminalContextCaptured(attachment) = published.first?.event else {
            Issue.record("Expected terminalContextCaptured event")
            return
        }
        #expect(attachment.attachmentID == "context-1")
        #expect(attachment.workspaceID == "workspace-1")
        #expect(attachment.viewportID == "viewport-1")
        #expect(attachment.paneID == "pane-1")
        #expect(attachment.kind == .viewport)
        #expect(attachment.lineCount == 2)
        #expect(attachment.characterCount == 30)
        #expect(attachment.isTruncated)
        #expect(attachment.redactionReport == .init(replacementCount: 1, labels: ["secret"]))
        #expect(attachment.capturedAt == FixedClock().now())
        #expect(!String(describing: published).contains("line 2 token=[REDACTED]\nline 3"))
        #expect(result.attachment.text == "line 2 token=[REDACTED]\nline 3")
    }

    @Test("CaptureAgentViewport maps redaction failures distinctly")
    func captureViewportMapsRedactionFailures() async {
        let action = AgentInteraction.CaptureAgentViewport(capturer: ContextCapturer(text: "token=SECRET"), redactor: FailingRedactor(), clock: FixedClock())

        let result = await action.run(contextRequest(kind: .viewport, limit: .init(maxCharacters: 100)))

        #expect(result == .failure(AgentInteraction.AgentInteractionError.redactionFailed))
    }

    @Test("CaptureAgentSelection accepts empty selection")
    func captureSelectionAcceptsEmptySelection() async throws {
        let action = AgentInteraction.CaptureAgentSelection(capturer: ContextCapturer(text: ""), redactor: ContextRedactor(), clock: FixedClock())

        let result = try await action.run(contextRequest(kind: .selection, limit: .init(maxCharacters: 100))).get()

        #expect(result.attachment.text == "")
        #expect(result.attachment.lineCount == 0)
        #expect(!result.attachment.isTruncated)
    }

    @Test("CaptureAgentViewport rejects stale pane identity")
    func captureViewportRejectsStalePane() async {
        let capturer = ContextCapturer(text: "stale", paneID: "pane-other")
        let action = AgentInteraction.CaptureAgentViewport(capturer: capturer, redactor: ContextRedactor(), clock: FixedClock())

        let result = await action.run(contextRequest(kind: .viewport, limit: .init(maxCharacters: 100)))

        #expect(result == .failure(AgentInteraction.AgentInteractionError.stalePane))
    }

    @Test("Composer actions open, edit, cancel, and submit through server prompt port")
    func composerLifecycleSubmitsThroughServerPromptPort() async throws {
        let store = ComposerStore()
        let submitter = PromptSubmitter()
        let open = AgentInteraction.OpenAgentComposer(store: store, clock: FixedClock())
        let edit = AgentInteraction.EditAgentPromptDraft(store: store, clock: FixedClock())
        let submit = AgentInteraction.SubmitAgentPrompt(store: store, submitter: submitter, clock: FixedClock())

        _ = try await open.run(openInput()).get()
        let edited = try await edit.run(.init(requestID: "edit", composerID: "composer-1", draft: "  explain this  ", source: .test)).get()
        let submitted = try await submit.run(.init(requestID: "submit", composerID: "composer-1", source: .test)).get()

        #expect(edited.composer.draft == "  explain this  ")
        #expect(submitted.composer.status == .submitted)
        #expect(submitted.accepted.promptID == "server-prompt-1")
        #expect(await submitter.requests.map(\.prompt) == ["explain this"])
    }

    @Test("OpenAgentComposerFromContext captures selection, viewport, and last-lines attachments")
    func openComposerFromContextCapturesExpectedKinds() async throws {
        let kinds: [AgentInteraction.ContextKind] = [.selection, .viewport, .lastLines]

        for kind in kinds {
            let store = ComposerStore()
            let action = AgentInteraction.OpenAgentComposerFromContext(
                capturer: ContextCapturer(text: "context for \(kind.rawValue)"),
                redactor: ContextRedactor(),
                store: store,
                clock: FixedClock()
            )

            let result = try await action.run(.init(
                requestID: RequestID(rawValue: "open-\(kind.rawValue)"),
                contextRequest: contextRequest(kind: kind, limit: .init(maxLines: kind == .lastLines ? 1 : nil, maxCharacters: 100)),
                composerID: AgentInteraction.AgentComposerID(rawValue: "composer-\(kind.rawValue)"),
                target: AgentInteraction.TargetWorkspace(workspaceID: "workspace-1", originatingPaneID: "pane-1", originatingViewportID: "viewport-1"),
                draft: "explain",
                source: .test
            )).get()

            #expect(result.composer.status == AgentInteraction.ComposerStatus.open)
            #expect(result.composer.draft == "explain")
            #expect(result.composer.attachments.map { $0.kind } == [kind])
            #expect(result.composer.attachments.first?.paneID == "pane-1")
        }
    }

    @Test("SubmitAgentPrompt restores open composer after submit failure")
    func submitPromptFailureIsRetryable() async throws {
        let store = ComposerStore()
        let submitter = PromptSubmitter(result: .failure(TestError.failed))
        let open = AgentInteraction.OpenAgentComposer(store: store, clock: FixedClock())
        let submit = AgentInteraction.SubmitAgentPrompt(store: store, submitter: submitter, clock: FixedClock())
        _ = try await open.run(openInput(draft: "retry me")).get()

        let result = await submit.run(.init(requestID: "submit", composerID: "composer-1", source: .test))

        #expect(result == .failure(AgentInteraction.AgentInteractionError.submitFailed))
        #expect(await store.loadStatus(composerID: "composer-1") == .open)
        #expect(await submitter.requests.count == 1)
    }

    @Test("SubmitAgentPrompt publishes server prompt event contracts")
    func submitPromptPublishesServerPromptEventContracts() async throws {
        let store = ComposerStore()
        let submitter = PromptSubmitter()
        let events = EventCollector()
        let open = AgentInteraction.OpenAgentComposer(store: store, clock: FixedClock(), events: events)
        let submit = AgentInteraction.SubmitAgentPrompt(store: store, submitter: submitter, clock: FixedClock(), events: events)
        _ = try await open.run(openInput(draft: "send to server")).get()

        _ = try await submit.run(.init(requestID: "submit", composerID: "composer-1", source: .test)).get()

        let published = await events.published
        #expect(published.map(\.eventKind) == ["AgentComposerOpened", "AgentPromptSubmitted"])
        #expect(published.map(\.event) == [
            .composerOpened("composer-1"),
            .promptSubmitted("composer-1", "server-prompt-1")
        ])
    }

    @Test("SubmitAgentPrompt publishes failure event contract")
    func submitPromptPublishesFailureEventContract() async throws {
        let store = ComposerStore()
        let submitter = PromptSubmitter(result: .failure(TestError.failed))
        let events = EventCollector()
        let open = AgentInteraction.OpenAgentComposer(store: store, clock: FixedClock())
        let submit = AgentInteraction.SubmitAgentPrompt(store: store, submitter: submitter, clock: FixedClock(), events: events)
        _ = try await open.run(openInput(draft: "try server")).get()

        _ = await submit.run(.init(requestID: "submit", composerID: "composer-1", source: .test))

        let published = await events.published
        #expect(published.map(\.eventKind) == ["AgentPromptSubmitFailed"])
        #expect(published.map(\.event) == [.promptSubmitFailed("composer-1", "submit")])
    }

    @Test("Concurrent SubmitAgentPrompt calls atomically claim one composer")
    func concurrentSubmitPromptClaimsComposerOnce() async throws {
        let store = ComposerStore()
        let submitter = PromptSubmitter()
        let open = AgentInteraction.OpenAgentComposer(store: store, clock: FixedClock())
        let submit = AgentInteraction.SubmitAgentPrompt(store: store, submitter: submitter, clock: FixedClock())
        _ = try await open.run(openInput(draft: "send once")).get()

        let results = await withTaskGroup(of: Result<AgentInteraction.SubmitAgentPromptResult, AgentInteraction.AgentInteractionError>.self) { group in
            group.addTask {
                await submit.run(.init(requestID: "submit-a", composerID: "composer-1", source: .test))
            }
            group.addTask {
                await submit.run(.init(requestID: "submit-b", composerID: "composer-1", source: .test))
            }

            var results: [Result<AgentInteraction.SubmitAgentPromptResult, AgentInteraction.AgentInteractionError>] = []
            for await result in group {
                results.append(result)
            }
            return results
        }

        #expect(results.filter(\.isSuccess).count == 1)
        #expect(results.filter { $0 == .failure(.alreadySubmitted) }.count == 1)
        #expect(await submitter.requests.count == 1)
    }

    @Test("CancelAgentPrompt is not overwritten by an in-flight successful submit")
    func cancelDuringSuccessfulSubmitKeepsComposerCancelled() async throws {
        let store = ComposerStore()
        let submitter = BlockingPromptSubmitter()
        let open = AgentInteraction.OpenAgentComposer(store: store, clock: FixedClock())
        let submit = AgentInteraction.SubmitAgentPrompt(store: store, submitter: submitter, clock: FixedClock())
        let cancel = AgentInteraction.CancelAgentPrompt(store: store, clock: FixedClock())
        _ = try await open.run(openInput(draft: "cancel while submitting")).get()

        let submitTask = Task {
            await submit.run(.init(requestID: "submit", composerID: "composer-1", source: .test))
        }
        await submitter.waitUntilReceived()
        let cancelled = try await cancel.run(.init(requestID: "cancel", composerID: "composer-1", source: .test)).get()
        await submitter.release()
        let submitResult = await submitTask.value

        #expect(cancelled.composer.status == .cancelled)
        #expect(submitResult == .failure(.alreadySubmitted))
        #expect(await store.loadStatus(composerID: "composer-1") == .cancelled)
        #expect(await submitter.requests.count == 1)
    }

    @Test("CancelAgentPrompt is not overwritten by an in-flight failed submit")
    func cancelDuringFailedSubmitKeepsComposerCancelled() async throws {
        let store = ComposerStore()
        let submitter = BlockingPromptSubmitter(result: .failure(TestError.failed))
        let open = AgentInteraction.OpenAgentComposer(store: store, clock: FixedClock())
        let submit = AgentInteraction.SubmitAgentPrompt(store: store, submitter: submitter, clock: FixedClock())
        let cancel = AgentInteraction.CancelAgentPrompt(store: store, clock: FixedClock())
        _ = try await open.run(openInput(draft: "cancel while failing")).get()

        let submitTask = Task {
            await submit.run(.init(requestID: "submit", composerID: "composer-1", source: .test))
        }
        await submitter.waitUntilReceived()
        let cancelled = try await cancel.run(.init(requestID: "cancel", composerID: "composer-1", source: .test)).get()
        await submitter.release()
        let submitResult = await submitTask.value

        #expect(cancelled.composer.status == .cancelled)
        #expect(submitResult == .failure(.submitFailed))
        #expect(await store.loadStatus(composerID: "composer-1") == .cancelled)
        #expect(await submitter.requests.count == 1)
    }

    @Test("CancelAgentPrompt marks an open composer cancelled")
    func cancelPromptMarksComposerCancelled() async throws {
        let store = ComposerStore()
        let open = AgentInteraction.OpenAgentComposer(store: store, clock: FixedClock())
        let cancel = AgentInteraction.CancelAgentPrompt(store: store, clock: FixedClock())
        _ = try await open.run(openInput(draft: "never mind")).get()

        let result = try await cancel.run(.init(requestID: "cancel", composerID: "composer-1", source: .test)).get()

        #expect(result.composer.status == .cancelled)
    }

    @Test("CancelAgentPrompt is not overwritten by an in-flight stale draft edit")
    func cancelDuringStaleDraftEditKeepsComposerCancelled() async throws {
        let store = StaleEditComposerStore()
        let open = AgentInteraction.OpenAgentComposer(store: store, clock: FixedClock())
        let edit = AgentInteraction.EditAgentPromptDraft(store: store, clock: FixedClock())
        let cancel = AgentInteraction.CancelAgentPrompt(store: store, clock: FixedClock())
        _ = try await open.run(openInput(draft: "original")).get()

        let editTask = Task {
            await edit.run(.init(requestID: "edit", composerID: "composer-1", draft: "stale edit", source: .test))
        }
        await store.waitUntilEditSnapshotLoaded()
        let cancelled = try await cancel.run(.init(requestID: "cancel", composerID: "composer-1", source: .test)).get()
        await store.releaseEdit()
        let editResult = await editTask.value

        #expect(cancelled.composer.status == .cancelled)
        #expect(editResult == .failure(.alreadySubmitted))
        #expect(await store.loadStatus(composerID: "composer-1") == .cancelled)
        #expect(await store.loadDraft(composerID: "composer-1") == "original")
    }

    @Test("AgentInteraction source does not write agent output into terminal panes")
    func agentInteractionDoesNotImportTerminalWritingPorts() throws {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources/FenrirNativeFoundation/Modules/AgentInteraction")
        let swiftFiles = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)?
            .compactMap { $0 as? URL }
            .filter { $0.pathExtension == "swift" } ?? []
        let source = try swiftFiles.map { try String(contentsOf: $0, encoding: .utf8) }.joined(separator: "\n")

        #expect(!source.contains("import TerminalViewport"))
        #expect(!source.contains("SendTerminalInput"))
        #expect(!source.contains("TerminalRuntimeWriting"))
        #expect(!source.contains("sendUserInput"))
        #expect(!source.contains("tmux.pane.write"))
    }

    @MainActor
    @Test("Agent composer modal shows provenance and truncation without context text")
    func composerModalShowsSafeContextSummary() {
        let composer = AgentInteraction.ComposerState(
            composerID: "composer-1",
            target: .init(workspaceID: "workspace-1", originatingPaneID: "pane-1", originatingViewportID: "viewport-1"),
            draft: "",
            attachments: [attachment(text: "secret terminal output")],
            updatedAt: FixedClock().now()
        )

        let view = AgentInteraction.AgentComposerModalView(composer: composer)

        #expect(view.provenanceText == "Selection from pane pane-1, viewport viewport-1")
        #expect(view.truncationText == "2 lines, 22 characters, truncated, 1 redactions")
        #expect(!view.displayedAttachmentText.contains("secret terminal output"))
    }

    @MainActor
    @Test("Agent composer modal emits submit, retry, and cancel commands")
    func composerModalLifecycleCommandsAreClear() {
        var submitCommands: [AgentInteraction.SubmitComposerDraftCommand] = []
        var cancelCommands: [AgentInteraction.CancelAgentComposerInput] = []
        let composer = AgentInteraction.ComposerState(
            composerID: "composer-1",
            target: .init(workspaceID: "workspace-1", originatingPaneID: "pane-1", originatingViewportID: "viewport-1"),
            draft: "initial",
            updatedAt: FixedClock().now()
        )
        let view = AgentInteraction.AgentComposerModalView(composer: composer)
        view.onSubmitDraft = { submitCommands.append($0) }
        view.onCancel = { cancelCommands.append($0) }

        view.setDraft(" revised prompt ")
        view.submit(requestID: "submit-1")
        view.updateComposer(composer, error: .submitFailed)
        view.retry(requestID: "retry-1")
        view.cancel(requestID: "cancel-1")

        #expect(submitCommands.map(\.edit.draft) == [" revised prompt ", " revised prompt "])
        #expect(submitCommands.map(\.submit.requestID) == ["submit-1", "retry-1"])
        #expect(cancelCommands.map(\.requestID) == ["cancel-1"])
    }

    @MainActor
    @Test("Agent composer modal does not submit empty drafts")
    func composerModalDoesNotSubmitEmptyDrafts() {
        var submitCommands: [AgentInteraction.SubmitComposerDraftCommand] = []
        let composer = AgentInteraction.ComposerState(
            composerID: "composer-1",
            target: .init(workspaceID: "workspace-1"),
            draft: "",
            updatedAt: FixedClock().now()
        )
        let view = AgentInteraction.AgentComposerModalView(composer: composer)
        view.onSubmitDraft = { submitCommands.append($0) }

        view.setDraft("   ")
        view.submit(requestID: "submit-empty")

        #expect(submitCommands.isEmpty)
    }
}

private func contextRequest(kind: AgentInteraction.ContextKind, limit: AgentInteraction.ContextLimit) -> AgentInteraction.TerminalContextRequest {
    AgentInteraction.TerminalContextRequest(
        requestID: "context-1",
        workspaceID: "workspace-1",
        viewportID: "viewport-1",
        paneID: "pane-1",
        kind: kind,
        limit: limit,
        source: .test
    )
}

private func openInput(draft: String = "") -> AgentInteraction.OpenAgentComposerInput {
    AgentInteraction.OpenAgentComposerInput(
        requestID: "open",
        composerID: "composer-1",
        target: AgentInteraction.TargetWorkspace(workspaceID: "workspace-1", originatingPaneID: "pane-1", originatingViewportID: "viewport-1"),
        draft: draft,
        source: .test
    )
}

private func attachment(text: String) -> AgentInteraction.TerminalContextAttachment {
    AgentInteraction.TerminalContextAttachment(
        attachmentID: "attachment-1",
        workspaceID: "workspace-1",
        viewportID: "viewport-1",
        paneID: "pane-1",
        kind: .selection,
        text: text,
        lineCount: 2,
        characterCount: text.count,
        isTruncated: true,
        redactionReport: .init(replacementCount: 1, labels: ["secret"]),
        capturedAt: FixedClock().now()
    )
}

private actor ContextCapturer: AgentInteraction.TerminalContextCapturing {
    let text: String
    let paneID: PaneID

    init(text: String, paneID: PaneID = "pane-1") {
        self.text = text
        self.paneID = paneID
    }

    func captureTerminalContext(_ request: AgentInteraction.TerminalContextRequest) async throws -> AgentInteraction.CapturedTerminalContext {
        AgentInteraction.CapturedTerminalContext(
            workspaceID: request.workspaceID,
            viewportID: request.viewportID,
            paneID: paneID,
            kind: request.kind,
            text: text
        )
    }
}

private struct ContextRedactor: AgentInteraction.TerminalContextRedacting {
    let replacements: [String: String]
    let labels: [String]

    init(replacements: [String: String] = [:], labels: [String] = []) {
        self.replacements = replacements
        self.labels = labels
    }

    func redactTerminalContext(_ context: AgentInteraction.CapturedTerminalContext) async throws -> AgentInteraction.RedactedTerminalContext {
        var text = context.text
        var count = 0
        for (needle, replacement) in replacements {
            let original = text
            text = text.replacingOccurrences(of: needle, with: replacement)
            if text != original {
                count += 1
            }
        }
        return AgentInteraction.RedactedTerminalContext(text: text, report: AgentInteraction.RedactionReport(replacementCount: count, labels: labels))
    }
}

private struct FailingRedactor: AgentInteraction.TerminalContextRedacting {
    func redactTerminalContext(_ context: AgentInteraction.CapturedTerminalContext) async throws -> AgentInteraction.RedactedTerminalContext {
        throw TestError.failed
    }
}

private actor EventCollector: AgentInteraction.AgentInteractionEventPublishing {
    private(set) var published: [EventEnvelope<AgentInteraction.Event>] = []

    func publish(_ event: EventEnvelope<AgentInteraction.Event>) async {
        published.append(event)
    }
}

private actor ComposerStore: AgentInteraction.AgentComposerStore {
    private var composers: [AgentInteraction.AgentComposerID: AgentInteraction.ComposerState] = [:]

    func openComposer(_ composer: AgentInteraction.ComposerState) async throws {
        composers[composer.composerID] = composer
    }

    func editComposerDraft(composerID: AgentInteraction.AgentComposerID, draft: String, updatedAt: FenrirTimestamp) async throws -> AgentInteraction.ComposerMutationResult {
        guard let composer = composers[composerID] else {
            return .notFound
        }
        guard composer.status == .open else {
            return .unavailableStatus(composer.status)
        }
        let edited = composer.updated(draft: draft, updatedAt: updatedAt)
        composers[composerID] = edited
        return .mutated(edited)
    }

    func cancelComposer(composerID: AgentInteraction.AgentComposerID, updatedAt: FenrirTimestamp) async throws -> AgentInteraction.ComposerMutationResult {
        guard let composer = composers[composerID] else {
            return .notFound
        }
        guard composer.status == .open || composer.status == .submitting else {
            return .unavailableStatus(composer.status)
        }
        let cancelled = composer.updated(status: .cancelled, updatedAt: updatedAt)
        composers[composerID] = cancelled
        return .mutated(cancelled)
    }

    func claimComposerForSubmit(composerID: AgentInteraction.AgentComposerID, updatedAt: FenrirTimestamp) async throws -> AgentInteraction.ComposerSubmitClaim {
        guard let composer = composers[composerID] else {
            return .notFound
        }
        guard composer.status == .open else {
            return .unavailableStatus(composer.status)
        }
        let claimed = AgentInteraction.ComposerState(
            composerID: composer.composerID,
            target: composer.target,
            draft: composer.draft,
            attachments: composer.attachments,
            status: .submitting,
            submittedPromptID: composer.submittedPromptID,
            updatedAt: updatedAt
        )
        composers[composerID] = claimed
        return .claimed(claimed)
    }

    func finalizeComposerSubmit(composerID: AgentInteraction.AgentComposerID, outcome: AgentInteraction.ComposerSubmitOutcome, updatedAt: FenrirTimestamp) async throws -> AgentInteraction.ComposerSubmitFinalization {
        guard let composer = composers[composerID] else {
            return .notFound
        }
        guard composer.status != .cancelled else {
            return .cancelled(composer)
        }
        guard composer.status == .submitting else {
            return .unavailableStatus(composer.status)
        }

        let nextStatus: AgentInteraction.ComposerStatus
        let submittedPromptID: RequestID?
        switch outcome {
        case let .submitted(promptID):
            nextStatus = .submitted
            submittedPromptID = promptID
        case .failed:
            nextStatus = .open
            submittedPromptID = composer.submittedPromptID
        }

        let finalized = AgentInteraction.ComposerState(
            composerID: composer.composerID,
            target: composer.target,
            draft: composer.draft,
            attachments: composer.attachments,
            status: nextStatus,
            submittedPromptID: submittedPromptID,
            updatedAt: updatedAt
        )
        composers[composerID] = finalized
        return .finalized(finalized)
    }

    func loadStatus(composerID: AgentInteraction.AgentComposerID) -> AgentInteraction.ComposerStatus? {
        composers[composerID]?.status
    }

    func loadDraft(composerID: AgentInteraction.AgentComposerID) -> String? {
        composers[composerID]?.draft
    }
}

private actor StaleEditComposerStore: AgentInteraction.AgentComposerStore {
    private var composers: [AgentInteraction.AgentComposerID: AgentInteraction.ComposerState] = [:]
    private var editSnapshotLoadedContinuation: CheckedContinuation<Void, Never>?
    private var editReleaseContinuation: CheckedContinuation<Void, Never>?
    private var didLoadEditSnapshot = false
    private var didReleaseEdit = false

    func openComposer(_ composer: AgentInteraction.ComposerState) async throws {
        composers[composer.composerID] = composer
    }

    func editComposerDraft(composerID: AgentInteraction.AgentComposerID, draft: String, updatedAt: FenrirTimestamp) async throws -> AgentInteraction.ComposerMutationResult {
        guard let snapshot = composers[composerID] else {
            return .notFound
        }
        guard snapshot.status == .open else {
            return .unavailableStatus(snapshot.status)
        }

        didLoadEditSnapshot = true
        editSnapshotLoadedContinuation?.resume()
        editSnapshotLoadedContinuation = nil

        if !didReleaseEdit {
            await withCheckedContinuation { continuation in
                editReleaseContinuation = continuation
            }
        }

        guard let current = composers[composerID] else {
            return .notFound
        }
        guard current.status == .open else {
            return .unavailableStatus(current.status)
        }

        let edited = current.updated(draft: draft, updatedAt: updatedAt)
        composers[composerID] = edited
        return .mutated(edited)
    }

    func cancelComposer(composerID: AgentInteraction.AgentComposerID, updatedAt: FenrirTimestamp) async throws -> AgentInteraction.ComposerMutationResult {
        guard let composer = composers[composerID] else {
            return .notFound
        }
        guard composer.status == .open || composer.status == .submitting else {
            return .unavailableStatus(composer.status)
        }
        let cancelled = composer.updated(status: .cancelled, updatedAt: updatedAt)
        composers[composerID] = cancelled
        return .mutated(cancelled)
    }

    func claimComposerForSubmit(composerID: AgentInteraction.AgentComposerID, updatedAt: FenrirTimestamp) async throws -> AgentInteraction.ComposerSubmitClaim {
        guard let composer = composers[composerID] else {
            return .notFound
        }
        guard composer.status == .open else {
            return .unavailableStatus(composer.status)
        }
        let claimed = composer.updated(status: .submitting, updatedAt: updatedAt)
        composers[composerID] = claimed
        return .claimed(claimed)
    }

    func finalizeComposerSubmit(composerID: AgentInteraction.AgentComposerID, outcome: AgentInteraction.ComposerSubmitOutcome, updatedAt: FenrirTimestamp) async throws -> AgentInteraction.ComposerSubmitFinalization {
        guard let composer = composers[composerID] else {
            return .notFound
        }
        guard composer.status != .cancelled else {
            return .cancelled(composer)
        }
        guard composer.status == .submitting else {
            return .unavailableStatus(composer.status)
        }

        let finalized: AgentInteraction.ComposerState
        switch outcome {
        case let .submitted(promptID):
            finalized = composer.updated(status: .submitted, submittedPromptID: promptID, updatedAt: updatedAt)
        case .failed:
            finalized = composer.updated(status: .open, updatedAt: updatedAt)
        }
        composers[composerID] = finalized
        return .finalized(finalized)
    }

    func waitUntilEditSnapshotLoaded() async {
        guard !didLoadEditSnapshot else {
            return
        }
        await withCheckedContinuation { continuation in
            editSnapshotLoadedContinuation = continuation
        }
    }

    func releaseEdit() {
        didReleaseEdit = true
        editReleaseContinuation?.resume()
        editReleaseContinuation = nil
    }

    func loadStatus(composerID: AgentInteraction.AgentComposerID) -> AgentInteraction.ComposerStatus? {
        composers[composerID]?.status
    }

    func loadDraft(composerID: AgentInteraction.AgentComposerID) -> String? {
        composers[composerID]?.draft
    }
}

private extension Result {
    var isSuccess: Bool {
        guard case .success = self else {
            return false
        }
        return true
    }
}

private actor PromptSubmitter: AgentInteraction.AgentPromptSubmitting {
    private let result: Result<AgentInteraction.ServerPromptAccepted, Error>
    private(set) var requests: [AgentInteraction.ServerPromptRequest] = []

    init(result: Result<AgentInteraction.ServerPromptAccepted, Error> = .success(AgentInteraction.ServerPromptAccepted(promptID: "server-prompt-1", acceptedAt: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000))))) {
        self.result = result
    }

    func submitAgentPrompt(_ request: AgentInteraction.ServerPromptRequest) async throws -> AgentInteraction.ServerPromptAccepted {
        requests.append(request)
        return try result.get()
    }
}

private actor BlockingPromptSubmitter: AgentInteraction.AgentPromptSubmitting {
    private let result: Result<AgentInteraction.ServerPromptAccepted, Error>
    private var receivedContinuation: CheckedContinuation<Void, Never>?
    private var releaseContinuation: CheckedContinuation<Void, Never>?
    private var didReceiveRequest = false
    private var didRelease = false
    private(set) var requests: [AgentInteraction.ServerPromptRequest] = []

    init(result: Result<AgentInteraction.ServerPromptAccepted, Error> = .success(AgentInteraction.ServerPromptAccepted(promptID: "server-prompt-1", acceptedAt: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_000))))) {
        self.result = result
    }

    func waitUntilReceived() async {
        guard !didReceiveRequest else {
            return
        }
        await withCheckedContinuation { continuation in
            receivedContinuation = continuation
        }
    }

    func release() {
        didRelease = true
        releaseContinuation?.resume()
        releaseContinuation = nil
    }

    func submitAgentPrompt(_ request: AgentInteraction.ServerPromptRequest) async throws -> AgentInteraction.ServerPromptAccepted {
        requests.append(request)
        didReceiveRequest = true
        receivedContinuation?.resume()
        receivedContinuation = nil
        if !didRelease {
            await withCheckedContinuation { continuation in
                releaseContinuation = continuation
            }
        }
        return try result.get()
    }
}

private enum TestError: Error {
    case failed
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
