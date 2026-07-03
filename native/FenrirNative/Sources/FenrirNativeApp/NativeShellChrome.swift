import AppKit
import AgentIntegration
import FenrirNativeShared
import PaneGrid
import Settings
import WorkflowControl
import WorkspaceIndex

// D-041 shell chrome (docs/native-terminal-ui-shell.html): operations-deck
// titlebar with quiet tmux tabs and health, stream-health status bar, and the
// operational workspace-tree sidebar. Every color flows through
// NativeShellThemeTokens; no surface hardcodes a color.

enum NativeShellChromeMetrics {
    static let titlebarHeight: CGFloat = 40
    static let statusBarHeight: CGFloat = 26
    static let sidebarWidth: CGFloat = 264
    static let trafficLightInset: CGFloat = 84
}

struct NativeShellHealthSummary: Equatable {
    var serverText: String
    var isServerHealthy: Bool
    var attentionText: String?

    init(serverText: String, isServerHealthy: Bool, attentionText: String? = nil) {
        self.serverText = serverText
        self.isServerHealthy = isServerHealthy
        self.attentionText = attentionText
    }
}

@MainActor
final class NativeShellTitlebarView: NSView {
    let themeTokens: NativeShellThemeTokens
    var onToggleSidebar: (() -> Void)?
    var onSelectWindow: ((FenrirWindowID) -> Void)?

    private let tabStack = NSStackView()
    private let toggleButton = NSButton(title: "", target: nil, action: nil)
    private let serverLabel = NSTextField(labelWithString: "")
    private let attentionLabel = NSTextField(labelWithString: "")
    private let bottomHairline = NSView()

