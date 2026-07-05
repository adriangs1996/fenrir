import AppKit
import AgentIntegration
import FenrirNativeShared
import Notifications
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

// D-045 titlebar productivity controls: run-script split button, open-in-editor
// split button, notifications bell. Pure presentation state — the shell
// controller owns script resolution, editor detection, and unread counts.

enum NativeShellRunButtonPhase: String, Equatable, Sendable {
    /// No scripts are configured for the workspace.
    case unavailable
    /// Primary action runs the primary run-kind script.
    case idle
    /// A script pane is alive; primary action stops it.
    case running
}

struct NativeShellRunScriptMenuItem: Equatable, Sendable {
    let scriptID: Settings.ScriptID
    let title: String

    init(scriptID: Settings.ScriptID, title: String) {
        self.scriptID = scriptID
        self.title = title
    }
}

struct NativeShellRunControlState: Equatable, Sendable {
    var phase: NativeShellRunButtonPhase
    var title: String
    var menuItems: [NativeShellRunScriptMenuItem]

    init(phase: NativeShellRunButtonPhase, title: String, menuItems: [NativeShellRunScriptMenuItem] = []) {
        self.phase = phase
        self.title = title
        self.menuItems = menuItems
    }

    static let unavailable = NativeShellRunControlState(phase: .unavailable, title: "Run")
}

struct NativeShellEditorMenuItem: Equatable, Sendable {
    let targetID: WorkspaceIndex.EditorTargetID
    let title: String

    init(targetID: WorkspaceIndex.EditorTargetID, title: String) {
        self.targetID = targetID
        self.title = title
    }
}

struct NativeShellEditorControlState: Equatable, Sendable {
    var title: String
    var isEnabled: Bool
    var menuItems: [NativeShellEditorMenuItem]

    init(title: String, isEnabled: Bool, menuItems: [NativeShellEditorMenuItem] = []) {
        self.title = title
        self.isEnabled = isEnabled
        self.menuItems = menuItems
    }

    static let unavailable = NativeShellEditorControlState(title: "Open", isEnabled: false)
}

struct NativeShellTitlebarControlsState: Equatable, Sendable {
    var run: NativeShellRunControlState
    var editor: NativeShellEditorControlState
    var notificationUnreadCount: Int

    init(
        run: NativeShellRunControlState = .unavailable,
        editor: NativeShellEditorControlState = .unavailable,
        notificationUnreadCount: Int = 0
    ) {
        self.run = run
        self.editor = editor
        self.notificationUnreadCount = notificationUnreadCount
    }
}

@MainActor
final class NativeShellTitlebarView: NSView {
    let themeTokens: NativeShellThemeTokens
    var onToggleSidebar: (() -> Void)?
    var onSelectWindow: ((FenrirWindowID) -> Void)?
    var onRunPrimaryScript: (() -> Void)?
    var onRunScript: ((Settings.ScriptID) -> Void)?
    var onManageScripts: (() -> Void)?
    var onOpenEditorPrimary: (() -> Void)?
    var onPickEditorTarget: ((WorkspaceIndex.EditorTargetID) -> Void)?
    var onOpenNotifications: (() -> Void)?

    private(set) var controlsState = NativeShellTitlebarControlsState()

    private let tabStack = NSStackView()
    private let toggleButton = NSButton(title: "", target: nil, action: nil)
    private let controlsStack = NSStackView()
    private let runControl: NativeShellSplitButton
    private let editorControl: NativeShellSplitButton
    private let bellButton = NSButton(title: "", target: nil, action: nil)
    private let bellBadge = NSTextField(labelWithString: "")
    private let serverLabel = NSTextField(labelWithString: "")
    private let attentionLabel = NSTextField(labelWithString: "")
    private let bottomHairline = NSView()

    init(themeTokens: NativeShellThemeTokens) {
        self.themeTokens = themeTokens
        runControl = NativeShellSplitButton(themeTokens: themeTokens, identifierPrefix: "titlebar-run")
        editorControl = NativeShellSplitButton(themeTokens: themeTokens, identifierPrefix: "titlebar-editor")
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
        health: NativeShellHealthSummary,
        controls: NativeShellTitlebarControlsState? = nil
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
        if let controls {
            applyControls(controls)
        }
    }

    func applyControls(_ controls: NativeShellTitlebarControlsState) {
        controlsState = controls
        controlsStack.isHidden = false

        let runColor: NSColor = switch controls.run.phase {
        case .running: themeTokens.okBadge
        case .idle: themeTokens.primaryText
        case .unavailable: themeTokens.tertiaryText
        }
        runControl.applyPrimary(
            title: controls.run.title,
            textColor: runColor,
            isEnabled: controls.run.phase != .unavailable || !controls.run.menuItems.isEmpty
        )
        // Visual contract (docs/native-terminal-ui-shell.html, `.tbtn.running`):
        // running state shows a pulsing workflow-token dot next to the
        // ok-token label and tints the button border with the workflow token.
        runControl.setRunningIndicator(
            visible: controls.run.phase == .running,
            dotColor: themeTokens.workflowBadge,
            borderColor: controls.run.phase == .running
                ? themeTokens.workflowBadge.withAlphaComponent(0.4)
                : themeTokens.hairline
        )
        runControl.onPrimary = { [weak self] in self?.onRunPrimaryScript?() }
        runControl.menuProvider = { [weak self] in self?.runScriptsMenu() ?? NSMenu() }

        editorControl.applyPrimary(
            title: controls.editor.title,
            textColor: controls.editor.isEnabled ? themeTokens.primaryText : themeTokens.tertiaryText,
            isEnabled: controls.editor.isEnabled
        )
        editorControl.onPrimary = { [weak self] in self?.onOpenEditorPrimary?() }
        editorControl.menuProvider = { [weak self] in self?.editorTargetsMenu() ?? NSMenu() }

        bellBadge.isHidden = controls.notificationUnreadCount == 0
        bellBadge.stringValue = "\(min(controls.notificationUnreadCount, 99))"
    }

