import AppKit
import FenrirNativeShared

public extension AgentIntegration {
    @MainActor
    final class AgentIntegrationPanelView: NSView {
        public private(set) var state: AgentIntegrationPanelState
        public var onCommand: ((AgentIntegrationViewCommand) -> Void)?

        private let titleLabel = NSTextField(labelWithString: "Agent Integrations")
        private let summaryLabel = NSTextField(labelWithString: "")
        private let refreshButton = NSButton(title: "Refresh", target: nil, action: nil)
        private let rowsStack = NSStackView()

        public init(state: AgentIntegrationPanelState, frame frameRect: NSRect = .zero) {
            self.state = state
            super.init(frame: frameRect)
            build()
            render()
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) {
            fatalError("init(coder:) is not supported")
        }

        public var visibleRowTexts: [String] {
            state.rowTexts
        }

        public var visibleSummaryText: String {
            state.summaryText
        }

        public func apply(_ state: AgentIntegrationPanelState) {
            self.state = state
            render()
        }

        public func refresh(requestID: RequestID = .generated()) {
            onCommand?(AgentIntegrationViewCommand(
                requestID: requestID,
                source: .workspaceShell,
                kind: .refresh
            ))
        }

        public func repair(agentID: AgentCLIIdentifier, requestID: RequestID = .generated()) {
            onCommand?(AgentIntegrationViewCommand(
                requestID: requestID,
                source: .workspaceShell,
                kind: .repair(agentID: agentID)
            ))
        }

        public func remove(agentID: AgentCLIIdentifier, requestID: RequestID = .generated()) {
            onCommand?(AgentIntegrationViewCommand(
                requestID: requestID,
                source: .workspaceShell,
                kind: .remove(agentID: agentID)
            ))
        }

        private func build() {
            wantsLayer = true
            layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

            let root = NSStackView()
            root.orientation = .vertical
            root.alignment = .leading
            root.spacing = 8
            root.edgeInsets = NSEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
            root.translatesAutoresizingMaskIntoConstraints = false
            addSubview(root)

            titleLabel.font = .boldSystemFont(ofSize: 15)
            titleLabel.lineBreakMode = .byTruncatingTail

            summaryLabel.textColor = .secondaryLabelColor
            summaryLabel.lineBreakMode = .byTruncatingTail
            summaryLabel.maximumNumberOfLines = 1

            refreshButton.target = self
            refreshButton.action = #selector(refreshFromButton)

            rowsStack.orientation = .vertical
            rowsStack.alignment = .leading
            rowsStack.spacing = 6

            root.addArrangedSubview(titleLabel)
            root.addArrangedSubview(summaryLabel)
            root.addArrangedSubview(refreshButton)
            root.addArrangedSubview(rowsStack)

            NSLayoutConstraint.activate([
                root.leadingAnchor.constraint(equalTo: leadingAnchor),
                root.trailingAnchor.constraint(equalTo: trailingAnchor),
                root.topAnchor.constraint(equalTo: topAnchor),
                root.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor)
            ])
        }

        private func render() {
            summaryLabel.stringValue = state.summaryText

            let degradedAgentIDs = Set(state.degradedStatuses.map(\.agent.id))
            let rows = zip(state.statuses, state.rowTexts).map { status, rowText in
                row(status: status, text: rowText, isDegraded: degradedAgentIDs.contains(status.agent.id))
            }
            rowsStack.replaceAgentIntegrationArrangedSubviews(with: rows.isEmpty ? [emptyLabel("No agents checked")] : rows)
        }

        private func row(status: AgentIntegrationStatus, text: String, isDegraded: Bool) -> NSView {
            let label = NSTextField(labelWithString: text)
            label.lineBreakMode = .byTruncatingTail
            label.maximumNumberOfLines = 1
            label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

            guard isDegraded else {
                return label
            }

            let repairButton = NSButton(title: "Repair", target: self, action: #selector(repairFromButton(_:)))
            repairButton.identifier = buttonIdentifier(prefix: "agent-integration-repair", agentID: status.agent.id)

            let removeButton = NSButton(title: "Remove", target: self, action: #selector(removeFromButton(_:)))
            removeButton.identifier = buttonIdentifier(prefix: "agent-integration-remove", agentID: status.agent.id)

            let row = NSStackView(views: [label, repairButton, removeButton])
            row.orientation = .horizontal
            row.alignment = .centerY
            row.spacing = 6
            return row
        }

        private func emptyLabel(_ text: String) -> NSTextField {
            let label = NSTextField(labelWithString: text)
            label.textColor = .tertiaryLabelColor
            return label
        }

        private func buttonIdentifier(prefix: String, agentID: AgentCLIIdentifier) -> NSUserInterfaceItemIdentifier {
            NSUserInterfaceItemIdentifier("\(prefix)-\(agentID.rawValue)")
        }

        private func agentID(from sender: NSButton, prefix: String) -> AgentCLIIdentifier? {
            guard let rawValue = sender.identifier?.rawValue.removingAgentIntegrationPrefix("\(prefix)-") else {
                return nil
            }
            return AgentCLIIdentifier(rawValue: rawValue)
        }

        @objc private func refreshFromButton() {
            refresh()
        }

        @objc private func repairFromButton(_ sender: NSButton) {
            guard let agentID = agentID(from: sender, prefix: "agent-integration-repair") else {
                return
            }
            repair(agentID: agentID)
        }

        @objc private func removeFromButton(_ sender: NSButton) {
            guard let agentID = agentID(from: sender, prefix: "agent-integration-remove") else {
                return
            }
            remove(agentID: agentID)
        }
    }
}

private extension NSStackView {
    func replaceAgentIntegrationArrangedSubviews(with views: [NSView]) {
        for view in arrangedSubviews {
            removeArrangedSubview(view)
            view.removeFromSuperview()
        }
        for view in views {
            addArrangedSubview(view)
        }
    }
}

private extension String {
    func removingAgentIntegrationPrefix(_ prefix: String) -> String? {
        guard hasPrefix(prefix) else {
            return nil
        }
        return String(dropFirst(prefix.count))
    }
}
