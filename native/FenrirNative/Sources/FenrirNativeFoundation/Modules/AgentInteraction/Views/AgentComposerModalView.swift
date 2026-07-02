import AppKit
import FenrirNativeShared

public extension AgentInteraction {
    struct SubmitComposerDraftCommand: Equatable, Sendable {
        public let edit: EditAgentPromptDraftInput
        public let submit: SubmitAgentPromptInput

        public init(edit: EditAgentPromptDraftInput, submit: SubmitAgentPromptInput) {
            self.edit = edit
            self.submit = submit
        }
    }

    @MainActor
    final class AgentComposerModalView: NSView {
        public private(set) var composer: ComposerState
        public private(set) var lastError: AgentInteractionError?

        public var onSubmitDraft: ((SubmitComposerDraftCommand) -> Void)?
        public var onCancel: ((CancelAgentComposerInput) -> Void)?

        private let titleLabel = NSTextField(labelWithString: "Agent")
        private let provenanceLabel = NSTextField(labelWithString: "")
        private let truncationLabel = NSTextField(labelWithString: "")
        private let promptScrollView = NSScrollView()
        private let promptTextView = NSTextView()
        private let statusLabel = NSTextField(labelWithString: "")
        private let submitButton = NSButton(title: "Submit", target: nil, action: nil)
        private let retryButton = NSButton(title: "Retry", target: nil, action: nil)
        private let cancelButton = NSButton(title: "Cancel", target: nil, action: nil)

        public init(composer: ComposerState, frame frameRect: NSRect = .zero) {
            self.composer = composer
            super.init(frame: frameRect)
            build()
            render()
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) {
            fatalError("init(coder:) is not supported")
        }

        public func updateComposer(_ composer: ComposerState, error: AgentInteractionError? = nil) {
            self.composer = composer
            lastError = error
            if error == nil, promptTextView.string != composer.draft {
                promptTextView.string = composer.draft
            }
            render()
        }

        public func setDraft(_ draft: String) {
            promptTextView.string = draft
            renderButtons()
        }

        public func focusPrompt(in window: NSWindow?) {
            window?.makeFirstResponder(promptTextView)
        }

        public func submit(requestID: RequestID = .generated()) {
            guard canSubmit else {
                return
            }

            lastError = nil
            let draft = promptTextView.string
            onSubmitDraft?(SubmitComposerDraftCommand(
                edit: EditAgentPromptDraftInput(
                    requestID: RequestID(rawValue: "\(requestID.rawValue).edit"),
                    composerID: composer.composerID,
                    draft: draft,
                    source: .workspaceShell
                ),
                submit: SubmitAgentPromptInput(
                    requestID: requestID,
                    composerID: composer.composerID,
                    source: .workspaceShell
                )
            ))
        }

        public func retry(requestID: RequestID = .generated()) {
            guard lastError != nil else {
                return
            }
            submit(requestID: requestID)
        }

        public func cancel(requestID: RequestID = .generated()) {
            onCancel?(CancelAgentComposerInput(
                requestID: requestID,
                composerID: composer.composerID,
                source: .workspaceShell
            ))
        }

        public var provenanceText: String {
            guard !composer.attachments.isEmpty else {
                return "No terminal context attached"
            }

            return composer.attachments
                .map { attachment in
                    "\(attachment.kind.displayName) from pane \(attachment.paneID.rawValue), viewport \(attachment.viewportID.rawValue)"
                }
                .joined(separator: " | ")
        }

        public var truncationText: String {
            guard !composer.attachments.isEmpty else {
                return "0 lines, 0 characters"
            }

            let lines = composer.attachments.reduce(0) { $0 + $1.lineCount }
            let characters = composer.attachments.reduce(0) { $0 + $1.characterCount }
            let truncated = composer.attachments.contains { $0.isTruncated } ? "truncated" : "not truncated"
            let redactions = composer.attachments.reduce(0) { $0 + $1.redactionReport.replacementCount }
            return "\(lines) lines, \(characters) characters, \(truncated), \(redactions) redactions"
        }