    private func runScriptsMenu() -> NSMenu {
        let menu = NSMenu()
        for item in controlsState.run.menuItems {
            let menuItem = NSMenuItem(title: item.title, action: #selector(runScriptMenuItem(_:)), keyEquivalent: "")
            menuItem.target = self
            menuItem.representedObject = item.scriptID.rawValue
            menu.addItem(menuItem)
        }
        if !controlsState.run.menuItems.isEmpty {
            menu.addItem(.separator())
        }
        let manage = NSMenuItem(title: "Manage scripts…", action: #selector(manageScriptsMenuItem), keyEquivalent: "")
        manage.target = self
        menu.addItem(manage)
        return menu
    }

    private func editorTargetsMenu() -> NSMenu {
        let menu = NSMenu()
        for item in controlsState.editor.menuItems {
            let menuItem = NSMenuItem(title: item.title, action: #selector(pickEditorTargetMenuItem(_:)), keyEquivalent: "")
            menuItem.target = self
            menuItem.representedObject = item.targetID.rawValue
            menu.addItem(menuItem)
        }
        return menu
    }

    @objc private func runScriptMenuItem(_ sender: NSMenuItem) {
        guard let rawValue = sender.representedObject as? String else {
            return
        }
        onRunScript?(Settings.ScriptID(rawValue: rawValue))
    }

    @objc private func manageScriptsMenuItem() {
        onManageScripts?()
    }

    @objc private func pickEditorTargetMenuItem(_ sender: NSMenuItem) {
        guard let rawValue = sender.representedObject as? String else {
            return
        }
        onPickEditorTarget?(WorkspaceIndex.EditorTargetID(rawValue: rawValue))
    }

    @objc private func openNotificationsFromBell() {
        onOpenNotifications?()
    }

    /// Test/diagnostics hook: whether the run split button currently shows the
    /// pulsing running indicator (visual contract `.tbtn.running .spin`).
    func runControlShowsRunningIndicator() -> Bool {
        runControl.isShowingRunningIndicator
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

        controlsStack.orientation = .horizontal
        controlsStack.alignment = .centerY
        controlsStack.spacing = 8
        controlsStack.isHidden = true

        bellButton.title = "⚑"
        bellButton.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        bellButton.isBordered = false
        bellButton.contentTintColor = themeTokens.tertiaryText
        bellButton.wantsLayer = true
        bellButton.layer?.borderColor = themeTokens.hairline.cgColor
        bellButton.layer?.borderWidth = 1
        bellButton.layer?.cornerRadius = 5
        bellButton.target = self
        bellButton.action = #selector(openNotificationsFromBell)
        bellButton.identifier = NSUserInterfaceItemIdentifier("titlebar-notifications-bell")
        bellButton.setAccessibilityLabel("Notifications")

        bellBadge.font = NSFont.monospacedDigitSystemFont(ofSize: 9, weight: .semibold)
        bellBadge.alignment = .center
        bellBadge.textColor = themeTokens.rootBackground
        bellBadge.wantsLayer = true
        bellBadge.layer?.cornerRadius = 7
        bellBadge.layer?.backgroundColor = themeTokens.attentionBadge.cgColor
        bellBadge.isHidden = true
        bellBadge.identifier = NSUserInterfaceItemIdentifier("titlebar-notifications-badge")

        controlsStack.addArrangedSubview(runControl)
        controlsStack.addArrangedSubview(editorControl)
        controlsStack.addArrangedSubview(bellButton)

        serverLabel.lineBreakMode = .byTruncatingTail
        attentionLabel.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
        attentionLabel.textColor = themeTokens.attentionBadge
        attentionLabel.lineBreakMode = .byTruncatingTail
        attentionLabel.isHidden = true

        bottomHairline.wantsLayer = true
        bottomHairline.layer?.backgroundColor = themeTokens.hairline.cgColor

        [toggleButton, tabStack, controlsStack, serverLabel, attentionLabel, bottomHairline, bellBadge].forEach {
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
            tabStack.trailingAnchor.constraint(lessThanOrEqualTo: controlsStack.leadingAnchor, constant: -16),

            controlsStack.trailingAnchor.constraint(equalTo: serverLabel.leadingAnchor, constant: -16),
            controlsStack.centerYAnchor.constraint(equalTo: centerYAnchor),

            bellButton.widthAnchor.constraint(greaterThanOrEqualToConstant: 30),
            bellButton.heightAnchor.constraint(equalToConstant: 22),

            bellBadge.centerXAnchor.constraint(equalTo: bellButton.trailingAnchor, constant: -3),
            bellBadge.centerYAnchor.constraint(equalTo: bellButton.topAnchor, constant: 1),
            bellBadge.widthAnchor.constraint(greaterThanOrEqualToConstant: 14),
            bellBadge.heightAnchor.constraint(equalToConstant: 14),

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

/// Bordered split button used by the D-045 titlebar controls: a primary
/// action segment and a caret segment that pops a menu.
@MainActor
final class NativeShellSplitButton: NSView {
    var onPrimary: (() -> Void)?
    var menuProvider: (() -> NSMenu)?

    private static let runningPulseAnimationKey = "fenrir-running-pulse"

    private let themeTokens: NativeShellThemeTokens
    private let primaryButton = NSButton(title: "", target: nil, action: nil)
    private let caretButton = NSButton(title: "▾", target: nil, action: nil)
    private let divider = NSView()
    /// Pulsing running indicator (visual contract `.tbtn.running .spin`):
    /// a 7pt workflow-token dot animated with an opacity loop.
    private let runningDot = NSView()
    private var primaryLeadingToEdge: NSLayoutConstraint?
    private var primaryLeadingToDot: NSLayoutConstraint?

    private(set) var primaryTitle = ""
    private(set) var isShowingRunningIndicator = false

    init(themeTokens: NativeShellThemeTokens, identifierPrefix: String) {
        self.themeTokens = themeTokens
        super.init(frame: .zero)
        wantsLayer = true
        layer?.borderColor = themeTokens.hairline.cgColor
        layer?.borderWidth = 1
        layer?.cornerRadius = 5

        primaryButton.isBordered = false
        primaryButton.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
        primaryButton.target = self
        primaryButton.action = #selector(primaryPressed)
        primaryButton.identifier = NSUserInterfaceItemIdentifier("\(identifierPrefix)-primary")
        primaryButton.lineBreakMode = .byTruncatingTail

        caretButton.isBordered = false
        caretButton.font = NSFont.monospacedSystemFont(ofSize: 8, weight: .regular)
        caretButton.contentTintColor = themeTokens.tertiaryText
        caretButton.target = self
        caretButton.action = #selector(caretPressed)
        caretButton.identifier = NSUserInterfaceItemIdentifier("\(identifierPrefix)-caret")

        divider.wantsLayer = true
        divider.layer?.backgroundColor = themeTokens.hairline.cgColor

        runningDot.wantsLayer = true
        runningDot.layer?.cornerRadius = 3.5
        runningDot.isHidden = true
        runningDot.identifier = NSUserInterfaceItemIdentifier("\(identifierPrefix)-running-dot")

        [runningDot, primaryButton, divider, caretButton].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }

        let primaryLeadingToEdge = primaryButton.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 9)
        let primaryLeadingToDot = primaryButton.leadingAnchor.constraint(equalTo: runningDot.trailingAnchor, constant: 6)
        self.primaryLeadingToEdge = primaryLeadingToEdge
        self.primaryLeadingToDot = primaryLeadingToDot

        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 22),

            runningDot.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 9),
            runningDot.centerYAnchor.constraint(equalTo: centerYAnchor),
            runningDot.widthAnchor.constraint(equalToConstant: 7),
            runningDot.heightAnchor.constraint(equalToConstant: 7),

            primaryLeadingToEdge,
            primaryButton.centerYAnchor.constraint(equalTo: centerYAnchor),
            primaryButton.widthAnchor.constraint(lessThanOrEqualToConstant: 180),

            divider.leadingAnchor.constraint(equalTo: primaryButton.trailingAnchor, constant: 8),
            divider.topAnchor.constraint(equalTo: topAnchor),
            divider.bottomAnchor.constraint(equalTo: bottomAnchor),
            divider.widthAnchor.constraint(equalToConstant: 1),

            caretButton.leadingAnchor.constraint(equalTo: divider.trailingAnchor, constant: 2),
            caretButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -4),
            caretButton.centerYAnchor.constraint(equalTo: centerYAnchor),
            caretButton.widthAnchor.constraint(equalToConstant: 14)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func applyPrimary(title: String, textColor: NSColor, isEnabled: Bool) {
        primaryTitle = title
        primaryButton.attributedTitle = NSAttributedString(
            string: title,
            attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular),
                .foregroundColor: isEnabled ? textColor : themeTokens.tertiaryText
            ]
        )
        primaryButton.isEnabled = isEnabled
    }