    init(themeTokens: NativeShellThemeTokens) {
        self.themeTokens = themeTokens
        super.init(frame: .zero)
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func apply(
        windows: [PaneGrid.WindowPresentation],
        activeWindowID: FenrirWindowID,
        agentPresenceRecords: [AgentIntegration.AgentPresenceRecord] = [],
        health: NativeShellHealthSummary
    ) {
        tabStack.arrangedSubviews.forEach {
            tabStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        let ordered = windows.sorted {
            $0.index == $1.index ? $0.windowID.rawValue < $1.windowID.rawValue : $0.index < $1.index
        }
        for window in ordered {
            tabStack.addArrangedSubview(tabView(
                for: window,
                isActive: window.windowID == activeWindowID,
                presence: tabPresence(for: window, records: agentPresenceRecords)
            ))
        }
        serverLabel.attributedStringValue = Self.dotPrefixed(
            text: health.serverText,
            dotColor: health.isServerHealthy ? themeTokens.okBadge : themeTokens.failureBadge,
            textColor: themeTokens.tertiaryText
        )
        attentionLabel.isHidden = health.attentionText == nil
        attentionLabel.stringValue = health.attentionText.map { "◉ \($0)" } ?? ""
    }

    static func dotPrefixed(text: String, dotColor: NSColor, textColor: NSColor) -> NSAttributedString {
        let value = NSMutableAttributedString(
            string: "● ",
            attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 8, weight: .regular),
                .foregroundColor: dotColor,
                .baselineOffset: 1
            ]
        )
        value.append(NSAttributedString(
            string: text,
            attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular),
                .foregroundColor: textColor
            ]
        ))
        return value
    }

    private func build() {
        wantsLayer = true
        layer?.backgroundColor = themeTokens.panelBackground.cgColor

        toggleButton.image = NSImage(systemSymbolName: "sidebar.leading", accessibilityDescription: "Toggle sidebar")
        toggleButton.isBordered = false
        toggleButton.contentTintColor = themeTokens.tertiaryText
        toggleButton.target = self
        toggleButton.action = #selector(toggleSidebar)

        tabStack.orientation = .horizontal
        tabStack.alignment = .centerY
        tabStack.spacing = 2

        serverLabel.lineBreakMode = .byTruncatingTail
        attentionLabel.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
        attentionLabel.textColor = themeTokens.attentionBadge
        attentionLabel.lineBreakMode = .byTruncatingTail
        attentionLabel.isHidden = true

        bottomHairline.wantsLayer = true
        bottomHairline.layer?.backgroundColor = themeTokens.hairline.cgColor

        [toggleButton, tabStack, serverLabel, attentionLabel, bottomHairline].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }

        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: NativeShellChromeMetrics.titlebarHeight),

            toggleButton.leadingAnchor.constraint(equalTo: leadingAnchor, constant: NativeShellChromeMetrics.trafficLightInset),
            toggleButton.centerYAnchor.constraint(equalTo: centerYAnchor),
            toggleButton.widthAnchor.constraint(equalToConstant: 24),
            toggleButton.heightAnchor.constraint(equalToConstant: 20),

            tabStack.leadingAnchor.constraint(equalTo: toggleButton.trailingAnchor, constant: 14),
            tabStack.centerYAnchor.constraint(equalTo: centerYAnchor),
            tabStack.trailingAnchor.constraint(lessThanOrEqualTo: serverLabel.leadingAnchor, constant: -16),

            attentionLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            attentionLabel.centerYAnchor.constraint(equalTo: centerYAnchor),
            serverLabel.trailingAnchor.constraint(equalTo: attentionLabel.leadingAnchor, constant: -14),
            serverLabel.centerYAnchor.constraint(equalTo: centerYAnchor),

            bottomHairline.leadingAnchor.constraint(equalTo: leadingAnchor),
            bottomHairline.trailingAnchor.constraint(equalTo: trailingAnchor),
            bottomHairline.bottomAnchor.constraint(equalTo: bottomAnchor),
            bottomHairline.heightAnchor.constraint(equalToConstant: 1)
        ])
    }

    private func tabView(
        for window: PaneGrid.WindowPresentation,
        isActive: Bool,
        presence: NativeShellTabPresence?
    ) -> NSView {
        let container = NSView()
        container.translatesAutoresizingMaskIntoConstraints = false

        let presenceDot = presence.map { presence -> NativeSidebarDotView in
            let dot = NativeSidebarDotView(color: presence.color, diameter: 6, haloed: presence.haloed)
            dot.identifier = NSUserInterfaceItemIdentifier("tab-presence-\(window.windowID.rawValue)")
            dot.setAccessibilityLabel(presence.accessibilityLabel)
            return dot
        }

        let button = NSButton(title: "", target: self, action: #selector(selectTab(_:)))
        button.identifier = NSUserInterfaceItemIdentifier(window.windowID.rawValue)
        button.isBordered = false
        button.attributedTitle = NSAttributedString(
            string: "\(window.index + 1) \(window.title)",
            attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 11.5, weight: .regular),
                .foregroundColor: isActive ? themeTokens.primaryText : themeTokens.tertiaryText
            ]
        )
        button.lineBreakMode = .byTruncatingTail
        button.translatesAutoresizingMaskIntoConstraints = false
        if let presenceDot {
            container.addSubview(presenceDot)
        }
        container.addSubview(button)

        let underline = NSView()
        underline.wantsLayer = true
        underline.layer?.backgroundColor = isActive ? themeTokens.accent.cgColor : themeTokens.transparent.cgColor
        underline.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(underline)

        var constraints = [
            button.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -10),
            button.centerYAnchor.constraint(equalTo: container.centerYAnchor, constant: -1),
            button.widthAnchor.constraint(lessThanOrEqualToConstant: 180),
            container.heightAnchor.constraint(equalToConstant: NativeShellChromeMetrics.titlebarHeight - 12),

            underline.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 6),
            underline.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -6),
            underline.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            underline.heightAnchor.constraint(equalToConstant: 1)
        ]
        if let presenceDot, let presence {
            constraints += [
                presenceDot.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: presence.haloed ? 7 : 10),
                presenceDot.centerYAnchor.constraint(equalTo: button.centerYAnchor),
                button.leadingAnchor.constraint(equalTo: presenceDot.trailingAnchor, constant: 6)
            ]
        } else {
            constraints.append(button.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 10))
        }
        NSLayoutConstraint.activate(constraints)
        return container
    }

    private func tabPresence(
        for window: PaneGrid.WindowPresentation,
        records: [AgentIntegration.AgentPresenceRecord]
    ) -> NativeShellTabPresence? {
        let paneIDs = Set(window.panes.map(\.paneID))
        let visible = records.filter { record in
            guard Self.isVisiblePresence(record.state) else {
                return false
            }
            if let tabID = record.provenance.tabID {
                return tabID == window.windowID
            }
            return paneIDs.contains(record.provenance.paneID)
        }
        guard let selected = visible.max(by: { lhs, rhs in
            Self.presencePriority(lhs.state) < Self.presencePriority(rhs.state)
        }) else {
            return nil
        }

        return NativeShellTabPresence(
            color: presenceColor(for: selected.state),
            haloed: Self.isAttentionPresence(selected.state),
            accessibilityLabel: "\(selected.agentID.rawValue) \(selected.state.rawValue)"
        )
    }

    private static func isVisiblePresence(_ state: AgentIntegration.AgentPresenceState) -> Bool {
        switch state {
        case .sessionStarted, .busy, .awaitingInput, .awaitingApproval, .failed:
            return true
        case .turnCompleted, .sessionEnded:
            return false
        }
    }

    private static func isAttentionPresence(_ state: AgentIntegration.AgentPresenceState) -> Bool {
        switch state {
        case .awaitingInput, .awaitingApproval, .failed:
            return true
        case .sessionStarted, .busy, .turnCompleted, .sessionEnded:
            return false
        }
    }

    private static func presencePriority(_ state: AgentIntegration.AgentPresenceState) -> Int {
        switch state {
        case .failed:
            return 5
        case .awaitingApproval:
            return 4
        case .awaitingInput:
            return 3
        case .busy:
            return 2
        case .sessionStarted:
            return 1
        case .turnCompleted, .sessionEnded:
            return 0
        }
    }

    private func presenceColor(for state: AgentIntegration.AgentPresenceState) -> NSColor {
        switch state {
        case .failed:
            return themeTokens.failureBadge
        case .awaitingInput, .awaitingApproval:
            return themeTokens.attentionBadge
        case .busy:
            return themeTokens.accent
        case .sessionStarted:
            return themeTokens.workflowBadge
        case .turnCompleted, .sessionEnded:
            return themeTokens.hairline
        }
    }

    @objc private func toggleSidebar() {
        onToggleSidebar?()
    }

    @objc private func selectTab(_ sender: NSButton) {
        guard let rawValue = sender.identifier?.rawValue else {
            return
        }
        onSelectWindow?(FenrirWindowID(rawValue: rawValue))
    }
}

