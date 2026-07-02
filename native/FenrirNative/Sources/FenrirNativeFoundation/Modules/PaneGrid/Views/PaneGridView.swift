import AppKit
import FenrirNativeShared
import TerminalViewport

public extension PaneGrid {
    typealias TerminalViewFactory = @MainActor (PanePresentation) -> FenrirTerminalView

    @MainActor
    final class AppKitPaneGridView: NSView {
        public private(set) var state: State
        public var onFocusPane: ((PaneKernelTarget) -> Void)?
        public var onSelectWindow: ((SelectTabWindowCommand) -> Void)?
        public var onResizePane: ((PaneResizeAllocation) -> Void)?
        public var onResizePaneToSize: ((PaneKernelTarget, TerminalViewport.Size) -> Void)?

        private let terminalFactory: TerminalViewFactory
        private var terminalViewsByViewportID: [ViewportID: FenrirTerminalView] = [:]
        private var paneViewsByPaneID: [PaneID: PaneView] = [:]
        private let rootStack = NSStackView()
        private let tabBar = NSStackView()
        private let contentHost = NSView()

        public init(state: State, terminalFactory: @escaping TerminalViewFactory, frame frameRect: NSRect = .zero) {
            self.state = state
            self.terminalFactory = terminalFactory
            super.init(frame: frameRect)
            buildChrome()
            rebuild()
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) {
            fatalError("init(coder:) is not supported")
        }

        public func apply(_ nextState: State) {
            state = nextState
            rebuild()
        }

        public func renderedPaneIDs() -> [PaneID] {
            paneViewsByPaneID.keys.sorted { $0.rawValue < $1.rawValue }
        }

        public func renderedTmuxPaneIDs() -> [String] {
            activeWindow?.panes.map(\.tmuxPaneID.rawValue) ?? []
        }

        public func renderedViewportIDs() -> [ViewportID] {
            paneViewsByPaneID.values.map { $0.viewportID }.sorted { $0.rawValue < $1.rawValue }
        }

        public func renderedSplitFractions() -> [[Double]] {
            contentHost.subviews.flatMap { view in
                view.collectSplitFractions()
            }
        }

        public func focusedTerminalView() -> FenrirTerminalView? {
            guard let activeWindow else {
                return nil
            }
            return paneViewsByPaneID[activeWindow.activePaneID]?.terminalView
        }

        public func terminalView(viewportID: ViewportID) -> FenrirTerminalView? {
            terminalViewsByViewportID[viewportID]
        }

        public func restoreFocusedPane() {
            guard let activeWindow else {
                return
            }
            updateTerminalFocus(focusedPaneID: activeWindow.activePaneID)
        }

        @discardableResult
        public func focusPane(_ paneID: PaneID) -> Bool {
            guard let target = target(for: paneID) else {
                return false
            }
            onFocusPane?(target)
            updateTerminalFocus(focusedPaneID: paneID)
            return true
        }

        @discardableResult
        public func moveFocus(_ direction: FocusDirection) -> Bool {
            guard let activeWindow,
                  let target = activeWindow.focusTarget(direction: direction)
            else {
                return false
            }
            return focusPane(target.to)
        }

        @discardableResult
        public func selectWindow(_ windowID: FenrirWindowID, requestID: RequestID = "appkit-pane-grid-select") -> Bool {
            guard let window = state.windows.first(where: { $0.windowID == windowID }) else {
                return false
            }
            onSelectWindow?(SelectTabWindowCommand(
                requestID: requestID,
                workspaceID: state.workspaceID,
                windowID: window.windowID,
                tmuxWindowID: window.tmuxWindowID,
                source: .nativeHost
            ))
            return true
        }

        @discardableResult
        public func requestResizeFocusedPane(
            delta: Int,
            unit: ResizeUnit = .pixels,
            direction: FocusDirection = .right
        ) -> PaneResizeAllocation? {
            guard delta != 0, let activeWindow else {
                return nil
            }
            let allocation = PaneResizeAllocation(
                paneID: activeWindow.activePaneID,
                delta: delta,
                unit: unit,
                direction: direction
            )
            onResizePane?(allocation)
            return allocation
        }

