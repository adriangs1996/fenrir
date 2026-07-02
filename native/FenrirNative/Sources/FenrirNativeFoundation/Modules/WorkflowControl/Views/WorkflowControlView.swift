import AppKit
import Foundation
import FenrirNativeShared

public extension WorkflowControl {
    struct WorkflowViewCommand: Equatable, Sendable {
        public enum Kind: Equatable, Sendable {
            case refreshRuns
            case observeTimeline(runID: WorkflowRunID, afterSequence: Int?)
            case pause(runID: WorkflowRunID)
            case stop(runID: WorkflowRunID)
            case rerun(runID: WorkflowRunID)
            case respond(runID: WorkflowRunID, inputRequestID: WorkflowInputRequestID, response: WorkflowJSONValue)
        }

        public let requestID: RequestID
        public let kind: Kind

        public init(requestID: RequestID = .generated(), kind: Kind) {
            self.requestID = requestID
            self.kind = kind
        }
    }

    @MainActor
    final class WorkflowControlView: NSView {
        public static let maxVisibleRuns = 50
        public static let maxVisibleDetailRows = 100
        public static let maxVisibleInputRequests = 25
        public static let maxVisibleTimelineEvents = 100

        public private(set) var runs: [WorkflowRunSnapshot]
        public private(set) var selectedRunID: WorkflowRunID?
        public private(set) var timeline: WorkflowRunTimeline?
        public private(set) var lastError: WorkflowControlError?
        public var supportsPauseControl: Bool

        public var onCommand: ((WorkflowViewCommand) -> Void)?

        private let titleLabel = NSTextField(labelWithString: "Workflows")
        private let summaryLabel = NSTextField(labelWithString: "")
        private let refreshButton = NSButton(title: "Refresh", target: nil, action: nil)
        private let pauseButton = NSButton(title: "Pause", target: nil, action: nil)
        private let stopButton = NSButton(title: "Stop", target: nil, action: nil)
        private let rerunButton = NSButton(title: "Rerun", target: nil, action: nil)
        private let runsStack = NSStackView()
        private let detailStack = NSStackView()
        private let timelineStack = NSStackView()
        private let inputStack = NSStackView()
        private let statusLabel = NSTextField(labelWithString: "")

        public init(
            runs: [WorkflowRunSnapshot] = [],
            selectedRunID: WorkflowRunID? = nil,
            timeline: WorkflowRunTimeline? = nil,
            supportsPauseControl: Bool = false,
            frame frameRect: NSRect = .zero
        ) {
            self.runs = WorkflowControl.visibleRuns(runs, filter: .init())
            self.selectedRunID = selectedRunID ?? self.runs.first?.runID
            self.timeline = timeline
            self.supportsPauseControl = supportsPauseControl
            super.init(frame: frameRect)
            build()
            render()
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) {
            fatalError("init(coder:) is not supported")
        }

        public var selectedRun: WorkflowRunSnapshot? {
            guard let selectedRunID else {
                return runs.first
            }
            return runs.first { $0.runID == selectedRunID }
        }

        public var selectedTimelineEvents: [WorkflowTimelineEvent] {
            guard timeline?.runID == selectedRun?.runID else {
                return []
            }
            return timeline?.events ?? []
        }

        public var pendingInputRequests: [WorkflowInputRequestSnapshot] {
            runs.flatMap { run in
                run.inputRequests.filter { $0.status == .pending && !$0.runID.rawValue.isEmpty }
            }
        }

        public var isPauseControlEnabled: Bool {
            pauseButton.isEnabled
        }

        public func applyRuns(_ runs: [WorkflowRunSnapshot], selectedRunID: WorkflowRunID? = nil) {
            self.runs = WorkflowControl.visibleRuns(runs, filter: .init())
            self.selectedRunID = selectedRunID ?? selectedRunIDForRefresh(previous: self.selectedRunID, runs: self.runs)
            lastError = nil
            render()
        }