    /// Running-state fidelity vs the visual contract (`.tbtn.running`): shows
    /// the pulsing dot and border tint while a script pane is alive. Both
    /// colors flow through theme tokens (D-041) — the caller passes the
    /// workflow token for the dot and its tinted derivative for the border.
    func setRunningIndicator(visible: Bool, dotColor: NSColor, borderColor: NSColor) {
        isShowingRunningIndicator = visible
        layer?.borderColor = borderColor.cgColor
        runningDot.isHidden = !visible
        guard visible else {
            runningDot.layer?.removeAnimation(forKey: Self.runningPulseAnimationKey)
            primaryLeadingToDot?.isActive = false
            primaryLeadingToEdge?.isActive = true
            return
        }
        runningDot.layer?.backgroundColor = dotColor.cgColor
        primaryLeadingToEdge?.isActive = false
        primaryLeadingToDot?.isActive = true
        if runningDot.layer?.animation(forKey: Self.runningPulseAnimationKey) == nil {
            // Mirrors the mockup's `pulse 1.2s ease infinite` opacity loop
            // (1 -> 0.35 -> 1): 0.6s each way, autoreversed, forever.
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = 1.0
            pulse.toValue = 0.35
            pulse.duration = 0.6
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            pulse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            runningDot.layer?.add(pulse, forKey: Self.runningPulseAnimationKey)
        }
    }

    /// Test hook: whether the pulsing opacity animation is installed.
    var isRunningIndicatorPulsing: Bool {
        runningDot.layer?.animation(forKey: Self.runningPulseAnimationKey) != nil
    }

    @objc private func primaryPressed() {
        onPrimary?()
    }

    @objc private func caretPressed() {
        guard let menu = menuProvider?(), !menu.items.isEmpty else {
            return
        }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: bounds.height + 4), in: self)
    }
}

@MainActor
final class NativeShellStatusBarView: NSView {
    let themeTokens: NativeShellThemeTokens

    private let connectionLabel = NSTextField(labelWithString: "")
    private let tmuxLabel = NSTextField(labelWithString: "")
    /// D-028 prefix-mode indicator: visible while the tmux prefix key table
    /// or a `bind-key -r` repeat window is active ("C-s …" / "C-s (repeat)").
    private let tmuxPrefixChip = NSTextField(labelWithString: "")
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

    func applyTmuxPrefixChip(_ text: String?) {
        tmuxPrefixChip.isHidden = text == nil
        tmuxPrefixChip.stringValue = text.map { " \($0) " } ?? ""
    }

    func visibleTmuxPrefixChipText() -> String? {
        guard !tmuxPrefixChip.isHidden else {
            return nil
        }
        return tmuxPrefixChip.stringValue.trimmingCharacters(in: .whitespaces)
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

        tmuxPrefixChip.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .medium)
        tmuxPrefixChip.textColor = themeTokens.accent
        tmuxPrefixChip.lineBreakMode = .byClipping
        tmuxPrefixChip.wantsLayer = true
        tmuxPrefixChip.layer?.cornerRadius = 4
        tmuxPrefixChip.layer?.backgroundColor = themeTokens.selectedRowBackground.cgColor
        tmuxPrefixChip.isHidden = true
        tmuxPrefixChip.identifier = NSUserInterfaceItemIdentifier("statusbar-tmux-prefix-chip")

        topHairline.wantsLayer = true
        topHairline.layer?.backgroundColor = themeTokens.hairline.cgColor