        public var displayedAttachmentText: String {
            "\(provenanceLabel.stringValue)\n\(truncationLabel.stringValue)"
        }

        private var canSubmit: Bool {
            composer.status == .open && !promptTextView.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }

        private func build() {
            wantsLayer = true
            layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

            let root = NSStackView()
            root.orientation = .vertical
            root.alignment = .leading
            root.distribution = .fill
            root.spacing = 10
            root.edgeInsets = NSEdgeInsets(top: 14, left: 14, bottom: 14, right: 14)
            root.translatesAutoresizingMaskIntoConstraints = false
            addSubview(root)

            titleLabel.font = .boldSystemFont(ofSize: 15)
            titleLabel.lineBreakMode = .byTruncatingTail

            for label in [provenanceLabel, truncationLabel, statusLabel] {
                label.lineBreakMode = .byTruncatingTail
                label.maximumNumberOfLines = 1
                label.textColor = .secondaryLabelColor
            }

            promptScrollView.hasVerticalScroller = true
            promptScrollView.borderType = .bezelBorder
            promptScrollView.translatesAutoresizingMaskIntoConstraints = false
            promptTextView.minSize = NSSize(width: 0, height: 100)
            promptTextView.isRichText = false
            promptTextView.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
            promptTextView.string = composer.draft
            promptScrollView.documentView = promptTextView

            let buttonRow = NSStackView(views: [statusLabel, retryButton, cancelButton, submitButton])
            buttonRow.orientation = .horizontal
            buttonRow.alignment = .centerY
            buttonRow.distribution = .fill
            buttonRow.spacing = 8

            submitButton.target = self
            submitButton.action = #selector(submitFromButton)
            retryButton.target = self
            retryButton.action = #selector(retryFromButton)
            cancelButton.target = self
            cancelButton.action = #selector(cancelFromButton)

            root.addArrangedSubview(titleLabel)
            root.addArrangedSubview(provenanceLabel)
            root.addArrangedSubview(truncationLabel)
            root.addArrangedSubview(promptScrollView)
            root.addArrangedSubview(buttonRow)

            NSLayoutConstraint.activate([
                root.leadingAnchor.constraint(equalTo: leadingAnchor),
                root.trailingAnchor.constraint(equalTo: trailingAnchor),
                root.topAnchor.constraint(equalTo: topAnchor),
                root.bottomAnchor.constraint(equalTo: bottomAnchor),
                promptScrollView.widthAnchor.constraint(equalTo: root.widthAnchor, constant: -28),
                promptScrollView.heightAnchor.constraint(greaterThanOrEqualToConstant: 120)
            ])
        }

        private func render() {
            provenanceLabel.stringValue = provenanceText
            truncationLabel.stringValue = truncationText
            statusLabel.stringValue = statusText
            renderButtons()
        }

        private func renderButtons() {
            submitButton.isEnabled = canSubmit
            retryButton.isHidden = lastError == nil
            retryButton.isEnabled = canSubmit && lastError != nil
            cancelButton.isEnabled = composer.status == .open || composer.status == .submitting
        }

        private var statusText: String {
            if let lastError {
                return "Failed: \(lastError.rawValue)"
            }

            switch composer.status {
            case .open:
                return "Ready"
            case .submitting:
                return "Submitting"
            case .submitted:
                return "Submitted"
            case .cancelled:
                return "Cancelled"
            }
        }

        @objc private func submitFromButton() {
            submit()
        }

        @objc private func retryFromButton() {
            retry()
        }

        @objc private func cancelFromButton() {
            cancel()
        }
    }
}

private extension AgentInteraction.ContextKind {
    var displayName: String {
        switch self {
        case .selection:
            return "Selection"
        case .viewport:
            return "Viewport"
        case .lastLines:
            return "Last lines"
        }
    }
}