        public func applyTimeline(_ timeline: WorkflowRunTimeline) {
            self.timeline = timeline
            selectedRunID = timeline.runID
            lastError = nil
            render()
        }

        public func applyCommandResult(_ run: WorkflowRunSnapshot) {
            if let index = runs.firstIndex(where: { $0.runID == run.runID }) {
                runs[index] = run
            } else {
                runs.insert(run, at: 0)
            }
            runs = WorkflowControl.visibleRuns(runs, filter: .init())
            selectedRunID = run.runID
            lastError = nil
            render()
        }

        public func applyError(_ error: WorkflowControlError) {
            lastError = error
            render()
        }

        public func refresh(requestID: RequestID = .generated()) {
            onCommand?(WorkflowViewCommand(requestID: requestID, kind: .refreshRuns))
        }

        public func observeSelectedTimeline(requestID: RequestID = .generated()) {
            guard let runID = selectedRun?.runID else {
                return
            }
            onCommand?(WorkflowViewCommand(
                requestID: requestID,
                kind: .observeTimeline(runID: runID, afterSequence: timeline?.nextSequence.map { $0 - 1 })
            ))
        }

        private func build() {
            wantsLayer = true
            layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor

            let root = NSStackView()
            root.orientation = .vertical
            root.alignment = .leading
            root.spacing = 10
            root.edgeInsets = NSEdgeInsets(top: 14, left: 14, bottom: 14, right: 14)
            root.translatesAutoresizingMaskIntoConstraints = false
            addSubview(root)

            titleLabel.font = .boldSystemFont(ofSize: 15)
            summaryLabel.textColor = .secondaryLabelColor
            statusLabel.textColor = .secondaryLabelColor

            let buttonRow = NSStackView(views: [refreshButton, pauseButton, stopButton, rerunButton])
            buttonRow.orientation = .horizontal
            buttonRow.spacing = 8

            for stack in [runsStack, detailStack, inputStack, timelineStack] {
                stack.orientation = .vertical
                stack.alignment = .leading
                stack.spacing = 6
            }

            refreshButton.target = self
            refreshButton.action = #selector(refreshFromButton)
            pauseButton.target = self
            pauseButton.action = #selector(pauseFromButton)
            stopButton.target = self
            stopButton.action = #selector(stopFromButton)
            rerunButton.target = self
            rerunButton.action = #selector(rerunFromButton)

            root.addArrangedSubview(titleLabel)
            root.addArrangedSubview(summaryLabel)
            root.addArrangedSubview(buttonRow)
            root.addArrangedSubview(statusLabel)
            root.addArrangedSubview(sectionTitle("Runs"))
            root.addArrangedSubview(runsStack)
            root.addArrangedSubview(sectionTitle("Selected Run"))
            root.addArrangedSubview(detailStack)
            root.addArrangedSubview(sectionTitle("Needs Input"))
            root.addArrangedSubview(inputStack)
            root.addArrangedSubview(sectionTitle("Timeline"))
            root.addArrangedSubview(timelineStack)

            NSLayoutConstraint.activate([
                root.leadingAnchor.constraint(equalTo: leadingAnchor),
                root.trailingAnchor.constraint(equalTo: trailingAnchor),
                root.topAnchor.constraint(equalTo: topAnchor),
                root.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor)
            ])
        }

        private func render() {
            summaryLabel.stringValue = summaryText
            statusLabel.stringValue = lastError.map { "Workflow action failed: \($0)" } ?? statusText
            renderButtons()
            renderRuns()
            renderDetail()
            renderInputs()
            renderTimeline()
        }

        private func renderButtons() {
            let status = selectedRun?.status
            refreshButton.isEnabled = true
            pauseButton.isEnabled = supportsPauseControl && (status == .queued || status == .running)
            stopButton.isEnabled = status.map { !$0.isTerminal } ?? false
            rerunButton.isEnabled = status?.isTerminal ?? false
        }

