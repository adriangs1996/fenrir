import AppKit
import FenrirNativeShared
import TerminalViewport

public extension PaneGrid {
    typealias TerminalViewFactory = @MainActor (PanePresentation) -> FenrirTerminalView

    /// Design tokens for the pane grid chrome. The shell owns theme resolution
    /// (D-041): every color rendered by the grid must come through this style
    /// so no surface hardcodes a color.
    struct PaneGridStyle: Sendable {
        public let background: NSColor
        public let paneBackground: NSColor
        public let paneHeaderBackground: NSColor
        public let paneBorder: NSColor
        public let focusedPaneBorder: NSColor
        /// D-045 attention ring: panes whose agent presence is awaiting input
        /// draw this border (attention slot of the shell theme tokens).
        public let attentionPaneBorder: NSColor
        public let headerPrimaryText: NSColor
        public let headerSecondaryText: NSColor
        public let tabText: NSColor
        public let activeTabText: NSColor
        public let activeTabUnderline: NSColor

        public init(
            background: NSColor,
            paneBackground: NSColor,
            paneHeaderBackground: NSColor,
            paneBorder: NSColor,
            focusedPaneBorder: NSColor,
            attentionPaneBorder: NSColor? = nil,
            headerPrimaryText: NSColor,
            headerSecondaryText: NSColor,
            tabText: NSColor,
            activeTabText: NSColor,
            activeTabUnderline: NSColor
        ) {
            self.background = background
            self.paneBackground = paneBackground
            self.paneHeaderBackground = paneHeaderBackground
            self.paneBorder = paneBorder
            self.focusedPaneBorder = focusedPaneBorder
            self.attentionPaneBorder = attentionPaneBorder ?? focusedPaneBorder
            self.headerPrimaryText = headerPrimaryText
            self.headerSecondaryText = headerSecondaryText
            self.tabText = tabText
            self.activeTabText = activeTabText
            self.activeTabUnderline = activeTabUnderline
        }

        /// Token-definition fallback used only by tests and previews. The live
        /// app never renders this style: the composition root
        /// (FenrirNativeApp/main.swift) always injects a PaneGridStyle resolved
        /// from NativeShellThemeTokens (D-041). System semantic colors are used
        /// here so the fallback adapts to either appearance; defining them in
        /// this token set does not violate the "no hardcoded colors in
        /// surfaces" rule because PaneGridStyle IS the token set.
        public static let system = PaneGridStyle(
            background: .black,
            paneBackground: .black,
            paneHeaderBackground: .controlBackgroundColor,
            paneBorder: .separatorColor,
            focusedPaneBorder: .keyboardFocusIndicatorColor,
            attentionPaneBorder: .systemOrange,
            headerPrimaryText: .labelColor,
            headerSecondaryText: .secondaryLabelColor,
            tabText: .secondaryLabelColor,
            activeTabText: .labelColor,
            activeTabUnderline: .controlAccentColor
        )
    }

    @MainActor
    final class AppKitPaneGridView: NSView {
        public private(set) var state: State
        public var onFocusPane: ((PaneKernelTarget) -> Void)?
        public var onSelectWindow: ((SelectTabWindowCommand) -> Void)?
        public var onResizePane: ((PaneResizeAllocation) -> Void)?
        public var onResizePaneToSize: ((PaneKernelTarget, TerminalViewport.Size) -> Void)?

        private let terminalFactory: TerminalViewFactory
        private let style: PaneGridStyle
        private let showsWindowTabBar: Bool
        private var terminalViewsByViewportID: [ViewportID: FenrirTerminalView] = [:]
        private var paneViewsByPaneID: [PaneID: PaneView] = [:]
        private var attentionPaneIDs: Set<PaneID> = []
        private let rootStack = NSStackView()
        private let tabBar = NSStackView()
        private let contentHost = NSView()