@MainActor
final class NativeShellStatusBarView: NSView {
    let themeTokens: NativeShellThemeTokens

    private let connectionLabel = NSTextField(labelWithString: "")
    private let tmuxLabel = NSTextField(labelWithString: "")
    private let attentionLabel = NSTextField(labelWithString: "")
    private let hintsLabel = NSTextField(labelWithString: "⌘P palette · ⌘B sidebar")
    private let topHairline = NSView()

    init(themeTokens: NativeShellThemeTokens) {
        self.themeTokens = themeTokens
        super.init(frame: .zero)
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func apply(connectionText: String, isHealthy: Bool, tmuxSummary: String, attentionText: String?) {
        connectionLabel.attributedStringValue = NativeShellTitlebarView.dotPrefixed(
            text: connectionText,
            dotColor: isHealthy ? themeTokens.okBadge : themeTokens.failureBadge,
            textColor: themeTokens.tertiaryText
        )
        tmuxLabel.stringValue = tmuxSummary
        attentionLabel.isHidden = attentionText == nil
        attentionLabel.stringValue = attentionText.map { "◉ \($0)" } ?? ""
    }

    private func build() {
        wantsLayer = true
        layer?.backgroundColor = themeTokens.panelBackground.cgColor

        for label in [tmuxLabel, hintsLabel] {
            label.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
            label.textColor = themeTokens.tertiaryText
            label.lineBreakMode = .byTruncatingTail
        }
        attentionLabel.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
        attentionLabel.textColor = themeTokens.attentionBadge
        attentionLabel.lineBreakMode = .byTruncatingTail
        attentionLabel.isHidden = true

        topHairline.wantsLayer = true
        topHairline.layer?.backgroundColor = themeTokens.hairline.cgColor

        [connectionLabel, tmuxLabel, attentionLabel, hintsLabel, topHairline].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }

        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: NativeShellChromeMetrics.statusBarHeight),

            topHairline.leadingAnchor.constraint(equalTo: leadingAnchor),
            topHairline.trailingAnchor.constraint(equalTo: trailingAnchor),
            topHairline.topAnchor.constraint(equalTo: topAnchor),
            topHairline.heightAnchor.constraint(equalToConstant: 1),

            connectionLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            connectionLabel.centerYAnchor.constraint(equalTo: centerYAnchor),

            tmuxLabel.leadingAnchor.constraint(equalTo: connectionLabel.trailingAnchor, constant: 20),
            tmuxLabel.centerYAnchor.constraint(equalTo: centerYAnchor),

            attentionLabel.leadingAnchor.constraint(equalTo: tmuxLabel.trailingAnchor, constant: 20),
            attentionLabel.centerYAnchor.constraint(equalTo: centerYAnchor),
            attentionLabel.trailingAnchor.constraint(lessThanOrEqualTo: hintsLabel.leadingAnchor, constant: -16),

            hintsLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            hintsLabel.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
    }
}

private struct NativeShellTabPresence {
    let color: NSColor
    let haloed: Bool
    let accessibilityLabel: String
}

struct NativeSidebarViewModel {
    var items: [WorkspaceIndex.WorkspaceSidebarItem]
    var activeWorkspaceID: WorkspaceID?
    var paneGridState: PaneGrid.State?
    var agentStatuses: [AgentIntegration.AgentIntegrationStatus]
    var agentPresenceRecords: [AgentIntegration.AgentPresenceRecord]
    var workflowRuns: [WorkflowControl.WorkflowRunSnapshot]
    var serverStatusText: String
    var isServerHealthy: Bool
    var referenceDate: Date

    init(
        items: [WorkspaceIndex.WorkspaceSidebarItem],
        activeWorkspaceID: WorkspaceID? = nil,
        paneGridState: PaneGrid.State? = nil,
        agentStatuses: [AgentIntegration.AgentIntegrationStatus] = [],
        agentPresenceRecords: [AgentIntegration.AgentPresenceRecord] = [],
        workflowRuns: [WorkflowControl.WorkflowRunSnapshot] = [],
        serverStatusText: String = "local server",
        isServerHealthy: Bool = true,
        referenceDate: Date = Date()
    ) {
        self.items = items
        self.activeWorkspaceID = activeWorkspaceID
        self.paneGridState = paneGridState
        self.agentStatuses = agentStatuses
        self.agentPresenceRecords = agentPresenceRecords
        self.workflowRuns = workflowRuns
        self.serverStatusText = serverStatusText
        self.isServerHealthy = isServerHealthy
        self.referenceDate = referenceDate
    }

    /// Shared ordering for workspace rows and their ⌘1–⌘9 hotkey slots so the
    /// sidebar chips and the shell keyboard dispatch never disagree.
    static func hotkeyOrderedWorkspaces(
        items: [WorkspaceIndex.WorkspaceSidebarItem]
    ) -> [WorkspaceIndex.WorkspaceSidebarItem] {
        let visible = items.filter { $0.visibility == .visible }
        let open = visible.filter(\.isOpenLocally)
        let closed = visible.filter { !$0.isOpenLocally }
        return open + closed.filter { $0.isFavorite || $0.status == .open }
    }
}