        private func renderRuns() {
            let visibleRuns = Array(runs.prefix(Self.maxVisibleRuns))
            let overflow = runs.count - visibleRuns.count
            var rows: [NSView] = visibleRuns.map { run in
                let selectedPrefix = run.runID == selectedRunID ? "* " : ""
                let button = NSButton(title: "\(selectedPrefix)\(run.name)  \(run.status.rawValue)", target: self, action: #selector(selectRunFromButton(_:)))
                button.identifier = NSUserInterfaceItemIdentifier("workflow-run-\(run.runID.rawValue)")
                button.bezelStyle = .inline
                button.alignment = .left
                return button
            }
            if overflow > 0 {
                rows.append(emptyLabel("Showing \(visibleRuns.count) of \(runs.count) runs"))
            }
            runsStack.replaceArrangedSubviews(with: rows.isEmpty ? [emptyLabel("No workflow runs")] : rows)
        }

        private func renderDetail() {
            guard let run = selectedRun else {
                detailStack.replaceArrangedSubviews(with: [emptyLabel("No run selected")])
                return
            }

            var rows: [NSView] = [
                line("Status", run.status.rawValue),
                line("Run", run.runID.rawValue),
                line("Workflow", run.workflowID.rawValue),
                line("Started", WorkflowControl.format(run.startedAt)),
                line("Updated", WorkflowControl.format(run.lastUpdatedAt)),
                line("Steps", "\(run.steps.count)"),
                line("Agents", "\(run.agents.count)"),
                line("Tasks", "\(run.tasks.count)")
            ]
            let dynamicRows: [NSView] =
                run.steps.map { line("Step", "\($0.name) \($0.status)") } +
                run.agents.map { line("Agent", "\($0.name) \($0.status)") } +
                run.tasks.map { line("Task", "\($0.title) \($0.status)") }
            rows.append(contentsOf: dynamicRows.prefix(Self.maxVisibleDetailRows))
            if dynamicRows.count > Self.maxVisibleDetailRows {
                rows.append(emptyLabel("Showing \(Self.maxVisibleDetailRows) of \(dynamicRows.count) detail rows"))
            }
            detailStack.replaceArrangedSubviews(with: rows)
        }

        private func renderInputs() {
            let inputs = pendingInputRequests
            let visibleInputs = Array(inputs.prefix(Self.maxVisibleInputRequests))
            var rows: [NSView] = visibleInputs.map { request in
                let response = NSTextField(string: "")
                response.placeholderString = "Response or JSON"
                response.identifier = NSUserInterfaceItemIdentifier("workflow-input-response-\(request.requestID.rawValue)")
                let button = NSButton(title: "Respond", target: self, action: #selector(respondFromButton(_:)))
                button.identifier = NSUserInterfaceItemIdentifier("workflow-input-\(request.runID.rawValue)::\(request.requestID.rawValue)")
                let row = NSStackView(views: [line("Input", request.title), response, button])
                row.orientation = .vertical
                row.alignment = .leading
                row.spacing = 4
                return row
            }
            if inputs.count > visibleInputs.count {
                rows.append(emptyLabel("Showing \(visibleInputs.count) of \(inputs.count) pending inputs"))
            }
            inputStack.replaceArrangedSubviews(with: rows.isEmpty ? [emptyLabel("No pending input")] : rows)
        }

        private func renderTimeline() {
            let events = selectedTimelineEvents
            let visibleEvents = Array(events.suffix(Self.maxVisibleTimelineEvents))
            var rows: [NSView] = visibleEvents.map { event in
                line("#\(event.sequence)", "\(event.title)  \(WorkflowControl.format(event.createdAt))")
            }
            if events.count > visibleEvents.count {
                rows.insert(emptyLabel("Showing latest \(visibleEvents.count) of \(events.count) timeline events"), at: 0)
            }
            timelineStack.replaceArrangedSubviews(with: rows.isEmpty ? [emptyLabel("No timeline events loaded")] : rows)
        }

        private var summaryText: String {
            let active = runs.filter { !$0.status.isTerminal }.count
            let pending = pendingInputRequests.count
            return "\(runs.count) runs, \(active) active, \(pending) input"
        }

        private var statusText: String {
            guard let timeline, timeline.runID == selectedRunID else {
                return "Server-owned workflow execution"
            }
            if timeline.replayIncludesHistoricalEvents {
                return "Timeline replayed from start"
            }
            return "Timeline replayed after sequence \(timeline.replayedFromSequence ?? 0)"
        }

        @objc private func refreshFromButton() {
            refresh()
        }

        @objc private func pauseFromButton() {
            guard pauseButton.isEnabled, let runID = selectedRun?.runID else { return }
            onCommand?(WorkflowViewCommand(kind: .pause(runID: runID)))
        }

        @objc private func stopFromButton() {
            guard let runID = selectedRun?.runID else { return }
            onCommand?(WorkflowViewCommand(kind: .stop(runID: runID)))
        }

        @objc private func rerunFromButton() {
            guard let runID = selectedRun?.runID else { return }
            onCommand?(WorkflowViewCommand(kind: .rerun(runID: runID)))
        }

        @objc private func selectRunFromButton(_ sender: NSButton) {
            guard let raw = sender.identifier?.rawValue.removingPrefix("workflow-run-") else {
                return
            }
            let runID = WorkflowRunID(rawValue: raw)
            selectedRunID = runID
            render()
            onCommand?(WorkflowViewCommand(kind: .observeTimeline(runID: runID, afterSequence: nil)))
        }

        @objc private func respondFromButton(_ sender: NSButton) {
            guard let raw = sender.identifier?.rawValue.removingPrefix("workflow-input-") else {
                return
            }
            let parts = raw.components(separatedBy: "::")
            guard parts.count == 2,
                  let textField = sender.superview?.subviews.compactMap({ $0 as? NSTextField }).first(where: { $0.isEditable })
            else {
                return
            }
            onCommand?(WorkflowViewCommand(kind: .respond(
                runID: WorkflowRunID(rawValue: parts[0]),
                inputRequestID: WorkflowInputRequestID(rawValue: parts[1]),
                response: WorkflowControl.jsonValue(fromUserInput: textField.stringValue)
            )))
        }

        private func selectedRunIDForRefresh(previous: WorkflowRunID?, runs: [WorkflowRunSnapshot]) -> WorkflowRunID? {
            if let previous, runs.contains(where: { $0.runID == previous }) {
                return previous
            }
            return runs.first?.runID
        }

        private func sectionTitle(_ text: String) -> NSTextField {
            let label = NSTextField(labelWithString: text)
            label.font = .systemFont(ofSize: 11, weight: .semibold)
            label.textColor = .secondaryLabelColor
            return label
        }

        private func emptyLabel(_ text: String) -> NSTextField {
            let label = NSTextField(labelWithString: text)
            label.textColor = .tertiaryLabelColor
            return label
        }

        private func line(_ title: String, _ value: String) -> NSTextField {
            let label = NSTextField(labelWithString: "\(title): \(value)")
            label.lineBreakMode = .byTruncatingTail
            label.maximumNumberOfLines = 1
            return label
        }
    }

    static func jsonValue(fromUserInput input: String) -> WorkflowJSONValue {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .string("")
        }
        guard let data = trimmed.data(using: .utf8),
              let value = try? JSONDecoder().decode(WorkflowJSONValue.self, from: data)
        else {
            return .string(input)
        }
        return value
    }

    static func format(_ timestamp: FenrirTimestamp) -> String {
        let formatter = ISO8601DateFormatter()
        return formatter.string(from: timestamp.date)
    }
}

private extension NSStackView {
    func replaceArrangedSubviews(with views: [NSView]) {
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
    func removingPrefix(_ prefix: String) -> String? {
        guard hasPrefix(prefix) else {
            return nil
        }
        return String(dropFirst(prefix.count))
    }
}