        private var activeWindow: WindowPresentation? {
            state.windows.first { $0.windowID == state.activeWindowID }
        }

        private func buildChrome() {
            wantsLayer = true
            layer?.backgroundColor = NSColor.black.cgColor

            rootStack.orientation = .vertical
            rootStack.alignment = .leading
            rootStack.distribution = .fill
            rootStack.spacing = 0
            rootStack.translatesAutoresizingMaskIntoConstraints = false
            addSubview(rootStack)

            tabBar.orientation = .horizontal
            tabBar.alignment = .centerY
            tabBar.distribution = .fill
            tabBar.spacing = 4
            tabBar.edgeInsets = NSEdgeInsets(top: 6, left: 8, bottom: 6, right: 8)
            tabBar.translatesAutoresizingMaskIntoConstraints = false
            contentHost.translatesAutoresizingMaskIntoConstraints = false

            rootStack.addArrangedSubview(tabBar)
            rootStack.addArrangedSubview(contentHost)

            NSLayoutConstraint.activate([
                rootStack.leadingAnchor.constraint(equalTo: leadingAnchor),
                rootStack.trailingAnchor.constraint(equalTo: trailingAnchor),
                rootStack.topAnchor.constraint(equalTo: topAnchor),
                rootStack.bottomAnchor.constraint(equalTo: bottomAnchor),
                tabBar.heightAnchor.constraint(equalToConstant: 38),
                contentHost.widthAnchor.constraint(equalTo: rootStack.widthAnchor)
            ])
        }

        private func rebuild() {
            disposeStaleTerminalViews()
            tabBar.arrangedSubviews.forEach {
                tabBar.removeArrangedSubview($0)
                $0.removeFromSuperview()
            }
            contentHost.subviews.forEach { $0.removeFromSuperview() }
            paneViewsByPaneID.removeAll()

            for window in state.windows.sorted(by: { $0.index == $1.index ? $0.windowID.rawValue < $1.windowID.rawValue : $0.index < $1.index }) {
                tabBar.addArrangedSubview(tabButton(for: window))
            }

            guard let activeWindow else {
                return
            }
            let rendered = render(activeWindow.root)
            rendered.translatesAutoresizingMaskIntoConstraints = false
            contentHost.addSubview(rendered)
            NSLayoutConstraint.activate([
                rendered.leadingAnchor.constraint(equalTo: contentHost.leadingAnchor),
                rendered.trailingAnchor.constraint(equalTo: contentHost.trailingAnchor),
                rendered.topAnchor.constraint(equalTo: contentHost.topAnchor),
                rendered.bottomAnchor.constraint(equalTo: contentHost.bottomAnchor)
            ])
            updateTerminalFocus(focusedPaneID: activeWindow.activePaneID)
        }