        [connectionLabel, tmuxLabel, tmuxPrefixChip, attentionLabel, hintsLabel, topHairline].forEach {
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

            tmuxPrefixChip.leadingAnchor.constraint(equalTo: tmuxLabel.trailingAnchor, constant: 16),
            tmuxPrefixChip.centerYAnchor.constraint(equalTo: centerYAnchor),

            attentionLabel.leadingAnchor.constraint(equalTo: tmuxPrefixChip.trailingAnchor, constant: 16),
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

/// D-045 row metadata: a listening-port chip under the workspace row, sourced
/// from the server's localServers discovery contracts (never client probing).
struct NativeSidebarWorkspacePortChip: Equatable, Sendable {
    let port: Int
    /// Discovery only reports live listeners today; managed-process metadata
    /// may later contribute stopped entries rendered in the muted style.
    let isLive: Bool

    init(port: Int, isLive: Bool = true) {
        self.port = port
        self.isLive = isLive
    }
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
    /// D-045 row metadata: latest-notification line per workspace (muted,
    /// single line, sourced from the Notifications feed).
    var latestNotificationLines: [WorkspaceID: String]
    /// Workspaces with unread notifications or awaiting agents get the
    /// attention tint + dot (D-045 attention loop).
    var attentionWorkspaceIDs: Set<WorkspaceID>
    /// D-041/D-045 row metadata: current branch per workspace (server vcs
    /// contract; the client never shells out to git).
    var workspaceBranches: [WorkspaceID: String]
    /// D-045 row metadata: PR status chip per workspace (server
    /// `workspace.gitProbe` contract; the client never shells out to gh or
    /// scrapes panes).
    var workspacePullRequests: [WorkspaceID: WorkspaceIndex.WorkspaceGitPullRequestChip]
    /// D-045 row metadata: listening-port chips from the localServers
    /// discovery contract. Discovery is machine-scoped, so the chips render
    /// on the active (expanded) workspace row — matching the visual contract
    /// where only the open workspace shows its ws-meta row.
    var activeWorkspacePorts: [NativeSidebarWorkspacePortChip]
    /// D-044: recorded resumable agent sessions for the active workspace.
    /// Sessions whose pane process is gone (`paneAlive == false`) render a
    /// Resume row action in the agents group; live ones render nothing.
    var resumableAgentSessions: [AgentIntegration.AgentResumableSessionSnapshot]

    init(
        items: [WorkspaceIndex.WorkspaceSidebarItem],
        activeWorkspaceID: WorkspaceID? = nil,
        paneGridState: PaneGrid.State? = nil,
        agentStatuses: [AgentIntegration.AgentIntegrationStatus] = [],
        agentPresenceRecords: [AgentIntegration.AgentPresenceRecord] = [],
        workflowRuns: [WorkflowControl.WorkflowRunSnapshot] = [],
        serverStatusText: String = "local server",
        isServerHealthy: Bool = true,
        referenceDate: Date = Date(),
        latestNotificationLines: [WorkspaceID: String] = [:],
        attentionWorkspaceIDs: Set<WorkspaceID> = [],
        workspaceBranches: [WorkspaceID: String] = [:],
        workspacePullRequests: [WorkspaceID: WorkspaceIndex.WorkspaceGitPullRequestChip] = [:],
        activeWorkspacePorts: [NativeSidebarWorkspacePortChip] = [],
        resumableAgentSessions: [AgentIntegration.AgentResumableSessionSnapshot] = []
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
        self.latestNotificationLines = latestNotificationLines
        self.attentionWorkspaceIDs = attentionWorkspaceIDs
        self.workspaceBranches = workspaceBranches
        self.workspacePullRequests = workspacePullRequests
        self.activeWorkspacePorts = activeWorkspacePorts
        self.resumableAgentSessions = resumableAgentSessions
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
    /// D-044: user-initiated resume of a dead agent session (agentID,
    /// sessionID). The handler owns validation + pane creation.
    var onResumeAgentSession: ((AgentIntegration.AgentCLIIdentifier, String) -> Void)?

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
            let hasAttention = model.attentionWorkspaceIDs.contains(item.workspaceID)
                || (item.notificationLevel == .attention && item.notificationCount > 0)
            addRow(NativeSidebarWorkspaceRow(
                item: item,
                isActive: isActive,
                hotkey: hotkey,
                themeTokens: themeTokens,
                latestNotificationLine: model.latestNotificationLines[item.workspaceID],
                hasAttention: hasAttention,
                branch: model.workspaceBranches[item.workspaceID],
                pullRequest: model.workspacePullRequests[item.workspaceID],
                ports: isActive ? model.activeWorkspacePorts : [],
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
        // D-044: agent sessions whose pane process is GONE but which recorded
        // a session id render a Resume row action; live panes render nothing.
        let deadResumableSessions = model.resumableAgentSessions.filter { !$0.paneAlive }
        guard !detected.isEmpty || !deadResumableSessions.isEmpty else {
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
        for session in deadResumableSessions {
            let displayName = AgentIntegration.supportedAgentDescriptors
                .first { $0.id == session.agentID }?
                .displayName ?? session.agentID.rawValue
            addRow(NativeSidebarKidRow(
                dotColor: themeTokens.attentionBadge,
                title: "resume \(displayName.lowercased())",
                titleColor: themeTokens.attentionBadge,
                meta: "session \(Self.shortSessionID(session.sessionID))",
                themeTokens: themeTokens,
                onClick: { [weak self] in
                    self?.onResumeAgentSession?(session.agentID, session.sessionID)
                }
            ))
        }
    }

    static func shortSessionID(_ sessionID: String) -> String {
        sessionID.count <= 12 ? sessionID : String(sessionID.prefix(12)) + "…"
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
        latestNotificationLine: String? = nil,
        hasAttention: Bool = false,
        branch: String? = nil,
        pullRequest: WorkspaceIndex.WorkspaceGitPullRequestChip? = nil,
        ports: [NativeSidebarWorkspacePortChip] = [],
        onClick: (() -> Void)? = nil
    ) {
        self.onClick = onClick
        super.init(frame: .zero)
        wantsLayer = true
        if hasAttention {
            layer?.backgroundColor = themeTokens.attentionBadge.withAlphaComponent(0.07).cgColor
        } else if isActive {
            layer?.backgroundColor = themeTokens.accent.withAlphaComponent(0.08).cgColor
        }

        let disclosure = NSTextField(labelWithString: isActive ? "▾" : "▸")
        disclosure.font = NSFont.monospacedSystemFont(ofSize: 9, weight: .regular)
        disclosure.textColor = themeTokens.tertiaryText

        let titleLabel = NSTextField(labelWithString: item.displayName)
        titleLabel.font = NSFont.monospacedSystemFont(ofSize: 12, weight: isActive ? .medium : .regular)
        titleLabel.textColor = hasAttention ? themeTokens.attentionBadge : themeTokens.primaryText
        titleLabel.lineBreakMode = .byTruncatingTail

        // D-041 workspace row metadata: branch chip next to the name.
        let branchLabel: NSTextField? = branch.map { branchName in
            let label = NSTextField(labelWithString: "⎇ \(branchName)")
            label.font = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
            label.textColor = themeTokens.tertiaryText
            label.lineBreakMode = .byTruncatingTail
            label.identifier = NSUserInterfaceItemIdentifier("workspace-branch-\(item.workspaceID.rawValue)")
            return label
        }

        let attentionDot: NativeSidebarDotView? = hasAttention
            ? NativeSidebarDotView(color: themeTokens.attentionBadge, diameter: 6, haloed: true)
            : nil
        attentionDot?.identifier = NSUserInterfaceItemIdentifier("workspace-attention-\(item.workspaceID.rawValue)")

        let accentBar = NSView()
        accentBar.wantsLayer = true
        accentBar.layer?.backgroundColor = isActive
            ? themeTokens.accent.cgColor
            : (hasAttention ? themeTokens.attentionBadge.cgColor : themeTokens.transparent.cgColor)

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

        let latestLabel: NSTextField? = latestNotificationLine.map { line in
            let label = NSTextField(labelWithString: line)
            label.font = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
            label.textColor = hasAttention
                ? themeTokens.attentionBadge.withAlphaComponent(0.75)
                : themeTokens.tertiaryText
            label.lineBreakMode = .byTruncatingTail
            label.maximumNumberOfLines = 1
            label.identifier = NSUserInterfaceItemIdentifier("workspace-latest-\(item.workspaceID.rawValue)")
            return label
        }

        // D-045 ws-meta row: PR status chip (server workspace.gitProbe
        // contract) next to the listening-port chips (localServers
        // discovery).
        let portsStack: NSStackView? = (ports.isEmpty && pullRequest == nil) ? nil : {
            let stack = NSStackView()
            stack.orientation = .horizontal
            stack.spacing = 4
            stack.identifier = NSUserInterfaceItemIdentifier("workspace-ports-\(item.workspaceID.rawValue)")
            if let pullRequest {
                stack.addArrangedSubview(NativeSidebarPullRequestChipView(
                    chip: pullRequest,
                    workspaceID: item.workspaceID,
                    themeTokens: themeTokens
                ))
            }
            for chip in ports {
                stack.addArrangedSubview(NativeSidebarPortChipView(
                    chip: chip,
                    workspaceID: item.workspaceID,
                    themeTokens: themeTokens
                ))
            }
            return stack
        }()

        var trailing: NSView?
        if let hotkey {
            trailing = NativeSidebarHotkeyChip(hotkey: hotkey, themeTokens: themeTokens)
        }

        [accentBar, disclosure, titleLabel, badge].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }
        for optionalView in [branchLabel, attentionDot, latestLabel, portsStack, trailing] {
            if let optionalView {
                optionalView.translatesAutoresizingMaskIntoConstraints = false
                addSubview(optionalView)
            }
        }

        let hasMetaRow = latestLabel != nil || portsStack != nil
        let titleCenterOffset: CGFloat = hasMetaRow ? -8 : 0
        var constraints = [
            heightAnchor.constraint(equalToConstant: hasMetaRow ? 42 : 28),

            accentBar.leadingAnchor.constraint(equalTo: leadingAnchor),
            accentBar.topAnchor.constraint(equalTo: topAnchor),
            accentBar.bottomAnchor.constraint(equalTo: bottomAnchor),
            accentBar.widthAnchor.constraint(equalToConstant: 2),

            disclosure.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            disclosure.centerYAnchor.constraint(equalTo: centerYAnchor, constant: titleCenterOffset),
            disclosure.widthAnchor.constraint(equalToConstant: 12),

            titleLabel.leadingAnchor.constraint(equalTo: disclosure.trailingAnchor, constant: 4),
            titleLabel.centerYAnchor.constraint(equalTo: centerYAnchor, constant: titleCenterOffset),

            badge.centerYAnchor.constraint(equalTo: centerYAnchor, constant: titleCenterOffset),
            badge.widthAnchor.constraint(greaterThanOrEqualToConstant: 18),
            badge.heightAnchor.constraint(equalToConstant: 14)
        ]

        // Title-line chain: name → branch chip → attention dot → badge.
        var titleLineTrailingAnchor = titleLabel.trailingAnchor
        if let branchLabel {
            constraints += [
                branchLabel.leadingAnchor.constraint(equalTo: titleLineTrailingAnchor, constant: 6),
                branchLabel.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor)
            ]
            titleLineTrailingAnchor = branchLabel.trailingAnchor
        }
        if let attentionDot {
            constraints += [
                attentionDot.leadingAnchor.constraint(equalTo: titleLineTrailingAnchor, constant: 6),
                attentionDot.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor)
            ]
            titleLineTrailingAnchor = attentionDot.trailingAnchor
        }
        constraints.append(badge.leadingAnchor.constraint(greaterThanOrEqualTo: titleLineTrailingAnchor, constant: 8))

        // Meta row: latest-notification line (leading) + port chips (trailing).
        if let latestLabel {
            constraints += [
                latestLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 30),
                latestLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 2)
            ]
            if let portsStack {
                constraints.append(latestLabel.trailingAnchor.constraint(lessThanOrEqualTo: portsStack.leadingAnchor, constant: -8))
            } else {
                constraints.append(latestLabel.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -14))
            }
        }
        if let portsStack {
            constraints += [
                portsStack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
                portsStack.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 2)
            ]
        }

        if let trailing {
            constraints += [
                badge.trailingAnchor.constraint(lessThanOrEqualTo: trailing.leadingAnchor, constant: -8),
                trailing.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
                trailing.centerYAnchor.constraint(equalTo: centerYAnchor, constant: titleCenterOffset)
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

/// The PR status chip in the D-045 ws-meta row (`glyph #number`), fed by the
/// server-side `workspace.gitProbe` contract. Tone maps onto theme tokens
/// only (D-041): ok = open/pass + merged, attention = draft/pending,
/// failure = fail/closed.
@MainActor
final class NativeSidebarPullRequestChipView: NSView {
    init(
        chip: WorkspaceIndex.WorkspaceGitPullRequestChip,
        workspaceID: WorkspaceID,
        themeTokens: NativeShellThemeTokens
    ) {
        super.init(frame: .zero)
        let toneColor: NSColor
        switch chip.tone {
        case .ok:
            toneColor = themeTokens.okBadge
        case .attention:
            toneColor = themeTokens.attentionBadge
        case .failure:
            toneColor = themeTokens.failureBadge
        }

        wantsLayer = true
        layer?.borderWidth = 1
        layer?.cornerRadius = 7
        layer?.borderColor = toneColor.withAlphaComponent(0.35).cgColor
        identifier = NSUserInterfaceItemIdentifier("workspace-pr-\(workspaceID.rawValue)-\(chip.number)")
        setAccessibilityLabel(chip.accessibilityLabel)

        let label = NSTextField(labelWithString: "\(chip.glyph) #\(chip.number)")
        label.font = NSFont.monospacedSystemFont(ofSize: 9, weight: .regular)
        label.textColor = toneColor
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

/// A single `:port` chip in the D-045 ws-meta row. Live listeners use the
/// healthy token; stopped entries stay in the muted style — all colors flow
/// through `NativeShellThemeTokens` (D-041).
@MainActor
final class NativeSidebarPortChipView: NSView {
    init(
        chip: NativeSidebarWorkspacePortChip,
        workspaceID: WorkspaceID,
        themeTokens: NativeShellThemeTokens
    ) {
        super.init(frame: .zero)
        wantsLayer = true
        layer?.borderWidth = 1
        layer?.cornerRadius = 7
        layer?.borderColor = chip.isLive
            ? themeTokens.okBadge.withAlphaComponent(0.35).cgColor
            : themeTokens.hairline.cgColor
        identifier = NSUserInterfaceItemIdentifier("workspace-port-\(workspaceID.rawValue)-\(chip.port)")

        let label = NSTextField(labelWithString: ":\(chip.port)")
        label.font = NSFont.monospacedSystemFont(ofSize: 9, weight: .regular)
        label.textColor = chip.isLive ? themeTokens.okBadge : themeTokens.tertiaryText
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

// MARK: - Notifications panel (D-045; fed by D-042/D-043 events)

@MainActor
final class NativeNotificationsPanelView: NSView {
    var onSelectNotification: ((Notifications.NotificationID, PaneID?) -> Void)?
    var onMarkAllRead: (() -> Void)?
    var onJumpToLatestUnread: (() -> Void)?

    private let themeTokens: NativeShellThemeTokens
    private let headerLabel = NSTextField(labelWithString: "")
    private let rowsStack = NSStackView()
    private let markAllReadButton = NSButton(title: "Mark all read", target: nil, action: nil)
    private let jumpButton = NSButton(title: "Jump to latest unread (⌘⇧U)", target: nil, action: nil)
    private let referenceDate: Date

    init(
        feed: [Notifications.WorkspaceNotification],
        unreadCount: Int,
        themeTokens: NativeShellThemeTokens,
        referenceDate: Date = Date()
    ) {
        self.themeTokens = themeTokens
        self.referenceDate = referenceDate
        super.init(frame: .zero)
        build()
        apply(feed: feed, unreadCount: unreadCount)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func apply(feed: [Notifications.WorkspaceNotification], unreadCount: Int) {
        headerLabel.stringValue = unreadCount > 0 ? "\(unreadCount) unread" : "all read"
        headerLabel.textColor = unreadCount > 0 ? themeTokens.attentionBadge : themeTokens.tertiaryText
        jumpButton.isEnabled = unreadCount > 0

        rowsStack.arrangedSubviews.forEach {
            rowsStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        let visible = feed.suffix(12).reversed()
        if visible.isEmpty {
            let empty = NSTextField(labelWithString: "No notifications yet")
            empty.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
            empty.textColor = themeTokens.tertiaryText
            rowsStack.addArrangedSubview(empty)
        }
        for notification in visible {
            let row = NativeNotificationsPanelRow(
                notification: notification,
                themeTokens: themeTokens,
                referenceDate: referenceDate,
                onClick: { [weak self] in
                    self?.onSelectNotification?(notification.id, notification.paneID)
                }
            )
            rowsStack.addArrangedSubview(row)
            row.widthAnchor.constraint(equalTo: rowsStack.widthAnchor).isActive = true
        }
    }

    private func build() {
        headerLabel.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .medium)
        headerLabel.identifier = NSUserInterfaceItemIdentifier("notifications-panel-header")

        rowsStack.orientation = .vertical
        rowsStack.spacing = 2
        rowsStack.alignment = .leading

        for button in [markAllReadButton, jumpButton] {
            button.bezelStyle = .accessoryBarAction
            button.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
            button.contentTintColor = themeTokens.secondaryText
        }
        markAllReadButton.target = self
        markAllReadButton.action = #selector(markAllReadPressed)
        markAllReadButton.identifier = NSUserInterfaceItemIdentifier("notifications-mark-all-read")
        jumpButton.target = self
        jumpButton.action = #selector(jumpPressed)
        jumpButton.identifier = NSUserInterfaceItemIdentifier("notifications-jump-latest-unread")

        let footerStack = NSStackView(views: [markAllReadButton, jumpButton])
        footerStack.orientation = .horizontal
        footerStack.spacing = 8

        [headerLabel, rowsStack, footerStack].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }

        NSLayoutConstraint.activate([
            headerLabel.leadingAnchor.constraint(equalTo: leadingAnchor),
            headerLabel.topAnchor.constraint(equalTo: topAnchor),

            rowsStack.leadingAnchor.constraint(equalTo: leadingAnchor),
            rowsStack.trailingAnchor.constraint(equalTo: trailingAnchor),
            rowsStack.topAnchor.constraint(equalTo: headerLabel.bottomAnchor, constant: 8),

            footerStack.leadingAnchor.constraint(equalTo: leadingAnchor),
            footerStack.topAnchor.constraint(equalTo: rowsStack.bottomAnchor, constant: 10),
            footerStack.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    @objc private func markAllReadPressed() {
        onMarkAllRead?()
    }

    @objc private func jumpPressed() {
        onJumpToLatestUnread?()
    }
}

@MainActor
private final class NativeNotificationsPanelRow: NSView {
    private let onClick: (() -> Void)?

    init(
        notification: Notifications.WorkspaceNotification,
        themeTokens: NativeShellThemeTokens,
        referenceDate: Date,
        onClick: (() -> Void)?
    ) {
        self.onClick = onClick
        super.init(frame: .zero)
        wantsLayer = true
        if !notification.read {
            layer?.backgroundColor = themeTokens.attentionBadge.withAlphaComponent(0.06).cgColor
            layer?.cornerRadius = 5
        }

        let dot = NativeSidebarDotView(
            color: notification.read ? themeTokens.hairline : themeTokens.attentionBadge,
            diameter: 6
        )

        let text: String = {
            if let title = notification.title, !title.isEmpty {
                return "\(title) · \(notification.body)"
            }
            return notification.body
        }()
        let textLabel = NSTextField(labelWithString: text)
        textLabel.font = NSFont.monospacedSystemFont(ofSize: 11, weight: notification.read ? .regular : .medium)
        textLabel.textColor = notification.read ? themeTokens.secondaryText : themeTokens.primaryText
        textLabel.lineBreakMode = .byTruncatingTail
        textLabel.maximumNumberOfLines = 1

        let sourceText = [
            notification.paneID?.rawValue,
            NativeWorkspaceSidebarView.relativeAge(from: notification.timestamp.date, to: referenceDate)
        ].compactMap { $0 }.joined(separator: " · ")
        let sourceLabel = NSTextField(labelWithString: sourceText)
        sourceLabel.font = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
        sourceLabel.textColor = themeTokens.tertiaryText
        sourceLabel.lineBreakMode = .byTruncatingTail

        [dot, textLabel, sourceLabel].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }

        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 26),
            dot.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 6),
            dot.centerYAnchor.constraint(equalTo: centerYAnchor),

            textLabel.leadingAnchor.constraint(equalTo: dot.trailingAnchor, constant: 8),
            textLabel.centerYAnchor.constraint(equalTo: centerYAnchor),
            textLabel.trailingAnchor.constraint(lessThanOrEqualTo: sourceLabel.leadingAnchor, constant: -10),

            sourceLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            sourceLabel.centerYAnchor.constraint(equalTo: centerYAnchor),
            sourceLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 180)
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

// MARK: - Approval feed panel (D-042 agent approval cards)

/// Feed overlay listing pending approval cards. Every card renders its kind
/// icon, hook-provided summary (structured payload only — never terminal
/// content), and option buttons that decide through the server relay; the
/// card leaves the list when the stream's settled event arrives.
@MainActor
final class NativeApprovalFeedPanelView: NSView {
    var onDecideApproval: ((String, String) -> Void)?

    private let themeTokens: NativeShellThemeTokens
    private let headerLabel = NSTextField(labelWithString: "")
    private let cardsStack = NSStackView()

    init(cards: [Notifications.ApprovalFeedCard], themeTokens: NativeShellThemeTokens) {
        self.themeTokens = themeTokens
        super.init(frame: .zero)
        build()
        apply(cards: cards)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func apply(cards: [Notifications.ApprovalFeedCard]) {
        headerLabel.stringValue = cards.isEmpty ? "no pending approvals" : "\(cards.count) pending"
        headerLabel.textColor = cards.isEmpty ? themeTokens.tertiaryText : themeTokens.attentionBadge

        cardsStack.arrangedSubviews.forEach {
            cardsStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        if cards.isEmpty {
            let empty = NSTextField(labelWithString: "Agents will surface permission requests, plan reviews, and questions here.")
            empty.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
            empty.textColor = themeTokens.tertiaryText
            cardsStack.addArrangedSubview(empty)
            return
        }
        for card in cards.suffix(8) {
            let cardView = NativeApprovalFeedCardView(
                card: card,
                themeTokens: themeTokens,
                onDecide: { [weak self] optionID in
                    self?.onDecideApproval?(card.requestID, optionID)
                }
            )
            cardsStack.addArrangedSubview(cardView)
            cardView.widthAnchor.constraint(equalTo: cardsStack.widthAnchor).isActive = true
        }
    }

    private func build() {
        headerLabel.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .medium)
        headerLabel.identifier = NSUserInterfaceItemIdentifier("approvals-panel-header")

        cardsStack.orientation = .vertical
        cardsStack.spacing = 8
        cardsStack.alignment = .leading

        [headerLabel, cardsStack].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }

        NSLayoutConstraint.activate([
            headerLabel.leadingAnchor.constraint(equalTo: leadingAnchor),
            headerLabel.topAnchor.constraint(equalTo: topAnchor),

            cardsStack.leadingAnchor.constraint(equalTo: leadingAnchor),
            cardsStack.trailingAnchor.constraint(equalTo: trailingAnchor),
            cardsStack.topAnchor.constraint(equalTo: headerLabel.bottomAnchor, constant: 8),
            cardsStack.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }
}

@MainActor
private final class NativeApprovalFeedCardView: NSView {
    private let onDecide: (String) -> Void
    private let optionIDsByButton: [NSUserInterfaceItemIdentifier: String]

    init(
        card: Notifications.ApprovalFeedCard,
        themeTokens: NativeShellThemeTokens,
        onDecide: @escaping (String) -> Void
    ) {
        self.onDecide = onDecide
        var optionIDs: [NSUserInterfaceItemIdentifier: String] = [:]
        for option in card.options {
            optionIDs[NSUserInterfaceItemIdentifier("approval-option-\(card.requestID)-\(option.id)")] = option.id
        }
        optionIDsByButton = optionIDs
        super.init(frame: .zero)
        identifier = NSUserInterfaceItemIdentifier("approval-card-\(card.requestID)")
        wantsLayer = true
        layer?.backgroundColor = themeTokens.attentionBadge.withAlphaComponent(0.06).cgColor
        layer?.borderColor = themeTokens.hairline.cgColor
        layer?.borderWidth = 1
        layer?.cornerRadius = 6

        let icon = NSImageView()
        icon.image = NSImage(systemSymbolName: card.kind.symbolName, accessibilityDescription: card.kind.displayName)
        icon.contentTintColor = themeTokens.attentionBadge

        let summaryLabel = NSTextField(labelWithString: card.summary)
        summaryLabel.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        summaryLabel.textColor = themeTokens.primaryText
        summaryLabel.lineBreakMode = .byTruncatingTail
        summaryLabel.maximumNumberOfLines = 2

        let metaLabel = NSTextField(labelWithString: "\(card.kind.displayName) · \(card.agentID)")
        metaLabel.font = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
        metaLabel.textColor = themeTokens.tertiaryText
        metaLabel.lineBreakMode = .byTruncatingTail

        let buttonsStack = NSStackView()
        buttonsStack.orientation = .horizontal
        buttonsStack.spacing = 6
        for option in card.options.prefix(4) {
            let button = NSButton(title: option.label, target: self, action: #selector(optionPressed(_:)))
            button.bezelStyle = .accessoryBarAction
            button.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
            button.contentTintColor = themeTokens.secondaryText
            button.identifier = NSUserInterfaceItemIdentifier("approval-option-\(card.requestID)-\(option.id)")
            buttonsStack.addArrangedSubview(button)
        }

        [icon, summaryLabel, metaLabel, buttonsStack].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }

        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            icon.topAnchor.constraint(equalTo: topAnchor, constant: 10),
            icon.widthAnchor.constraint(equalToConstant: 16),
            icon.heightAnchor.constraint(equalToConstant: 16),

            summaryLabel.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 8),
            summaryLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            summaryLabel.topAnchor.constraint(equalTo: topAnchor, constant: 8),

            metaLabel.leadingAnchor.constraint(equalTo: summaryLabel.leadingAnchor),
            metaLabel.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -10),
            metaLabel.topAnchor.constraint(equalTo: summaryLabel.bottomAnchor, constant: 2),

            buttonsStack.leadingAnchor.constraint(equalTo: summaryLabel.leadingAnchor),
            buttonsStack.topAnchor.constraint(equalTo: metaLabel.bottomAnchor, constant: 6),
            buttonsStack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -8)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    @objc private func optionPressed(_ sender: NSButton) {
        guard let identifier = sender.identifier,
              let optionID = optionIDsByButton[identifier]
        else {
            return
        }
        onDecide(optionID)
    }
}

// MARK: - Manage scripts panel (D-045 run-script dropdown "Manage scripts…")

@MainActor
final class NativeManageScriptsPanelView: NSView {
    var onAddScript: ((String, String) -> Void)?
    var onRemoveScript: ((Settings.ScriptID) -> Void)?

    private let themeTokens: NativeShellThemeTokens
    private let rowsStack = NSStackView()
    private let nameField = NSTextField(string: "")
    private let commandField = NSTextField(string: "")
    private let addButton = NSButton(title: "Add script", target: nil, action: nil)

    init(scripts: [Settings.ScriptDefinition], themeTokens: NativeShellThemeTokens) {
        self.themeTokens = themeTokens
        super.init(frame: .zero)
        build()
        apply(scripts: scripts)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func apply(scripts: [Settings.ScriptDefinition]) {
        rowsStack.arrangedSubviews.forEach {
            rowsStack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
        if scripts.isEmpty {
            let empty = NSTextField(labelWithString: "No scripts yet — add one below")
            empty.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
            empty.textColor = themeTokens.tertiaryText
            rowsStack.addArrangedSubview(empty)
        }
        for script in scripts {
            let row = NSStackView()
            row.orientation = .horizontal
            row.spacing = 8

            let kindLabel = NSTextField(labelWithString: script.kind.rawValue)
            kindLabel.font = NSFont.monospacedSystemFont(ofSize: 9.5, weight: .medium)
            kindLabel.textColor = script.kind == .run ? themeTokens.okBadge : themeTokens.tertiaryText

            let nameLabel = NSTextField(labelWithString: script.name)
            nameLabel.font = NSFont.monospacedSystemFont(ofSize: 11.5, weight: .medium)
            nameLabel.textColor = themeTokens.primaryText
            nameLabel.lineBreakMode = .byTruncatingTail

            let commandLabel = NSTextField(labelWithString: script.command)
            commandLabel.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
            commandLabel.textColor = themeTokens.secondaryText
            commandLabel.lineBreakMode = .byTruncatingTail

            let removeButton = NSButton(title: "Remove", target: self, action: #selector(removeScriptPressed(_:)))
            removeButton.bezelStyle = .accessoryBarAction
            removeButton.font = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
            removeButton.identifier = NSUserInterfaceItemIdentifier("manage-scripts-remove-\(script.id.rawValue)")
            (removeButton.cell as? NSButtonCell)?.representedObject = script.id.rawValue

            row.addArrangedSubview(kindLabel)
            row.addArrangedSubview(nameLabel)
            row.addArrangedSubview(commandLabel)
            row.addArrangedSubview(removeButton)
            rowsStack.addArrangedSubview(row)
            row.widthAnchor.constraint(equalTo: rowsStack.widthAnchor).isActive = true
        }
    }

    private func build() {
        rowsStack.orientation = .vertical
        rowsStack.spacing = 6
        rowsStack.alignment = .leading

        nameField.placeholderString = "Script name"
        nameField.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        nameField.identifier = NSUserInterfaceItemIdentifier("manage-scripts-name-field")
        commandField.placeholderString = "Command (runs in a tmux pane)"
        commandField.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        commandField.identifier = NSUserInterfaceItemIdentifier("manage-scripts-command-field")

        addButton.bezelStyle = .accessoryBarAction
        addButton.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
        addButton.target = self
        addButton.action = #selector(addScriptPressed)
        addButton.identifier = NSUserInterfaceItemIdentifier("manage-scripts-add")

        let formStack = NSStackView(views: [nameField, commandField, addButton])
        formStack.orientation = .horizontal
        formStack.spacing = 8

        [rowsStack, formStack].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }

        NSLayoutConstraint.activate([
            rowsStack.leadingAnchor.constraint(equalTo: leadingAnchor),
            rowsStack.trailingAnchor.constraint(equalTo: trailingAnchor),
            rowsStack.topAnchor.constraint(equalTo: topAnchor),

            formStack.leadingAnchor.constraint(equalTo: leadingAnchor),
            formStack.trailingAnchor.constraint(equalTo: trailingAnchor),
            formStack.topAnchor.constraint(equalTo: rowsStack.bottomAnchor, constant: 12),
            formStack.bottomAnchor.constraint(equalTo: bottomAnchor),

            nameField.widthAnchor.constraint(greaterThanOrEqualToConstant: 120),
            commandField.widthAnchor.constraint(greaterThanOrEqualToConstant: 220)
        ])
    }

    @objc private func addScriptPressed() {
        let name = nameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let command = commandField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !command.isEmpty else {
            return
        }
        onAddScript?(name.isEmpty ? "Custom" : name, command)
        nameField.stringValue = ""
        commandField.stringValue = ""
    }

    @objc private func removeScriptPressed(_ sender: NSButton) {
        guard let rawValue = (sender.cell as? NSButtonCell)?.representedObject as? String else {
            return
        }
        onRemoveScript?(Settings.ScriptID(rawValue: rawValue))
    }
}

// MARK: - D-028 keymap confirmation / rename prompts

/// Themed confirmation panel for destructive keymap actions (`kill-pane`,
/// `kill-window` wrapped in `confirm-before`). Never an NSAlert: it renders
/// inside the workspace overlay host with theme tokens.
@MainActor
final class NativeTmuxKeymapConfirmPanelView: NSView {
    var onConfirm: (() -> Void)?
    var onCancel: (() -> Void)?

    private let themeTokens: NativeShellThemeTokens

    init(message: String, confirmTitle: String, themeTokens: NativeShellThemeTokens) {
        self.themeTokens = themeTokens
        super.init(frame: .zero)
        build(message: message, confirmTitle: confirmTitle)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    private func build(message: String, confirmTitle: String) {
        let messageLabel = NSTextField(labelWithString: message)
        messageLabel.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        messageLabel.textColor = themeTokens.primaryText
        messageLabel.lineBreakMode = .byWordWrapping
        messageLabel.maximumNumberOfLines = 3

        let confirmButton = NSButton(title: confirmTitle, target: self, action: #selector(confirmPressed))
        confirmButton.bezelStyle = .accessoryBarAction
        confirmButton.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        confirmButton.contentTintColor = themeTokens.failureBadge
        confirmButton.identifier = NSUserInterfaceItemIdentifier("keymap-confirm-accept")
        confirmButton.keyEquivalent = "\r"

        let cancelButton = NSButton(title: "Cancel", target: self, action: #selector(cancelPressed))
        cancelButton.bezelStyle = .accessoryBarAction
        cancelButton.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        cancelButton.identifier = NSUserInterfaceItemIdentifier("keymap-confirm-cancel")

        let buttonsRow = NSStackView(views: [cancelButton, confirmButton])
        buttonsRow.orientation = .horizontal
        buttonsRow.spacing = 10

        [messageLabel, buttonsRow].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }

        NSLayoutConstraint.activate([
            messageLabel.leadingAnchor.constraint(equalTo: leadingAnchor),
            messageLabel.trailingAnchor.constraint(equalTo: trailingAnchor),
            messageLabel.topAnchor.constraint(equalTo: topAnchor),

            buttonsRow.trailingAnchor.constraint(equalTo: trailingAnchor),
            buttonsRow.topAnchor.constraint(equalTo: messageLabel.bottomAnchor, constant: 14),
            buttonsRow.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    @objc private func confirmPressed() {
        onConfirm?()
    }

    @objc private func cancelPressed() {
        onCancel?()
    }
}

/// Themed single-field prompt for the D-028 `rename-window` keymap action.
/// A key binding cannot carry the final name, so the native surface always
/// prompts and dispatches the typed rename RPC on submit.
@MainActor
final class NativeTmuxKeymapRenamePanelView: NSView {
    var onSubmit: ((String) -> Void)?
    var onCancel: (() -> Void)?

    private let themeTokens: NativeShellThemeTokens
    private let nameField = NSTextField(string: "")

    init(currentName: String, themeTokens: NativeShellThemeTokens) {
        self.themeTokens = themeTokens
        super.init(frame: .zero)
        build(currentName: currentName)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func focusField(in window: NSWindow?) {
        window?.makeFirstResponder(nameField)
        nameField.currentEditor()?.selectAll(nil)
    }

    func submittedName() -> String {
        nameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func build(currentName: String) {
        nameField.stringValue = currentName
        nameField.placeholderString = "Window name"
        nameField.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        nameField.identifier = NSUserInterfaceItemIdentifier("keymap-rename-field")
        nameField.target = self
        nameField.action = #selector(submitPressed)

        let renameButton = NSButton(title: "Rename", target: self, action: #selector(submitPressed))
        renameButton.bezelStyle = .accessoryBarAction
        renameButton.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        renameButton.contentTintColor = themeTokens.accent
        renameButton.identifier = NSUserInterfaceItemIdentifier("keymap-rename-submit")

        let cancelButton = NSButton(title: "Cancel", target: self, action: #selector(cancelPressed))
        cancelButton.bezelStyle = .accessoryBarAction
        cancelButton.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        cancelButton.identifier = NSUserInterfaceItemIdentifier("keymap-rename-cancel")

        let buttonsRow = NSStackView(views: [cancelButton, renameButton])
        buttonsRow.orientation = .horizontal
        buttonsRow.spacing = 10

        [nameField, buttonsRow].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }

        NSLayoutConstraint.activate([
            nameField.leadingAnchor.constraint(equalTo: leadingAnchor),
            nameField.trailingAnchor.constraint(equalTo: trailingAnchor),
            nameField.topAnchor.constraint(equalTo: topAnchor),
            nameField.widthAnchor.constraint(greaterThanOrEqualToConstant: 260),

            buttonsRow.trailingAnchor.constraint(equalTo: trailingAnchor),
            buttonsRow.topAnchor.constraint(equalTo: nameField.bottomAnchor, constant: 12),
            buttonsRow.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    @objc private func submitPressed() {
        let name = submittedName()
        guard !name.isEmpty else {
            return
        }
        onSubmit?(name)
    }

    @objc private func cancelPressed() {
        onCancel?()
    }
}