@MainActor
final class NativeWorkspaceSidebarView: NSView {
    let themeTokens: NativeShellThemeTokens
    var onFocusRequested: (() -> Void)?
    var onSelectWorkspace: ((WorkspaceID) -> Void)?
    var onOpenAgentIntegrations: (() -> Void)?

    private let scrollStack = NSStackView()
    private let footerStack = NSStackView()
    private let footerHairline = NSView()

    init(
        themeTokens: NativeShellThemeTokens = .resolve(Settings.NativeSettingsConfiguration.defaults.appearance.themeID),
        frame frameRect: NSRect = .zero
    ) {
        self.themeTokens = themeTokens
        super.init(frame: frameRect)
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override var acceptsFirstResponder: Bool { true }

    override func mouseDown(with event: NSEvent) {
        onFocusRequested?()
        super.mouseDown(with: event)
    }

    func apply(items: [WorkspaceIndex.WorkspaceSidebarItem]) {
        apply(model: NativeSidebarViewModel(items: items))
    }

    func apply(model: NativeSidebarViewModel) {
        clear(scrollStack)
        clear(footerStack)

        let visibleItems = model.items.filter { $0.visibility == .visible }
        let closedItems = visibleItems.filter { !$0.isOpenLocally }
        let workspaceRows = NativeSidebarViewModel.hotkeyOrderedWorkspaces(items: model.items)
        let recentRows = closedItems
            .filter { !workspaceRows.contains($0) && $0.lastFocusedAt != nil }
            .sorted { ($0.lastFocusedAt?.date ?? .distantPast) > ($1.lastFocusedAt?.date ?? .distantPast) }
        let degradedAgents = degradedStatuses(model.agentStatuses)

        renderAttentionSection(items: visibleItems, degradedAgents: degradedAgents)
        renderWorkspacesSection(rows: workspaceRows, model: model)
        renderRecentSection(rows: recentRows, referenceDate: model.referenceDate)
        renderFooter(model: model)
    }

    private func renderAttentionSection(
        items: [WorkspaceIndex.WorkspaceSidebarItem],
        degradedAgents: [AgentIntegration.AgentIntegrationStatus]
    ) {
        let attentionItems = items.filter { $0.notificationLevel == .attention && $0.notificationCount > 0 }
        guard !attentionItems.isEmpty || !degradedAgents.isEmpty else {
            return
        }
        addSection("attention", color: themeTokens.attentionBadge)
        for item in attentionItems {
            addRow(NativeSidebarRow(
                dotColor: themeTokens.attentionBadge,
                dotPulsesAttention: true,
                title: item.displayName,
                titleColor: themeTokens.attentionBadge,
                meta: "\(item.notificationCount) need input",
                metaColor: themeTokens.attentionBadge.withAlphaComponent(0.6),
                themeTokens: themeTokens,
                onClick: { [weak self] in self?.onSelectWorkspace?(item.workspaceID) }
            ))
        }
        if !degradedAgents.isEmpty {
            addRow(NativeSidebarRow(
                dotColor: themeTokens.attentionBadge,
                dotPulsesAttention: true,
                title: "agent integrations",
                titleColor: themeTokens.attentionBadge,
                meta: "\(degradedAgents.count) need repair",
                metaColor: themeTokens.attentionBadge.withAlphaComponent(0.6),
                themeTokens: themeTokens,
                onClick: { [weak self] in self?.onOpenAgentIntegrations?() }
            ))
        }
    }

    private func renderWorkspacesSection(rows: [WorkspaceIndex.WorkspaceSidebarItem], model: NativeSidebarViewModel) {
        addSection("workspaces", color: themeTokens.tertiaryText)
        for (index, item) in rows.enumerated() {
            let isActive = item.workspaceID == model.activeWorkspaceID
            let hotkey = index < 9 ? "⌘\(index + 1)" : nil
            addRow(NativeSidebarWorkspaceRow(
                item: item,
                isActive: isActive,
                hotkey: hotkey,
                themeTokens: themeTokens,
                onClick: { [weak self] in self?.onSelectWorkspace?(item.workspaceID) }
            ))
            if isActive {
                renderActiveWorkspaceKids(model: model)
            }
        }
        if rows.isEmpty {
            addRow(NativeSidebarRow(
                dotColor: themeTokens.hairline,
                title: "no workspaces",
                titleColor: themeTokens.tertiaryText,
                meta: nil,
                metaColor: themeTokens.tertiaryText,
                themeTokens: themeTokens
            ))
        }
    }

    private func renderActiveWorkspaceKids(model: NativeSidebarViewModel) {
        renderActiveApps(model: model)
        renderDevServers(model: model)
        renderAgents(model: model)
    }

    private func renderActiveApps(model: NativeSidebarViewModel) {
        let rows = activeAppRows(model: model)
        guard !rows.isEmpty else {
            return
        }

        addKidSection("apps")
        for row in rows {
            addRow(NativeSidebarKidRow(
                dotColor: row.dotColor,
                title: row.title,
                titleColor: themeTokens.primaryText,
                meta: row.meta,
                themeTokens: themeTokens
            ))
        }
    }

    private func renderDevServers(model: NativeSidebarViewModel) {
        addKidSection("dev servers")
        addRow(NativeSidebarKidRow(
            dotColor: model.isServerHealthy ? themeTokens.okBadge : themeTokens.failureBadge,
            title: model.serverStatusText,
            titleColor: themeTokens.primaryText,
            meta: model.isServerHealthy ? "connected" : "reconnecting",
            themeTokens: themeTokens
        ))
    }

    private func renderAgents(model: NativeSidebarViewModel) {
        let detected = model.agentStatuses.filter { status in
            status.state != .notInstalled || status.detectedExecutablePath != nil
        }
        guard !detected.isEmpty else {
            return
        }
        addKidSection("agents")
        for status in detected {
            let (dotColor, meta) = agentPresentation(status)
            addRow(NativeSidebarKidRow(
                dotColor: dotColor,
                title: status.agent.displayName.lowercased(),
                titleColor: themeTokens.primaryText,
                meta: meta,
                themeTokens: themeTokens,
                onClick: { [weak self] in self?.onOpenAgentIntegrations?() }
            ))
        }
    }

    private func activeAppRows(model: NativeSidebarViewModel) -> [NativeSidebarChildPresentation] {
        guard let paneGridState = model.paneGridState else {
            return []
        }
        let activeWindow = paneGridState.windows.first { $0.windowID == paneGridState.activeWindowID }
        let panes = activeWindow?.panes ?? paneGridState.windows.flatMap(\.panes)
        let presenceByPane = model.agentPresenceRecords.reduce(into: [PaneID: AgentIntegration.AgentPresenceRecord]()) { partial, record in
            guard Self.isVisiblePresence(record.state) else {
                return
            }
            let existing = partial[record.provenance.paneID]
            if existing.map({ Self.presencePriority($0.state) < Self.presencePriority(record.state) }) ?? true {
                partial[record.provenance.paneID] = record
            }
        }

        return panes.map { pane in
            let title = normalizedAppTitle(pane.title) ?? pane.paneID.rawValue
            let presence = presenceByPane[pane.paneID]
            return NativeSidebarChildPresentation(
                dotColor: presence.map { presenceColor(for: $0.state) } ?? (pane.isFocused ? themeTokens.accent : themeTokens.hairline),
                title: title,
                meta: presence.map { "\($0.agentID.rawValue) \($0.state.rawValue)" } ?? pane.tmuxPaneID.rawValue
            )
        }
    }

    private func normalizedAppTitle(_ title: String?) -> String? {
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else {
            return nil
        }
        return trimmed.lowercased()
    }

    private func renderRecentSection(rows: [WorkspaceIndex.WorkspaceSidebarItem], referenceDate: Date) {
        guard !rows.isEmpty else {
            return
        }
        addSection("recent", color: themeTokens.tertiaryText)
        for item in rows.prefix(6) {
            addRow(NativeSidebarRow(
                dotColor: themeTokens.hairline,
                title: item.displayName,
                titleColor: themeTokens.primaryText,
                meta: item.lastFocusedAt.map { Self.relativeAge(from: $0.date, to: referenceDate) },
                metaColor: themeTokens.tertiaryText,
                themeTokens: themeTokens,
                onClick: { [weak self] in self?.onSelectWorkspace?(item.workspaceID) }
            ))
        }
    }

    private func renderFooter(model: NativeSidebarViewModel) {
        let serverLabel = NSTextField(labelWithString: "")
        serverLabel.attributedStringValue = NativeShellTitlebarView.dotPrefixed(
            text: model.serverStatusText,
            dotColor: model.isServerHealthy ? themeTokens.okBadge : themeTokens.failureBadge,
            textColor: model.isServerHealthy ? themeTokens.okBadge : themeTokens.failureBadge
        )
        serverLabel.lineBreakMode = .byTruncatingTail
        footerStack.addArrangedSubview(serverLabel)

        let running = model.workflowRuns.filter { !$0.status.isTerminal }.count
        let failed = model.workflowRuns.filter { $0.status == .failed }.count
        if running > 0 || failed > 0 {
            let workflowLabel = NSTextField(labelWithString: "⚙ \(running) workflows running · \(failed) failed")
            workflowLabel.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
            workflowLabel.textColor = failed > 0 ? themeTokens.failureBadge : themeTokens.tertiaryText
            workflowLabel.lineBreakMode = .byTruncatingTail
            footerStack.addArrangedSubview(workflowLabel)
        }
    }

    private func agentPresentation(_ status: AgentIntegration.AgentIntegrationStatus) -> (NSColor, String) {
        switch status.state {
        case .installed:
            return (themeTokens.okBadge, "hooks \(status.installedVersion?.rawValue ?? status.expectedVersion.rawValue)")
        case .notInstalled:
            return (themeTokens.attentionBadge, "detected · not provisioned")
        case .outdated:
            return (themeTokens.attentionBadge, "hooks outdated")
        case .conflicted:
            return (themeTokens.failureBadge, "config conflict")
        case .unsupported:
            return (themeTokens.hairline, "unsupported")
        }
    }

    private func presenceColor(for state: AgentIntegration.AgentPresenceState) -> NSColor {
        switch state {
        case .failed:
            return themeTokens.failureBadge
        case .awaitingInput, .awaitingApproval:
            return themeTokens.attentionBadge
        case .busy:
            return themeTokens.accent
        case .sessionStarted:
            return themeTokens.workflowBadge
        case .turnCompleted:
            return themeTokens.okBadge
        case .sessionEnded:
            return themeTokens.hairline
        }
    }

    private static func isVisiblePresence(_ state: AgentIntegration.AgentPresenceState) -> Bool {
        switch state {
        case .sessionStarted, .busy, .awaitingInput, .awaitingApproval, .failed:
            return true
        case .turnCompleted, .sessionEnded:
            return false
        }
    }

    private static func presencePriority(_ state: AgentIntegration.AgentPresenceState) -> Int {
        switch state {
        case .failed:
            return 5
        case .awaitingApproval:
            return 4
        case .awaitingInput:
            return 3
        case .busy:
            return 2
        case .sessionStarted:
            return 1
        case .turnCompleted, .sessionEnded:
            return 0
        }
    }

    private func degradedStatuses(_ statuses: [AgentIntegration.AgentIntegrationStatus]) -> [AgentIntegration.AgentIntegrationStatus] {
        statuses.filter { status in
            switch status.state {
            case .installed:
                return false
            case .notInstalled:
                return status.detectedExecutablePath != nil
            case .outdated, .conflicted, .unsupported:
                return true
            }
        }
    }

    static func relativeAge(from date: Date, to reference: Date) -> String {
        let seconds = max(0, reference.timeIntervalSince(date))
        if seconds < 60 {
            return "now"
        }
        if seconds < 3600 {
            return "\(Int(seconds / 60))m"
        }
        if seconds < 86400 {
            return "\(Int(seconds / 3600))h"
        }
        return "\(Int(seconds / 86400))d"
    }

    private func addSection(_ title: String, color: NSColor) {
        let label = NSTextField(labelWithString: title.uppercased())
        label.font = NSFont.monospacedSystemFont(ofSize: 9, weight: .medium)
        label.textColor = color
        let attributed = NSMutableAttributedString(string: title.uppercased())
        attributed.addAttributes(
            [
                .font: NSFont.monospacedSystemFont(ofSize: 9, weight: .medium),
                .foregroundColor: color,
                .kern: 1.8
            ],
            range: NSRange(location: 0, length: attributed.length)
        )
        label.attributedStringValue = attributed

        let container = NSView()
        container.translatesAutoresizingMaskIntoConstraints = false
        label.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(label)
        NSLayoutConstraint.activate([
            container.heightAnchor.constraint(equalToConstant: 26),
            label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 14),
            label.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -4),
            label.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -8)
        ])
        addRow(container)
    }

    private func addKidSection(_ title: String) {
        let label = NSTextField(labelWithString: title.uppercased())
        let attributed = NSMutableAttributedString(string: title.uppercased())
        attributed.addAttributes(
            [
                .font: NSFont.monospacedSystemFont(ofSize: 8.5, weight: .medium),
                .foregroundColor: themeTokens.tertiaryText,
                .kern: 1.5
            ],
            range: NSRange(location: 0, length: attributed.length)
        )
        label.attributedStringValue = attributed

        let container = NSView()
        container.translatesAutoresizingMaskIntoConstraints = false
        label.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(label)
        NSLayoutConstraint.activate([
            container.heightAnchor.constraint(equalToConstant: 20),
            label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 32),
            label.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -3),
            label.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -8)
        ])
        addRow(container)
    }

    private func addRow(_ view: NSView) {
        scrollStack.addArrangedSubview(view)
        view.widthAnchor.constraint(equalTo: scrollStack.widthAnchor).isActive = true
    }

    private func clear(_ stack: NSStackView) {
        stack.arrangedSubviews.forEach {
            stack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
    }

    private func build() {
        wantsLayer = true
        layer?.backgroundColor = themeTokens.sidebarBackground.cgColor

        scrollStack.orientation = .vertical
        scrollStack.alignment = .leading
        scrollStack.spacing = 0
        scrollStack.edgeInsets = NSEdgeInsets(top: 6, left: 0, bottom: 6, right: 0)

        footerHairline.wantsLayer = true
        footerHairline.layer?.backgroundColor = themeTokens.hairline.cgColor

        footerStack.orientation = .vertical
        footerStack.alignment = .leading
        footerStack.spacing = 5
        footerStack.edgeInsets = NSEdgeInsets(top: 10, left: 14, bottom: 10, right: 14)

        [scrollStack, footerHairline, footerStack].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }

        NSLayoutConstraint.activate([
            scrollStack.leadingAnchor.constraint(equalTo: leadingAnchor),
            scrollStack.trailingAnchor.constraint(equalTo: trailingAnchor),
            scrollStack.topAnchor.constraint(equalTo: topAnchor),
            scrollStack.bottomAnchor.constraint(lessThanOrEqualTo: footerHairline.topAnchor),

            footerHairline.leadingAnchor.constraint(equalTo: leadingAnchor),
            footerHairline.trailingAnchor.constraint(equalTo: trailingAnchor),
            footerHairline.heightAnchor.constraint(equalToConstant: 1),
            footerHairline.bottomAnchor.constraint(equalTo: footerStack.topAnchor),

            footerStack.leadingAnchor.constraint(equalTo: leadingAnchor),
            footerStack.trailingAnchor.constraint(equalTo: trailingAnchor),
            footerStack.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }
}

private struct NativeSidebarChildPresentation {
    let dotColor: NSColor
    let title: String
    let meta: String?
}

@MainActor
final class NativeSidebarRow: NSView {
    private let onClick: (() -> Void)?

    init(
        dotColor: NSColor,
        dotPulsesAttention: Bool = false,
        title: String,
        titleColor: NSColor,
        meta: String?,
        metaColor: NSColor,
        themeTokens: NativeShellThemeTokens,
        hotkey: String? = nil,
        onClick: (() -> Void)? = nil
    ) {
        self.onClick = onClick
        super.init(frame: .zero)

        let dot = NativeSidebarDotView(color: dotColor, diameter: 8, haloed: dotPulsesAttention)

        let titleLabel = NSTextField(labelWithString: title)
        titleLabel.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        titleLabel.textColor = titleColor
        titleLabel.lineBreakMode = .byTruncatingTail

        let metaLabel = NSTextField(labelWithString: meta ?? "")
        metaLabel.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
        metaLabel.textColor = metaColor
        metaLabel.lineBreakMode = .byTruncatingTail
        metaLabel.isHidden = meta == nil

        var trailing: NSView?
        if let hotkey {
            trailing = NativeSidebarHotkeyChip(hotkey: hotkey, themeTokens: themeTokens)
        }

        [dot, titleLabel, metaLabel].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }
        if let trailing {
            trailing.translatesAutoresizingMaskIntoConstraints = false
            addSubview(trailing)
        }

        var constraints = [
            heightAnchor.constraint(equalToConstant: 24),
            dot.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            dot.centerYAnchor.constraint(equalTo: centerYAnchor),
            titleLabel.leadingAnchor.constraint(equalTo: dot.trailingAnchor, constant: 8),
            titleLabel.centerYAnchor.constraint(equalTo: centerYAnchor),
            metaLabel.leadingAnchor.constraint(equalTo: titleLabel.trailingAnchor, constant: 8),
            metaLabel.centerYAnchor.constraint(equalTo: centerYAnchor)
        ]
        if let trailing {
            constraints += [
                metaLabel.trailingAnchor.constraint(lessThanOrEqualTo: trailing.leadingAnchor, constant: -8),
                trailing.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
                trailing.centerYAnchor.constraint(equalTo: centerYAnchor)
            ]
        } else {
            constraints.append(metaLabel.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -14))
        }
        NSLayoutConstraint.activate(constraints)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func mouseDown(with event: NSEvent) {
        onClick?()
        super.mouseDown(with: event)
    }
}