        private func tabButton(for window: WindowPresentation) -> NSButton {
            let title = "\(window.index + 1) \(window.title)"
            let button = NSButton(title: title, target: self, action: #selector(selectTabFromButton(_:)))
            button.identifier = NSUserInterfaceItemIdentifier(window.windowID.rawValue)
            button.bezelStyle = window.windowID == state.activeWindowID ? .rounded : .texturedRounded
            button.lineBreakMode = .byTruncatingTail
            button.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
            button.widthAnchor.constraint(greaterThanOrEqualToConstant: 72).isActive = true
            button.widthAnchor.constraint(lessThanOrEqualToConstant: 180).isActive = true
            return button
        }

        @objc private func selectTabFromButton(_ sender: NSButton) {
            guard let rawValue = sender.identifier?.rawValue else {
                return
            }
            _ = selectWindow(FenrirWindowID(rawValue: rawValue))
        }

        private func render(_ node: LayoutNode) -> NSView {
            switch node {
            case let .pane(pane):
                return paneView(for: pane)
            case let .split(axis, children):
                let split = ProportionalPaneSplitView(
                    axis: axis,
                    fractions: PaneGrid.splitFractions(for: children, axis: axis)
                )
                split.isVertical = axis == .horizontal
                split.dividerStyle = .thin
                split.translatesAutoresizingMaskIntoConstraints = false
                split.postsFrameChangedNotifications = true
                for child in children {
                    let childView = render(child)
                    childView.translatesAutoresizingMaskIntoConstraints = false
                    split.addArrangedSubview(childView)
                }
                split.installFractionConstraints()
                return split
            }
        }

        private func paneView(for pane: PanePresentation) -> PaneView {
            let terminal = terminalView(for: pane)
            let view = PaneView(pane: pane, terminalView: terminal)
            view.onFocusRequested = { [weak self] paneID in
                _ = self?.focusPane(paneID)
            }
            view.onResizeMeasured = { [weak self] paneID, size in
                guard let target = self?.target(for: paneID) else {
                    return
                }
                self?.onResizePaneToSize?(target, size)
            }
            paneViewsByPaneID[pane.paneID] = view
            return view
        }

        private func terminalView(for pane: PanePresentation) -> FenrirTerminalView {
            if let existing = terminalViewsByViewportID[pane.viewportID] {
                return existing
            }
            let terminal = terminalFactory(pane)
            terminalViewsByViewportID[pane.viewportID] = terminal
            return terminal
        }

        private func disposeStaleTerminalViews() {
            let activeViewportIDs = Set(activeWindow?.panes.map(\.viewportID) ?? [])
            for viewportID in Array(terminalViewsByViewportID.keys) where !activeViewportIDs.contains(viewportID) {
                terminalViewsByViewportID.removeValue(forKey: viewportID)?.dispose()
            }
        }

        private func updateTerminalFocus(focusedPaneID: PaneID) {
            for (paneID, paneView) in paneViewsByPaneID {
                let isFocused = paneID == focusedPaneID
                paneView.setPaneFocused(isFocused)
                paneView.terminalView.setTerminalFocused(isFocused)
                if isFocused {
                    window?.makeFirstResponder(paneView.terminalView)
                }
            }
        }

        private func target(for paneID: PaneID) -> PaneKernelTarget? {
            guard let window = activeWindow, let pane = window.panes.first(where: { $0.paneID == paneID }) else {
                return nil
            }
            return PaneKernelTarget(
                workspaceID: state.workspaceID,
                windowID: window.windowID,
                tmuxWindowID: window.tmuxWindowID,
                paneID: pane.paneID,
                tmuxPaneID: pane.tmuxPaneID
            )
        }
    }
}

@MainActor
private final class PaneView: NSView {
    let terminalView: FenrirTerminalView
    let viewportID: ViewportID
    var onFocusRequested: ((PaneID) -> Void)?
    var onResizeMeasured: ((PaneID, TerminalViewport.Size) -> Void)?

    private let paneID: PaneID
    private let title = NSTextField(labelWithString: "")
    private var lastTerminalSize: TerminalViewport.Size?

