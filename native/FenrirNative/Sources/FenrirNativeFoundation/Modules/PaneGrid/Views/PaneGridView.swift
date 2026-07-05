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
        /// Explicit resize GESTURE (D-028 `C-s C-h`): adjusts ONE pane's split
        /// ratio via `resize-pane`. This is the only per-pane resize path.
        public var onResizePane: ((PaneResizeAllocation) -> Void)?
        /// Classic tmux client model: the client reports ONE overall viewport
        /// size for the whole pane area and tmux lays the panes out (D-011).
        /// Fires whenever the pane-host region is laid out; the grid never
        /// pushes auto-measured PER-PANE sizes back to the server (that
        /// non-idempotent echo made panes shrink on focus moves and blocked
        /// splitting the same direction twice). Server-assigned `pane.rect`
        /// cols/rows drive each surface's grid instead.
        public var onReportWindowSize: ((TerminalViewport.Size) -> Void)?

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

        /// Native pane chrome that is NOT terminal cells: the 24pt pane header
        /// and the 6pt split divider. Subtracted from the pane-host region so
        /// the reported cell count matches what tmux should allocate.
        private static let paneHeaderHeight: CGFloat = 24
        private static let paneDividerThickness: CGFloat = 6
        /// Monospace cell estimate (points) used only before any surface has
        /// reported a real grid, so the first viewport report is still sane.
        private static let fallbackCellSize = CGSize(width: 8, height: 18)

        override public func layout() {
            super.layout()
            reportWindowSizeIfPossible()
        }

        /// Whole-viewport size the client announces to tmux (classic client
        /// model, D-011): the pane-host content region converted to cells with
        /// the live ghostty cell metrics, minus the native chrome. Depends only
        /// on the host bounds, the cell size and the rendered layout's SHAPE
        /// (header/divider counts) — never on the tmux-assigned pane cell sizes
        /// — so re-measuring after a server snapshot yields the same number and
        /// the round-trip is idempotent (no geometry drift). The chrome inset
        /// scales with the actual layout: every pane owns a 24pt header and each
        /// split inserts a 6pt divider, so an N-deep vertical stack steals
        /// N headers — subtracting a single fixed header would over-report rows
        /// and clip the bottom of each stacked pane.
        public func measuredViewportSize() -> TerminalViewport.Size? {
            let bounds = contentHost.bounds
            guard bounds.width > 0, bounds.height > 0 else {
                return nil
            }
            let cell = cellSizeInPoints()
            let chrome = PaneGrid.viewportChromeInsets(
                for: activeWindow?.root,
                headerHeight: Self.paneHeaderHeight,
                dividerThickness: Self.paneDividerThickness
            )
            let usableWidth = bounds.width - chrome.horizontal
            let usableHeight = bounds.height - chrome.vertical
            guard usableWidth > 0, usableHeight > 0, cell.width > 0, cell.height > 0 else {
                return nil
            }
            return TerminalViewport.Size(
                columns: max(1, Int((usableWidth / cell.width).rounded(.down))),
                rows: max(1, Int((usableHeight / cell.height).rounded(.down))),
                pixelWidth: max(1, Int(bounds.width.rounded())),
                pixelHeight: max(1, Int(bounds.height.rounded()))
            )
        }

        private func reportWindowSizeIfPossible() {
            guard let onReportWindowSize, let size = measuredViewportSize() else {
                return
            }
            onReportWindowSize(size)
        }

        /// Point size of one terminal cell. Prefers the renderer's exact cell
        /// metrics (pixels ÷ backing scale) from ANY live surface — the
        /// estimate must be identical across layout passes or the deduped
        /// whole-viewport report flaps and round-trips resize-window forever.
        /// Only when NO surface has reported metrics yet does it fall back to
        /// dividing a surface's bounds by its grid (lossy: folds padding,
        /// sub-cell remainder, and mid-rebuild transients in), then to a
        /// monospace estimate before the first ghostty resize lands.
        private func cellSizeInPoints() -> CGSize {
            let scale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
            if scale > 0 {
                for paneView in paneViewsByPaneID.values {
                    if let cell = paneView.terminalView.lastReportedCellPixelSize {
                        return CGSize(width: cell.width / scale, height: cell.height / scale)
                    }
                }
            }
            for paneView in paneViewsByPaneID.values {
                let surface = paneView.terminalView
                guard let reported = surface.lastReportedSurfaceSize,
                      reported.columns > 0, reported.rows > 0,
                      surface.bounds.width > 0, surface.bounds.height > 0
                else {
                    continue
                }
                return CGSize(
                    width: surface.bounds.width / CGFloat(reported.columns),
                    height: surface.bounds.height / CGFloat(reported.rows)
                )
            }
            return Self.fallbackCellSize
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

    private let paneID: PaneID
    /// Server-assigned tmux pane geometry (cells). Drives the surface grid
    /// size so the client renders each pane at the size tmux allocated,
    /// instead of pushing an AppKit-measured size back to the server.
    private let rect: PaneGrid.PaneRect
    private let style: PaneGrid.PaneGridStyle
    private let title = NSTextField(labelWithString: "")
    private let paneLocation = NSTextField(labelWithString: "")
    private var lastTerminalSize: TerminalViewport.Size?
    private var isPaneFocused = false
    private var hasPaneAttention = false

    init(pane: PaneGrid.PanePresentation, terminalView: FenrirTerminalView, style: PaneGrid.PaneGridStyle = .system) {
        self.paneID = pane.paneID
        self.viewportID = pane.viewportID
        self.rect = pane.rect
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

    /// Sizes the local terminal SURFACE so it renders, driving the grid
    /// (columns/rows) from the SERVER-assigned `rect` — never a lossy
    /// AppKit pixel measurement — while the pixel extents track the actual
    /// (server-driven, proportional) AppKit bounds. Emits NO per-pane resize
    /// back to the server: tmux owns pane layout (D-011/D-019); the client
    /// reports only the whole viewport via `onReportWindowSize`.
    private func resizeTerminalForCurrentBounds() {
        let pixelWidth = Int(terminalView.bounds.width.rounded(.down))
        let pixelHeight = Int(terminalView.bounds.height.rounded(.down))
        guard pixelWidth > 0, pixelHeight > 0 else {
            return
        }
        let size = TerminalViewport.Size(
            columns: max(1, rect.columns),
            rows: max(1, rect.rows),
            pixelWidth: pixelWidth,
            pixelHeight: pixelHeight
        )
        guard size != lastTerminalSize else {
            return
        }
        lastTerminalSize = size
        try? terminalView.resizeTerminal(to: size)
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

public extension PaneGrid {
    /// Native pane chrome (points) that is NOT terminal cells and therefore
    /// must be subtracted from the pane-host region before converting to the
    /// whole-viewport cell count reported to tmux (D-011 classic client model).
    struct ViewportChromeInsets: Equatable, Sendable {
        /// Chrome stealing horizontal space (vertical split dividers).
        public let horizontal: CGFloat
        /// Chrome stealing vertical space (per-pane headers + horizontal
        /// split dividers stacked along the tallest column).
        public let vertical: CGFloat

        public init(horizontal: CGFloat, vertical: CGFloat) {
            self.horizontal = horizontal
            self.vertical = vertical
        }
    }

    /// Worst-case chrome inset for the rendered layout `root`. Every leaf pane
    /// carries its own `headerHeight` header and each split inserts one
    /// `dividerThickness` divider between adjacent siblings, so the chrome that
    /// steals cells scales with HOW the panes are stacked — not a single fixed
    /// header+divider. A vertical stack accumulates its children's vertical
    /// chrome plus the dividers between them; across sibling columns/rows the
    /// MAX is taken on the cross axis so the single reported viewport stays
    /// conservative: a less-subdivided column is only ever under-allocated
    /// (safe — wastes a cell), never over-allocated (which clips the bottom row
    /// / trailing column of a pane off-screen). `nil` root (no active window)
    /// is treated as a single pane: one header, no divider.
    static func viewportChromeInsets(
        for root: LayoutNode?,
        headerHeight: CGFloat,
        dividerThickness: CGFloat
    ) -> ViewportChromeInsets {
        guard let root else {
            return ViewportChromeInsets(horizontal: 0, vertical: headerHeight)
        }
        let insets = chromeInsets(root, headerHeight: headerHeight, dividerThickness: dividerThickness)
        return ViewportChromeInsets(horizontal: insets.horizontal, vertical: insets.vertical)
    }

    private static func chromeInsets(
        _ node: LayoutNode,
        headerHeight: CGFloat,
        dividerThickness: CGFloat
    ) -> (horizontal: CGFloat, vertical: CGFloat) {
        switch node {
        case .pane:
            // Each pane renders a 24pt header above its terminal surface; no
            // horizontal (side) chrome.
            return (horizontal: 0, vertical: headerHeight)
        case let .split(axis, children):
            guard !children.isEmpty else {
                return (horizontal: 0, vertical: headerHeight)
            }
            let childInsets = children.map {
                chromeInsets($0, headerHeight: headerHeight, dividerThickness: dividerThickness)
            }
            let dividerTotal = dividerThickness * CGFloat(children.count - 1)
            switch axis {
            case .vertical:
                // Children stack top-to-bottom: their vertical chrome (headers
                // + nested dividers) accumulates, plus the dividers between
                // them; horizontal chrome is the worst sibling's.
                let vertical = childInsets.map(\.vertical).reduce(0, +) + dividerTotal
                let horizontal = childInsets.map(\.horizontal).max() ?? 0
                return (horizontal: horizontal, vertical: vertical)
            case .horizontal:
                // Children sit side-by-side: their horizontal chrome accumulates
                // plus the dividers between them; vertical chrome is the tallest
                // column's (a deeper vertical stack elsewhere must still fit).
                let horizontal = childInsets.map(\.horizontal).reduce(0, +) + dividerTotal
                let vertical = childInsets.map(\.vertical).max() ?? 0
                return (horizontal: horizontal, vertical: vertical)
            }
        }
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