@MainActor
final class NativeSidebarWorkspaceRow: NSView {
    private let onClick: (() -> Void)?

    init(
        item: WorkspaceIndex.WorkspaceSidebarItem,
        isActive: Bool,
        hotkey: String?,
        themeTokens: NativeShellThemeTokens,
        onClick: (() -> Void)? = nil
    ) {
        self.onClick = onClick
        super.init(frame: .zero)
        wantsLayer = true
        if isActive {
            layer?.backgroundColor = themeTokens.accent.withAlphaComponent(0.08).cgColor
        }

        let disclosure = NSTextField(labelWithString: isActive ? "▾" : "▸")
        disclosure.font = NSFont.monospacedSystemFont(ofSize: 9, weight: .regular)
        disclosure.textColor = themeTokens.tertiaryText

        let titleLabel = NSTextField(labelWithString: item.displayName)
        titleLabel.font = NSFont.monospacedSystemFont(ofSize: 12, weight: isActive ? .medium : .regular)
        titleLabel.textColor = themeTokens.primaryText
        titleLabel.lineBreakMode = .byTruncatingTail

        let accentBar = NSView()
        accentBar.wantsLayer = true
        accentBar.layer?.backgroundColor = isActive ? themeTokens.accent.cgColor : themeTokens.transparent.cgColor

        let badge = NSTextField(labelWithString: "\(item.notificationCount)")
        badge.font = NSFont.monospacedDigitSystemFont(ofSize: 9.5, weight: .semibold)
        badge.alignment = .center
        badge.textColor = themeTokens.rootBackground
        badge.wantsLayer = true
        badge.layer?.cornerRadius = 7
        badge.layer?.backgroundColor = item.notificationLevel == .attention
            ? themeTokens.attentionBadge.cgColor
            : themeTokens.workflowBadge.cgColor
        badge.isHidden = item.notificationCount == 0

        var trailing: NSView?
        if let hotkey {
            trailing = NativeSidebarHotkeyChip(hotkey: hotkey, themeTokens: themeTokens)
        }

        [accentBar, disclosure, titleLabel, badge].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }
        if let trailing {
            trailing.translatesAutoresizingMaskIntoConstraints = false
            addSubview(trailing)
        }