    init(pane: PaneGrid.PanePresentation, terminalView: FenrirTerminalView) {
        self.paneID = pane.paneID
        self.viewportID = pane.viewportID
        self.terminalView = terminalView
        super.init(frame: .zero)
        build(pane)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override var acceptsFirstResponder: Bool { true }

    override func mouseDown(with event: NSEvent) {
        onFocusRequested?(paneID)
        super.mouseDown(with: event)
    }

    override func layout() {
        super.layout()
        resizeTerminalForCurrentBounds()
    }

    func setPaneFocused(_ focused: Bool) {
        layer?.borderWidth = focused ? 2 : 1
        layer?.borderColor = focused
            ? NSColor.keyboardFocusIndicatorColor.cgColor
            : NSColor.separatorColor.cgColor
    }

    private func resizeTerminalForCurrentBounds() {
        let pixelWidth = Int(terminalView.bounds.width.rounded(.down))
        let pixelHeight = Int(terminalView.bounds.height.rounded(.down))
        guard pixelWidth > 0, pixelHeight > 0 else {
            return
        }
        let size = TerminalViewport.Size(
            columns: max(1, pixelWidth / 8),
            rows: max(1, pixelHeight / 16),
            pixelWidth: pixelWidth,
            pixelHeight: pixelHeight
        )
        guard size != lastTerminalSize else {
            return
        }
        lastTerminalSize = size
        try? terminalView.resizeTerminal(to: size)
        onResizeMeasured?(paneID, size)
    }

    private func build(_ pane: PaneGrid.PanePresentation) {
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        setPaneFocused(pane.isFocused)

        let header = NSView()
        header.wantsLayer = true
        header.layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
        header.translatesAutoresizingMaskIntoConstraints = false

        title.stringValue = pane.title ?? pane.tmuxPaneID.rawValue
        title.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        title.lineBreakMode = .byTruncatingMiddle
        title.textColor = .secondaryLabelColor
        title.translatesAutoresizingMaskIntoConstraints = false

        terminalView.translatesAutoresizingMaskIntoConstraints = false

        addSubview(header)
        header.addSubview(title)
        addSubview(terminalView)

        NSLayoutConstraint.activate([
            header.leadingAnchor.constraint(equalTo: leadingAnchor),
            header.trailingAnchor.constraint(equalTo: trailingAnchor),
            header.topAnchor.constraint(equalTo: topAnchor),
            header.heightAnchor.constraint(equalToConstant: 22),

            title.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 8),
            title.trailingAnchor.constraint(lessThanOrEqualTo: header.trailingAnchor, constant: -8),
            title.centerYAnchor.constraint(equalTo: header.centerYAnchor),

            terminalView.leadingAnchor.constraint(equalTo: leadingAnchor),
            terminalView.trailingAnchor.constraint(equalTo: trailingAnchor),
            terminalView.topAnchor.constraint(equalTo: header.bottomAnchor),
            terminalView.bottomAnchor.constraint(equalTo: bottomAnchor),

            widthAnchor.constraint(greaterThanOrEqualToConstant: 160),
            heightAnchor.constraint(greaterThanOrEqualToConstant: 120)
        ])
    }
}

@MainActor
private final class ProportionalPaneSplitView: NSSplitView {
    let fractions: [Double]
    private var fractionConstraints: [NSLayoutConstraint] = []

    init(axis: PaneGrid.SplitAxis, fractions: [Double]) {
        self.fractions = fractions
        super.init(frame: .zero)
        isVertical = axis == .horizontal
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func installFractionConstraints() {
        guard arrangedSubviews.count == fractions.count, fractions.count > 1 else {
            return
        }
        NSLayoutConstraint.deactivate(fractionConstraints)
        fractionConstraints = zip(arrangedSubviews, fractions).map { view, fraction in
            let constraint = isVertical
                ? view.widthAnchor.constraint(equalTo: widthAnchor, multiplier: fraction)
                : view.heightAnchor.constraint(equalTo: heightAnchor, multiplier: fraction)
            constraint.priority = .defaultHigh
            return constraint
        }
        NSLayoutConstraint.activate(fractionConstraints)
    }
}

private extension NSView {
    @MainActor
    func collectSplitFractions() -> [[Double]] {
        let current = (self as? ProportionalPaneSplitView).map { [$0.fractions] } ?? []
        return current + subviews.flatMap { $0.collectSplitFractions() }
    }
}

private extension PaneGrid {
    static func splitFractions(for children: [LayoutNode], axis: SplitAxis) -> [Double] {
        let spans = children.map { max(1, span(of: $0, axis: axis)) }
        let total = spans.reduce(0, +)
        guard total > 0 else {
            return Array(repeating: 1.0 / Double(children.count), count: children.count)
        }
        return spans.map { Double($0) / Double(total) }
    }

    static func span(of node: LayoutNode, axis: SplitAxis) -> Int {
        let panes = panes(in: node)
        let starts = panes.map { axis == .horizontal ? $0.rect.x : $0.rect.y }
        let ends = panes.map { pane in
            axis == .horizontal ? pane.rect.x + pane.rect.columns : pane.rect.y + pane.rect.rows
        }
        guard let minStart = starts.min(), let maxEnd = ends.max() else {
            return 1
        }
        return max(1, maxEnd - minStart)
    }

    static func panes(in node: LayoutNode) -> [PanePresentation] {
        switch node {
        case let .pane(pane):
            return [pane]
        case let .split(_, children):
            return children.flatMap { panes(in: $0) }
        }
    }
}