        public init(
            state: State,
            style: PaneGridStyle = .system,
            showsWindowTabBar: Bool = true,
            terminalFactory: @escaping TerminalViewFactory,
            frame frameRect: NSRect = .zero
        ) {
            self.state = state
            self.style = style
            self.showsWindowTabBar = showsWindowTabBar
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

        /// D-045 attention ring: marks the given panes as awaiting input.
        /// Driven exclusively by agent presence records (D-038); the grid
        /// never derives attention from pane content.
        public func applyAttentionPaneIDs(_ paneIDs: Set<PaneID>) {
            guard paneIDs != attentionPaneIDs else {
                return
            }
            attentionPaneIDs = paneIDs
            for (paneID, paneView) in paneViewsByPaneID {
                paneView.setPaneAttention(paneIDs.contains(paneID))
            }
        }

        public func renderedAttentionPaneIDs() -> [PaneID] {
            attentionPaneIDs.sorted { $0.rawValue < $1.rawValue }
                .filter { paneViewsByPaneID[$0] != nil }
        }

        /// Border state actually applied to a rendered pane's backing layer.
        /// Lets tests assert that focus and attention compose (D-045) instead
        /// of one signal replacing the other.
        public struct PaneBorderRendering: Equatable, Sendable {
            public enum ColorRole: Equatable, Sendable {
                case standard
                case focused
                case attention
            }

            public let colorRole: ColorRole
            public let borderWidth: CGFloat
            public let isFocused: Bool
            public let hasAttention: Bool

            public init(colorRole: ColorRole, borderWidth: CGFloat, isFocused: Bool, hasAttention: Bool) {
                self.colorRole = colorRole
                self.borderWidth = borderWidth
                self.isFocused = isFocused
                self.hasAttention = hasAttention
            }
        }

        public func paneBorderRendering(_ paneID: PaneID) -> PaneBorderRendering? {
            paneViewsByPaneID[paneID]?.borderRendering()
        }

        public func renderedFocusedPaneIDs() -> [PaneID] {
            paneViewsByPaneID
                .filter { $0.value.borderRendering().isFocused }
                .keys
                .sorted { $0.rawValue < $1.rawValue }
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
            layer?.backgroundColor = style.background.cgColor

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
            tabBar.isHidden = !showsWindowTabBar
            contentHost.translatesAutoresizingMaskIntoConstraints = false

            rootStack.addArrangedSubview(tabBar)
            rootStack.addArrangedSubview(contentHost)

            var constraints = [
                rootStack.leadingAnchor.constraint(equalTo: leadingAnchor),
                rootStack.trailingAnchor.constraint(equalTo: trailingAnchor),
                rootStack.topAnchor.constraint(equalTo: topAnchor),
                rootStack.bottomAnchor.constraint(equalTo: bottomAnchor),
                contentHost.widthAnchor.constraint(equalTo: rootStack.widthAnchor)
            ]
            if showsWindowTabBar {
                constraints.append(tabBar.heightAnchor.constraint(equalToConstant: 38))
            }
            NSLayoutConstraint.activate(constraints)
        }

        private func rebuild() {
            disposeStaleTerminalViews()
            tabBar.arrangedSubviews.forEach {
                tabBar.removeArrangedSubview($0)
                $0.removeFromSuperview()
            }
            contentHost.subviews.forEach { $0.removeFromSuperview() }
            paneViewsByPaneID.removeAll()

            if showsWindowTabBar {
                for window in state.windows.sorted(by: { $0.index == $1.index ? $0.windowID.rawValue < $1.windowID.rawValue : $0.index < $1.index }) {
                    tabBar.addArrangedSubview(tabButton(for: window))
                }
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
            let isActive = window.windowID == state.activeWindowID
            let button = NSButton(title: title, target: self, action: #selector(selectTabFromButton(_:)))
            button.identifier = NSUserInterfaceItemIdentifier(window.windowID.rawValue)
            button.isBordered = false
            button.attributedTitle = NSAttributedString(
                string: title,
                attributes: [
                    .font: NSFont.monospacedSystemFont(ofSize: 11.5, weight: .regular),
                    .foregroundColor: isActive ? style.activeTabText : style.tabText,
                    .underlineStyle: isActive ? NSUnderlineStyle.single.rawValue : 0,
                    .underlineColor: style.activeTabUnderline
                ]
            )
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
                    fractions: PaneGrid.splitFractions(for: children, axis: axis),
                    dividerFill: style.background
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
            let view = PaneView(pane: pane, terminalView: terminal, style: style)
            view.setPaneAttention(attentionPaneIDs.contains(pane.paneID))
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
                // setTerminalFocused(true) hands first responder to the
                // backend's input view; making the container view first
                // responder instead would swallow keystrokes.
                paneView.terminalView.setTerminalFocused(isFocused)
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
    private let style: PaneGrid.PaneGridStyle
    private let title = NSTextField(labelWithString: "")
    private let paneLocation = NSTextField(labelWithString: "")
    private var lastTerminalSize: TerminalViewport.Size?
    private var isPaneFocused = false
    private var hasPaneAttention = false

    init(pane: PaneGrid.PanePresentation, terminalView: FenrirTerminalView, style: PaneGrid.PaneGridStyle = .system) {
        self.paneID = pane.paneID
        self.viewportID = pane.viewportID
        self.terminalView = terminalView
        self.style = style
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
        isPaneFocused = focused
        applyBorder()
    }

    /// D-045 attention ring: attention (awaiting-input presence) composes with
    /// focus instead of replacing it. See applyBorder() for the composition.
    func setPaneAttention(_ attention: Bool) {
        hasPaneAttention = attention
        applyBorder()
    }

    /// Border composition (D-045): attention always wins the border COLOR so a
    /// waiting pane stays visible across the whole grid, while focus stays
    /// legible through border WIDTH — the focused pane is always the thick one,
    /// with or without attention.
    private func applyBorder() {
        layer?.borderWidth = isPaneFocused ? 2 : 1
        if hasPaneAttention {
            layer?.borderColor = style.attentionPaneBorder.cgColor
            return
        }
        layer?.borderColor = isPaneFocused
            ? style.focusedPaneBorder.cgColor
            : style.paneBorder.cgColor
    }

    /// Test/diagnostics introspection of the border actually applied to the
    /// backing layer (not just the stored flags).
    func borderRendering() -> PaneGrid.AppKitPaneGridView.PaneBorderRendering {
        let colorRole: PaneGrid.AppKitPaneGridView.PaneBorderRendering.ColorRole
        if layer?.borderColor == style.attentionPaneBorder.cgColor {
            colorRole = .attention
        } else if layer?.borderColor == style.focusedPaneBorder.cgColor {
            colorRole = .focused
        } else {
            colorRole = .standard
        }
        return PaneGrid.AppKitPaneGridView.PaneBorderRendering(
            colorRole: colorRole,
            borderWidth: layer?.borderWidth ?? 0,
            isFocused: isPaneFocused,
            hasAttention: hasPaneAttention
        )
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
        layer?.backgroundColor = style.paneBackground.cgColor
        layer?.cornerRadius = 6
        layer?.masksToBounds = true
        setPaneFocused(pane.isFocused)

        let header = NSView()
        header.wantsLayer = true
        header.layer?.backgroundColor = style.paneHeaderBackground.cgColor
        header.translatesAutoresizingMaskIntoConstraints = false

        let headerDivider = NSView()
        headerDivider.wantsLayer = true
        headerDivider.layer?.backgroundColor = style.paneBorder.cgColor
        headerDivider.translatesAutoresizingMaskIntoConstraints = false

        title.stringValue = pane.title ?? pane.tmuxPaneID.rawValue
        title.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .medium)
        title.lineBreakMode = .byTruncatingMiddle
        title.textColor = style.headerPrimaryText
        title.translatesAutoresizingMaskIntoConstraints = false

        paneLocation.stringValue = pane.tmuxPaneID.rawValue
        paneLocation.font = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
        paneLocation.lineBreakMode = .byTruncatingTail
        paneLocation.textColor = style.headerSecondaryText
        paneLocation.translatesAutoresizingMaskIntoConstraints = false

        terminalView.translatesAutoresizingMaskIntoConstraints = false

        addSubview(header)
        header.addSubview(title)
        header.addSubview(paneLocation)
        header.addSubview(headerDivider)
        addSubview(terminalView)

        NSLayoutConstraint.activate([
            header.leadingAnchor.constraint(equalTo: leadingAnchor),
            header.trailingAnchor.constraint(equalTo: trailingAnchor),
            header.topAnchor.constraint(equalTo: topAnchor),
            header.heightAnchor.constraint(equalToConstant: 24),

            title.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 10),
            title.trailingAnchor.constraint(lessThanOrEqualTo: paneLocation.leadingAnchor, constant: -10),
            title.centerYAnchor.constraint(equalTo: header.centerYAnchor),

            paneLocation.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -10),
            paneLocation.centerYAnchor.constraint(equalTo: header.centerYAnchor),

            headerDivider.leadingAnchor.constraint(equalTo: header.leadingAnchor),
            headerDivider.trailingAnchor.constraint(equalTo: header.trailingAnchor),
            headerDivider.bottomAnchor.constraint(equalTo: header.bottomAnchor),
            headerDivider.heightAnchor.constraint(equalToConstant: 1),

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
    private let dividerFill: NSColor
    private var fractionConstraints: [NSLayoutConstraint] = []

    init(axis: PaneGrid.SplitAxis, fractions: [Double], dividerFill: NSColor = .black) {
        self.fractions = fractions
        self.dividerFill = dividerFill
        super.init(frame: .zero)
        isVertical = axis == .horizontal
    }

    override var dividerColor: NSColor {
        dividerFill
    }

    override var dividerThickness: CGFloat {
        6
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