        var constraints = [
            heightAnchor.constraint(equalToConstant: 28),

            accentBar.leadingAnchor.constraint(equalTo: leadingAnchor),
            accentBar.topAnchor.constraint(equalTo: topAnchor),
            accentBar.bottomAnchor.constraint(equalTo: bottomAnchor),
            accentBar.widthAnchor.constraint(equalToConstant: 2),

            disclosure.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            disclosure.centerYAnchor.constraint(equalTo: centerYAnchor),
            disclosure.widthAnchor.constraint(equalToConstant: 12),

            titleLabel.leadingAnchor.constraint(equalTo: disclosure.trailingAnchor, constant: 4),
            titleLabel.centerYAnchor.constraint(equalTo: centerYAnchor),

            badge.leadingAnchor.constraint(greaterThanOrEqualTo: titleLabel.trailingAnchor, constant: 8),
            badge.centerYAnchor.constraint(equalTo: centerYAnchor),
            badge.widthAnchor.constraint(greaterThanOrEqualToConstant: 18),
            badge.heightAnchor.constraint(equalToConstant: 14)
        ]
        if let trailing {
            constraints += [
                badge.trailingAnchor.constraint(lessThanOrEqualTo: trailing.leadingAnchor, constant: -8),
                trailing.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
                trailing.centerYAnchor.constraint(equalTo: centerYAnchor)
            ]
        } else {
            constraints.append(badge.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -14))
        }
        NSLayoutConstraint.activate(constraints)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func mouseDown(with event: NSEvent) {
        onClick?()
        super.mouseDown(with: event)
    }
}

@MainActor
final class NativeSidebarKidRow: NSView {
    private let onClick: (() -> Void)?

    init(
        dotColor: NSColor,
        title: String,
        titleColor: NSColor,
        meta: String?,
        themeTokens: NativeShellThemeTokens,
        onClick: (() -> Void)? = nil
    ) {
        self.onClick = onClick
        super.init(frame: .zero)

        let treeLine = NSView()
        treeLine.wantsLayer = true
        treeLine.layer?.backgroundColor = themeTokens.hairline.cgColor

        let dot = NativeSidebarDotView(color: dotColor, diameter: 6)

        let titleLabel = NSTextField(labelWithString: title)
        titleLabel.font = NSFont.monospacedSystemFont(ofSize: 11.5, weight: .regular)
        titleLabel.textColor = titleColor
        titleLabel.lineBreakMode = .byTruncatingTail

        let metaLabel = NSTextField(labelWithString: meta ?? "")
        metaLabel.font = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
        metaLabel.textColor = themeTokens.tertiaryText
        metaLabel.lineBreakMode = .byTruncatingTail
        metaLabel.isHidden = meta == nil

        [treeLine, dot, titleLabel, metaLabel].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }

        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 21),

            treeLine.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
            treeLine.topAnchor.constraint(equalTo: topAnchor),
            treeLine.bottomAnchor.constraint(equalTo: bottomAnchor),
            treeLine.widthAnchor.constraint(equalToConstant: 1),

            dot.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 32),
            dot.centerYAnchor.constraint(equalTo: centerYAnchor),

            titleLabel.leadingAnchor.constraint(equalTo: dot.trailingAnchor, constant: 7),
            titleLabel.centerYAnchor.constraint(equalTo: centerYAnchor),

            metaLabel.leadingAnchor.constraint(equalTo: titleLabel.trailingAnchor, constant: 7),
            metaLabel.centerYAnchor.constraint(equalTo: centerYAnchor),
            metaLabel.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -12)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func mouseDown(with event: NSEvent) {
        onClick?()
        super.mouseDown(with: event)
    }
}

@MainActor
final class NativeSidebarDotView: NSView {
    private let color: NSColor
    private let diameter: CGFloat
    private let haloed: Bool

    init(color: NSColor, diameter: CGFloat, haloed: Bool = false) {
        self.color = color
        self.diameter = diameter
        self.haloed = haloed
        super.init(frame: .zero)
        wantsLayer = true
        translatesAutoresizingMaskIntoConstraints = false
        let dot = CALayer()
        dot.backgroundColor = color.cgColor
        dot.cornerRadius = diameter / 2
        dot.frame = CGRect(x: haloed ? 3 : 0, y: haloed ? 3 : 0, width: diameter, height: diameter)
        if haloed {
            let halo = CALayer()
            halo.backgroundColor = color.withAlphaComponent(0.18).cgColor
            halo.cornerRadius = (diameter + 6) / 2
            halo.frame = CGRect(x: 0, y: 0, width: diameter + 6, height: diameter + 6)
            layer?.addSublayer(halo)
        }
        layer?.addSublayer(dot)
        let side = haloed ? diameter + 6 : diameter
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: side),
            heightAnchor.constraint(equalToConstant: side)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }
}

@MainActor
final class NativeSidebarHotkeyChip: NSView {
    init(hotkey: String, themeTokens: NativeShellThemeTokens) {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.borderColor = themeTokens.hairline.cgColor
        layer?.borderWidth = 1
        layer?.cornerRadius = 3

        let label = NSTextField(labelWithString: hotkey)
        label.font = NSFont.monospacedSystemFont(ofSize: 9.5, weight: .regular)
        label.textColor = themeTokens.tertiaryText
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)

        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 5),
            label.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -5),
            label.topAnchor.constraint(equalTo: topAnchor, constant: 1),
            label.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -1)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }
}
