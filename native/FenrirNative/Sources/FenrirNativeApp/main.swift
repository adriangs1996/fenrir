import AppKit
import AgentIntegration
import AgentInteraction
import AuthSession
import ClientControl
import CryptoKit
import Diagnostics
import FenrirNativeShared
import Keybinding
import NativeDistribution
import NativeRuntime
import NeovimBridge
import Notifications
import PaneGrid
import ServerConnection
import Settings
import TerminalViewport
import WorkspaceCoordinator
import WorkspaceIndex
import WorkspaceOverlays
import WorkflowControl

NativeCrashReporter.install()
let app = NSApplication.shared
let nativeApplicationDelegate = FenrirNativeApplication()
app.delegate = nativeApplicationDelegate
app.setActivationPolicy(.regular)
app.run()

struct NativeShellThemeTokens {
    let themeID: Settings.ThemeID
    let rootBackground: NSColor
    let sidebarBackground: NSColor
    let toolbarBackground: NSColor
    let terminalBackground: NSColor
    let overlayScrim: NSColor
    let overlayBackground: NSColor
    let overlayBorder: NSColor
    let hairline: NSColor
    let primaryText: NSColor
    let secondaryText: NSColor
    let tertiaryText: NSColor
    let accent: NSColor
    let selectedRowBackground: NSColor
    let selectedRowText: NSColor
    let attentionBadge: NSColor
    let okBadge: NSColor
    let failureBadge: NSColor
    let workflowBadge: NSColor
    let transparent: NSColor

    var panelBackground: NSColor { toolbarBackground }

    static func resolve(_ themeID: Settings.ThemeID) -> NativeShellThemeTokens {
        switch themeID {
        case .fenrirDark:
            return NativeShellThemeTokens(themeID: themeID, root: 0x0A0F16, sidebar: 0x0B111A, toolbar: 0x0D141E, terminal: 0x070B10, overlay: 0x0D141E, border: 0x1A2432, primary: 0xC3CDD9, secondary: 0x8B99A9, tertiary: 0x566677, accent: 0x3FB8AF, attention: 0xF0B429, ok: 0x4CC38A, failure: 0xE5534B, workflow: 0x9D7BD8)
        case .pierreDark:
            return NativeShellThemeTokens(themeID: themeID, root: 0x101112, sidebar: 0x131312, toolbar: 0x161615, terminal: 0x0B0B0B, overlay: 0x161615, border: 0x2A2925, primary: 0xF0EDE4, secondary: 0xB8B1A3, tertiary: 0x7C766B, accent: 0xD5B778, attention: 0xE0B15E, ok: 0x86B380, failure: 0xF07178, workflow: 0x82AAFF)
        case .pierreDarkSoft:
            return NativeShellThemeTokens(themeID: themeID, root: 0x171717, sidebar: 0x101010, toolbar: 0x101010, terminal: 0x101010, overlay: 0x101010, border: 0x262626, primary: 0xD4D4D4, secondary: 0xB8B8B8, tertiary: 0x8A8A8A, accent: 0x69B1FF, attention: 0xFFD452, ok: 0x60D199, failure: 0xFF6762, workflow: 0xBA8FFD)
        case .catppuccinMocha:
            return NativeShellThemeTokens(themeID: themeID, root: 0x11111B, sidebar: 0x181825, toolbar: 0x1E1E2E, terminal: 0x0B0B14, overlay: 0x1E1E2E, border: 0x313244, primary: 0xCDD6F4, secondary: 0xA6ADC8, tertiary: 0x6C7086, accent: 0xCBA6F7, attention: 0xF9E2AF, ok: 0xA6E3A1, failure: 0xF38BA8, workflow: 0xB4BEFE)
        case .rosePine:
            return NativeShellThemeTokens(themeID: themeID, root: 0x191724, sidebar: 0x1B192A, toolbar: 0x1F1D2E, terminal: 0x12101B, overlay: 0x1F1D2E, border: 0x403D52, primary: 0xE0DEF4, secondary: 0x908CAA, tertiary: 0x6E6A86, accent: 0x9CCFD8, attention: 0xF6C177, ok: 0x95B1AC, failure: 0xEB6F92, workflow: 0xC4A7E7)
        case .kanagawa:
            return NativeShellThemeTokens(themeID: themeID, root: 0x16161D, sidebar: 0x1A1A22, toolbar: 0x1F1F28, terminal: 0x101016, overlay: 0x1F1F28, border: 0x2F2F3D, primary: 0xDCD7BA, secondary: 0xC8C093, tertiary: 0x727169, accent: 0x7E9CD8, attention: 0xE6C384, ok: 0x98BB6C, failure: 0xC34043, workflow: 0x957FB8)
        case .kanagawaDragon:
            return NativeShellThemeTokens(themeID: themeID, root: 0x181616, sidebar: 0x181616, toolbar: 0x0D0C0C, terminal: 0x0D0C0C, overlay: 0x282727, border: 0x393836, primary: 0xC5C9C5, secondary: 0xC8C093, tertiary: 0x737C73, accent: 0x8BA4B0, attention: 0xC4B28A, ok: 0x8A9A7B, failure: 0xC34043, workflow: 0xA292A3)
        case .tokyoNightMoon:
            return NativeShellThemeTokens(themeID: themeID, root: 0x1E2030, sidebar: 0x1B1D2D, toolbar: 0x222436, terminal: 0x16182A, overlay: 0x222436, border: 0x2F334D, primary: 0xC8D3F5, secondary: 0xA9B1D6, tertiary: 0x636DA6, accent: 0x82AAFF, attention: 0xFFC777, ok: 0xC3E88D, failure: 0xFF757F, workflow: 0xC099FF)
        case .nord:
            return NativeShellThemeTokens(themeID: themeID, root: 0x242933, sidebar: 0x272C37, toolbar: 0x2E3440, terminal: 0x1D222C, overlay: 0x2E3440, border: 0x3B4252, primary: 0xD8DEE9, secondary: 0xAEB8C9, tertiary: 0x616E88, accent: 0x88C0D0, attention: 0xEBCB8B, ok: 0xA3BE8C, failure: 0xBF616A, workflow: 0xB48EAD)
        }
    }

    private init(
        themeID: Settings.ThemeID,
        root: UInt32,
        sidebar: UInt32,
        toolbar: UInt32,
        terminal: UInt32,
        overlay: UInt32,
        border: UInt32,
        primary: UInt32,
        secondary: UInt32,
        tertiary: UInt32,
        accent: UInt32,
        attention: UInt32,
        ok: UInt32,
        failure: UInt32,
        workflow: UInt32
    ) {
        self.themeID = themeID
        rootBackground = Self.color(root)
        sidebarBackground = Self.color(sidebar)
        toolbarBackground = Self.color(toolbar)
        terminalBackground = Self.color(terminal)
        overlayScrim = Self.color(0x000000, alpha: 0.55)
        overlayBackground = Self.color(overlay)
        overlayBorder = Self.color(border)
        hairline = Self.color(border)
        primaryText = Self.color(primary)
        secondaryText = Self.color(secondary)
        tertiaryText = Self.color(tertiary)
        self.accent = Self.color(accent)
        selectedRowBackground = Self.color(accent, alpha: 0.14)
        selectedRowText = Self.color(primary)
        attentionBadge = Self.color(attention)
        okBadge = Self.color(ok)
        failureBadge = Self.color(failure)
        workflowBadge = Self.color(workflow)
        transparent = Self.color(0x000000, alpha: 0)
    }

    private static func color(_ rgb: UInt32, alpha: CGFloat = 1) -> NSColor {
        NSColor(
            calibratedRed: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: alpha
        )
    }
}

struct NativeSettingsClock: Settings.SettingsClock {
    func now() -> FenrirTimestamp { FenrirTimestamp(Date()) }
}

enum NativeShellThemeSettings {
    static func resolveThemeTokens(
        persistence: (any Settings.LocalSettingsPersistence)? = nil,
        makePersistence: @Sendable () throws -> any Settings.LocalSettingsPersistence = {
            try Settings.applicationSupportSettingsPersistence()
        },
        clock: any Settings.SettingsClock = NativeSettingsClock()
    ) async -> NativeShellThemeTokens {
        do {
            let resolvedPersistence: any Settings.LocalSettingsPersistence
            if let persistence {
                resolvedPersistence = persistence
            } else {
                resolvedPersistence = try makePersistence()
            }
            let result = await Settings.ReadSettings(
                clock: clock,
                persistence: resolvedPersistence
            )
            .run(Settings.ReadSettingsInput(
                requestID: "native-shell-theme-settings-read",
                source: .nativeHost
            ))
            switch result {
            case .success(let settings):
                return .resolve(settings.configuration.appearance.themeID)
            case .failure:
                return .resolve(Settings.NativeSettingsConfiguration.defaults.appearance.themeID)
            }
        } catch {
            return .resolve(Settings.NativeSettingsConfiguration.defaults.appearance.themeID)
        }
    }
}

@MainActor
final class FenrirNativeApplication: NSObject, NSApplicationDelegate {
    private let bootstrapCoordinator: NativeApplicationBootstrapCoordinator
    private let terminationBridge: NativeApplicationTerminationBridge
    private var startupTask: Task<NativeApplicationStartupSnapshot, Never>?

    override init() {
        bootstrapCoordinator = NativeApplicationBootstrapCoordinator()
        terminationBridge = NativeApplicationTerminationBridge(
            terminate: { coordinator, startupTask in
                await coordinator.terminate(waitingFor: startupTask)
            },
            replyToApplicationShouldTerminate: { shouldTerminate in
                NSApp.reply(toApplicationShouldTerminate: shouldTerminate)
            }
        )
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        startupTask = bootstrapCoordinator.startTask()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        terminationBridge.requestTermination(
            coordinator: bootstrapCoordinator,
            waitingFor: startupTask
        )
    }

    func applicationWillTerminate(_ notification: Notification) {
        terminationBridge.markApplicationWillTerminate()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

enum NativeCrashReporter {
    static func install() {
        NSSetUncaughtExceptionHandler { exception in
            _ = Diagnostics.recordNativeCrashReport(
                exceptionName: exception.name.rawValue,
                reason: exception.reason,
                callStackSymbols: exception.callStackSymbols
            )
        }
    }
}

struct NativeAgentPresenceOSCForwarder: TerminalViewport.TerminalReservedOSCForwarding {
    let ingestAgentPresenceSignal: AgentIntegration.IngestAgentPresenceSignal
    /// Receives every stored presence event (with provenance) so the shell
    /// can refresh presence projections and, for session-start events with a
    /// session id, persist D-044 resumability metadata.
    let onPresenceStored: (@Sendable (AgentIntegration.AgentPresenceEvent) async -> Void)?

    init(
        ingestAgentPresenceSignal: AgentIntegration.IngestAgentPresenceSignal,
        onPresenceStored: (@Sendable (AgentIntegration.AgentPresenceEvent) async -> Void)? = nil
    ) {
        self.ingestAgentPresenceSignal = ingestAgentPresenceSignal
        self.onPresenceStored = onPresenceStored
    }

    func forwardReservedOSC(_ signal: TerminalViewport.ReservedOSCSignal) async throws {
        let provenance = AgentIntegration.AgentPresenceProvenance(
            workspaceID: signal.provenance.workspaceID,
            tabID: signal.provenance.tabID,
            paneID: signal.provenance.paneID,
            viewportID: signal.provenance.viewportID,
            kind: .terminalViewportForwardedOSC
        )
        let agentSignal = AgentIntegration.AgentPresenceSignal(
            oscIdentifier: signal.oscIdentifier,
            payload: signal.payload,
            provenance: provenance
        )
        let result = await ingestAgentPresenceSignal.run(AgentIntegration.IngestAgentPresenceSignalInput(
            requestID: RequestID(rawValue: "agent-presence-osc-\(signal.provenance.viewportID.rawValue)-\(signal.provenance.sequence)"),
            signal: agentSignal,
            source: .terminalViewport
        ))
        if case .success(let output) = result, output.stored, let event = output.event {
            await onPresenceStored?(event)
        }
    }
}

/// Routing seam for D-043 generic terminal notifications: the workspace window
/// registry resolves the provenance workspace to its shell controller so the
/// notification lands in that workspace's attention model.
@MainActor
protocol NativeWorkspaceNotificationRouting: AnyObject {
    func routeWorkspaceNotification(
        workspaceID: WorkspaceID,
        title: String?,
        body: String,
        paneID: PaneID?,
        source: Notifications.WorkspaceNotificationSource
    )
}

/// D-043 wiring: generic terminal notifications (OSC 9 / OSC 99 / OSC
/// 777;notify) stripped by `TerminalViewport` flow into the Notifications
/// model with workspace/pane provenance. Mirrors
/// `NativeAgentPresenceOSCForwarder`; forwarding is advisory and never fails
/// terminal ingestion (the action swallows forwarder errors).
struct NativeWorkspaceTerminalNotificationForwarder: TerminalViewport.TerminalNotificationForwarding {
    let resolveRouter: @MainActor @Sendable () -> (any NativeWorkspaceNotificationRouting)?

    init(resolveRouter: @escaping @MainActor @Sendable () -> (any NativeWorkspaceNotificationRouting)?) {
        self.resolveRouter = resolveRouter
    }

    func forwardTerminalNotification(_ event: TerminalViewport.TerminalNotificationEvent) async throws {
        await MainActor.run {
            resolveRouter()?.routeWorkspaceNotification(
                workspaceID: event.provenance.workspaceID,
                title: event.title,
                body: event.body,
                paneID: event.provenance.paneID,
                source: .terminalOSC
            )
        }
    }
}

actor NativeAppTerminalViewportStore: TerminalViewport.TerminalViewportStore {
    private var states: [ViewportID: TerminalViewport.State] = [:]

    func loadViewport(viewportID: ViewportID) async throws -> TerminalViewport.State? {
        states[viewportID]
    }

    func saveViewport(_ state: TerminalViewport.State) async throws {
        states[state.viewportID] = state
    }

    func deleteViewport(viewportID: ViewportID) async throws {
        states[viewportID] = nil
    }
}

struct NativeTerminalViewportClock: TerminalViewport.TerminalViewportClock {
    func now() -> FenrirTimestamp { FenrirTimestamp(Date()) }
}

struct NativeAgentIntegrationClock: AgentIntegration.AgentIntegrationClock {
    func now() -> FenrirTimestamp { FenrirTimestamp(Date()) }
}

protocol NativeAgentIntegrationCommandHandling: Sendable {
    func handle(_ input: NativeHostDiagnosticsInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError>
}

struct NativeAgentIntegrationCommandController: NativeAgentIntegrationCommandHandling, Sendable {
    private let detector: any AgentIntegration.AgentIntegrationDetecting
    private let installer: any AgentIntegration.AgentIntegrationInstalling
    private let clock: any AgentIntegration.AgentIntegrationClock

    init(
        detector: any AgentIntegration.AgentIntegrationDetecting = AgentIntegration.pathAgentIntegrationDetector(),
        installer: (any AgentIntegration.AgentIntegrationInstalling)? = nil,
        clock: any AgentIntegration.AgentIntegrationClock = NativeAgentIntegrationClock()
    ) {
        self.detector = detector
        self.clock = clock
        self.installer = installer ?? AgentIntegration.providerStructuredAgentIntegrationProvisioner(
            configStore: AgentIntegration.LocalAgentIntegrationConfigFileStore(),
            clock: clock
        )
    }

    func handle(_ input: NativeHostDiagnosticsInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError> {
        switch input.operation {
        case "agent-integration-status":
            return await status(input)
        case "agent-integration-repair":
            return await provision(input, resultKind: "AgentIntegrationRepaired") { request in
                await AgentIntegration.InstallAgentIntegration(installer: installer).run(request)
            }
        case "agent-integration-remove":
            return await remove(input)
        default:
            return .failure(.decodeError)
        }
    }

    private func status(_ input: NativeHostDiagnosticsInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError> {
        if let rawAgentID = input.agentID {
            guard let agentID = parseAgentID(rawAgentID) else { return .failure(.decodeError) }
            let action = AgentIntegration.GetAgentIntegrationStatus(detector: detector, clock: clock)
            switch await action.run(AgentIntegration.GetAgentIntegrationStatusInput(
                requestID: input.requestID,
                agentID: agentID,
                source: .nativeHost
            )) {
            case .success(let result):
                return .success(NativeHostProductCommandResult(
                    requestID: input.requestID,
                    resultKind: "AgentIntegrationStatus",
                    payload: payload(for: result.status)
                ))
            case .failure(let error):
                return .failure(clientControlError(for: error))
            }
        }

        let action = AgentIntegration.DetectAgentIntegrations(detector: detector, clock: clock)
        switch await action.run(AgentIntegration.DetectAgentIntegrationsInput(
            requestID: input.requestID,
            source: .nativeHost
        )) {
        case .success(let result):
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: "AgentIntegrationStatuses",
                payload: payload(for: result.statuses)
            ))
        case .failure(let error):
            return .failure(clientControlError(for: error))
        }
    }

    private func remove(_ input: NativeHostDiagnosticsInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError> {
        await provision(input, resultKind: "AgentIntegrationRemoved") { request in
            await AgentIntegration.RemoveAgentIntegration(installer: installer).run(request)
        }
    }

    private func provision(
        _ input: NativeHostDiagnosticsInput,
        resultKind: String,
        operation: (AgentIntegration.AgentProvisioningRequest) async -> Result<AgentIntegration.AgentProvisioningResult, AgentIntegration.AgentIntegrationError>
    ) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError> {
        guard let rawAgentID = input.agentID,
              let agentID = parseAgentID(rawAgentID)
        else {
            return .failure(.decodeError)
        }
        let request = AgentIntegration.AgentProvisioningRequest(
            requestID: input.requestID,
            agentID: agentID,
            workspaceID: input.workspaceID,
            targetVersion: "1.0.0",
            source: .nativeHost
        )
        switch await operation(request) {
        case .success(let result):
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: resultKind,
                payload: payload(for: result)
            ))
        case .failure(let error):
            return .failure(clientControlError(for: error))
        }
    }

    private func parseAgentID(_ raw: String) -> AgentIntegration.AgentCLIIdentifier? {
        let normalized = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().replacingOccurrences(of: "_", with: "-")
        switch normalized {
        case "claude", "claude-code", "claudecode":
            return .claudeCode
        case "codex":
            return .codex
        case "cursor":
            return .cursor
        case "opencode", "open-code":
            return .openCode
        default:
            return nil
        }
    }

    private func payload(for result: AgentIntegration.AgentProvisioningResult) -> [String: String] {
        var payload = payload(for: result.status)
        payload["change"] = result.change.rawValue
        return payload
    }

    private func payload(for status: AgentIntegration.AgentIntegrationStatus) -> [String: String] {
        [
            "agentID": status.agent.id.rawValue,
            "displayName": status.agent.displayName,
            "state": status.state.rawValue,
            "expectedVersion": status.expectedVersion.rawValue,
            "installedVersion": status.installedVersion?.rawValue ?? "",
            "detectedExecutablePath": status.detectedExecutablePath ?? "",
            "cliDetected": String(status.detectedExecutablePath != nil)
        ]
    }

    private func payload(for statuses: [AgentIntegration.AgentIntegrationStatus]) -> [String: String] {
        [
            "agentIDs": statuses.map(\.agent.id.rawValue).joined(separator: ","),
            "states": statuses.map { "\($0.agent.id.rawValue)=\($0.state.rawValue)" }.joined(separator: ","),
            "cliDetected": statuses.map { "\($0.agent.id.rawValue)=\($0.detectedExecutablePath != nil)" }.joined(separator: ",")
        ]
    }

    private func clientControlError(for error: AgentIntegration.AgentIntegrationError) -> ClientControl.ClientControlError {
        switch error {
        case .unavailable:
            return .unavailable
        case .unsupportedAgent, .malformedPresence:
            return .decodeError
        case .staleIntegration, .configConflict:
            return .confirmationRequired
        }
    }
}

struct NativeDistributionStartupClock: NativeDistribution.NativeDistributionClock {
    func now() -> FenrirTimestamp { FenrirTimestamp(Date()) }
}

@MainActor
final class NativeTerminalStreamIngestor {
    private let store: NativeAppTerminalViewportStore
    private let clock: any TerminalViewport.TerminalViewportClock
    private let reservedOSCForwarder: (any TerminalViewport.TerminalReservedOSCForwarding)?
    private let notificationForwarder: (any TerminalViewport.TerminalNotificationForwarding)?

    init(
        store: NativeAppTerminalViewportStore,
        clock: any TerminalViewport.TerminalViewportClock = NativeTerminalViewportClock(),
        reservedOSCForwarder: (any TerminalViewport.TerminalReservedOSCForwarding)? = nil,
        notificationForwarder: (any TerminalViewport.TerminalNotificationForwarding)? = nil
    ) {
        self.store = store
        self.clock = clock
        self.reservedOSCForwarder = reservedOSCForwarder
        self.notificationForwarder = notificationForwarder
    }

    func ingestOutput(
        workspaceID: WorkspaceID,
        windowID: FenrirWindowID,
        pane: PaneGrid.PanePresentation,
        streamID: StreamID,
        sequence: UInt64,
        bytes: Data,
        terminalView: FenrirTerminalView
    ) async -> Result<TerminalViewport.IngestTerminalOutputResult, TerminalViewport.TerminalViewportError> {
        do {
            try await ensureAttachedState(workspaceID: workspaceID, windowID: windowID, pane: pane, streamID: streamID)
            let action = TerminalViewport.IngestTerminalOutput(
                store: store,
                rendererWriter: NativeTerminalViewRendererWriter(terminalView: terminalView),
                reservedOSCForwarder: reservedOSCForwarder,
                notificationForwarder: notificationForwarder,
                clock: clock
            )
            return await action.run(TerminalViewport.IngestTerminalOutputInput(
                requestID: RequestID(rawValue: "native-terminal-output-\(pane.viewportID.rawValue)-\(sequence)"),
                viewportID: pane.viewportID,
                paneID: pane.paneID,
                streamID: streamID,
                sequence: sequence,
                bytes: bytes,
                source: .nativeHost
            ))
        } catch let error as TerminalViewport.TerminalViewportError {
            return .failure(error)
        } catch {
            return .failure(.outputApplyFailed)
        }
    }

    private func ensureAttachedState(workspaceID: WorkspaceID, windowID: FenrirWindowID, pane: PaneGrid.PanePresentation, streamID: StreamID) async throws {
        if let existing = try await store.loadViewport(viewportID: pane.viewportID),
           existing.workspaceID == workspaceID,
           existing.tabID == windowID,
           existing.paneID == pane.paneID,
           existing.streamID == streamID,
           existing.streamStatus == .attached,
           existing.rendererStatus == .ready {
            return
        }
        try await store.saveViewport(TerminalViewport.State(
            viewportID: pane.viewportID,
            workspaceID: workspaceID,
            tabID: windowID,
            paneID: pane.paneID,
            streamID: streamID,
            lastAppliedSequence: nil,
            isFocused: pane.isFocused,
            rendererStatus: .ready,
            streamStatus: .attached,
            size: nil,
            pendingReservedOSCSequence: Data()
        ))
    }
}

@MainActor
final class NativeApplicationTerminationBridge {
    typealias Terminate = @MainActor (
        NativeApplicationBootstrapCoordinator,
        Task<NativeApplicationStartupSnapshot, Never>?
    ) async -> NativeApplicationShutdownSnapshot
    typealias ReplyToApplicationShouldTerminate = @MainActor (Bool) -> Void

    private let terminate: Terminate
    private let replyToApplicationShouldTerminate: ReplyToApplicationShouldTerminate
    private var terminationTask: Task<Void, Never>?
    private var hasReplied = false

    init(
        terminate: @escaping Terminate,
        replyToApplicationShouldTerminate: @escaping ReplyToApplicationShouldTerminate
    ) {
        self.terminate = terminate
        self.replyToApplicationShouldTerminate = replyToApplicationShouldTerminate
    }

    func requestTermination(
        coordinator: NativeApplicationBootstrapCoordinator,
        waitingFor startupTask: Task<NativeApplicationStartupSnapshot, Never>?
    ) -> NSApplication.TerminateReply {
        if hasReplied {
            return .terminateNow
        }

        if terminationTask == nil {
            terminationTask = Task { @MainActor in
                _ = await terminate(coordinator, startupTask)
                guard !hasReplied else {
                    return
                }
                hasReplied = true
                replyToApplicationShouldTerminate(true)
            }
        }

        return .terminateLater
    }

    func markApplicationWillTerminate() {
        hasReplied = true
    }
}

enum NativeApplicationStartupMode: Equatable, Sendable {
    case preparedLocalDefault
    case degradedDistributionReadiness
    case degradedLocalDefault(preparationError: ServerConnection.ServerConnectionError)
}

enum NativeApplicationStartupPhase: Equatable, Sendable {
    case idle
    case preparing
    case running(NativeApplicationStartupMode)
    case terminated
}

struct NativeApplicationStartupSnapshot: Equatable, Sendable {
    let phase: NativeApplicationStartupPhase
    let preparationError: ServerConnection.ServerConnectionError?
    let distributionReadinessReport: NativeDistribution.StartupReadinessReport?

    static let idle = NativeApplicationStartupSnapshot(phase: .idle, preparationError: nil, distributionReadinessReport: nil)
}

struct NativeApplicationShutdownSnapshot: Equatable, Sendable {
    let didRequestPreparedLocalServerShutdown: Bool
    let shutdownError: ServerConnection.ServerConnectionError?
}

@MainActor
final class NativeApplicationBootstrapCoordinator {
    typealias PrepareLocalDefault = @Sendable () async -> Result<NativeAppServerConnectionContext, ServerConnection.ServerConnectionError>
    typealias AssessDistributionReadiness = @Sendable () async -> Result<NativeDistribution.StartupReadinessReport, NativeDistribution.DistributionReadinessError>
    typealias FallbackLocalDefault = @MainActor () -> NativeAppServerConnectionContext
    typealias ComposeRuntime = @MainActor (NativeAppServerConnectionContext, Bool, NativeShellThemeTokens) -> NativeApplicationRuntime
    typealias ResolveThemeTokens = @Sendable () async -> NativeShellThemeTokens
    typealias RuntimeHook = @MainActor (NativeApplicationRuntime) -> Void
    typealias ActivateApplication = @MainActor () -> Void
    typealias ShutdownPreparedLocalServer = @Sendable (NativeAppServerConnectionContext) async -> Result<ServerConnection.ShutdownLocalServerResult, ServerConnection.ServerConnectionError>
    typealias LogMessage = @MainActor (String) -> Void

    private let prepareLocalDefault: PrepareLocalDefault
    private let assessDistributionReadiness: AssessDistributionReadiness
    private let fallbackLocalDefault: FallbackLocalDefault
    private let composeRuntime: ComposeRuntime
    private let resolveThemeTokens: ResolveThemeTokens
    private let openInitialWorkspace: RuntimeHook
    private let startClientControlSocket: RuntimeHook
    private let activateApplication: ActivateApplication
    private let shutdownPreparedLocalServer: ShutdownPreparedLocalServer
    private let logMessage: LogMessage

    private(set) var startupSnapshot: NativeApplicationStartupSnapshot = .idle
    private(set) var shutdownSnapshot: NativeApplicationShutdownSnapshot?
    private(set) var runtime: NativeApplicationRuntime?
    private(set) var terminationRequested = false

    init(
        assessDistributionReadiness: @escaping AssessDistributionReadiness = {
            let action = NativeDistribution.AssessStartupReadiness(
                clock: NativeDistributionStartupClock(),
                tmuxChecker: NativeDistribution.pathTmuxDependencyChecker(),
                serverAssetLocator: NativeDistribution.appResourceServerAssetLocator()
            )
            switch await action.run(NativeDistribution.AssessStartupReadinessInput(
                requestID: "native-startup-readiness",
                mode: NativeApplicationBootstrapCoordinator.distributionStartupMode(),
                allowBootstrapRendererFallback: NativeBootstrapTerminalBackend.isExplicitlyAllowed,
                source: .nativeHost
            )) {
            case .success(let result):
                return .success(result.report)
            case .failure(let error):
                return .failure(error)
            }
        },
        prepareLocalDefault: @escaping PrepareLocalDefault = {
            await NativeAppServerConnectionContext.preparedLocalDefault()
        },
        fallbackLocalDefault: @escaping FallbackLocalDefault = {
            NativeAppServerConnectionContext.localDefault()
        },
        resolveThemeTokens: @escaping ResolveThemeTokens = {
            await NativeShellThemeSettings.resolveThemeTokens()
        },
        composeRuntime: @escaping ComposeRuntime = { context, isPreparedLocalDefault, themeTokens in
            NativeApplicationRuntime.live(
                serverConnection: context,
                shouldShutdownPreparedLocalServer: isPreparedLocalDefault,
                themeTokens: themeTokens
            )
        },
        openInitialWorkspace: @escaping RuntimeHook = { runtime in
            runtime.openInitialWorkspace()
        },
        startClientControlSocket: @escaping RuntimeHook = { runtime in
            runtime.startClientControlSocket()
        },
        activateApplication: @escaping ActivateApplication = {
            NSApp.activate(ignoringOtherApps: true)
        },
        shutdownPreparedLocalServer: @escaping ShutdownPreparedLocalServer = { context in
            await context.shutdownPreparedLocalServer()
        },
        logMessage: @escaping LogMessage = { message in
            NSLog("%@", message)
        }
    ) {
        self.prepareLocalDefault = prepareLocalDefault
        self.assessDistributionReadiness = assessDistributionReadiness
        self.fallbackLocalDefault = fallbackLocalDefault
        self.composeRuntime = composeRuntime
        self.resolveThemeTokens = resolveThemeTokens
        self.openInitialWorkspace = openInitialWorkspace
        self.startClientControlSocket = startClientControlSocket
        self.activateApplication = activateApplication
        self.shutdownPreparedLocalServer = shutdownPreparedLocalServer
        self.logMessage = logMessage
    }

    nonisolated static func distributionStartupMode(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        canLaunchDevelopmentServer: Bool? = nil
    ) -> NativeDistribution.StartupMode {
        let hasExternalBootstrapCredential = [
            "FENRIR_NATIVE_BOOTSTRAP_TOKEN",
            "FENRIR_DESKTOP_BOOTSTRAP_TOKEN",
            "FENRIR_BOOTSTRAP_TOKEN"
        ]
            .compactMap { environment[$0]?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .contains { !$0.isEmpty }
        if hasExternalBootstrapCredential {
            return .existingLocalServer
        }
        if canLaunchDevelopmentServer ?? NativeLocalServerSupervisor.canLaunchDevelopmentServer(environment: environment) {
            return .existingLocalServer
        }
        return .localDefault
    }

    func startTask() -> Task<NativeApplicationStartupSnapshot, Never> {
        Task { @MainActor in
            await start()
        }
    }

    func start() async -> NativeApplicationStartupSnapshot {
        startupSnapshot = NativeApplicationStartupSnapshot(phase: .preparing, preparationError: nil, distributionReadinessReport: nil)
        let distributionReadinessReport = await resolveDistributionReadinessReport()

        let context: NativeAppServerConnectionContext
        let shouldShutdownPreparedLocalServer: Bool
        let mode: NativeApplicationStartupMode
        switch await prepareLocalDefault() {
        case .success(let preparedContext):
            if terminationRequested {
                shutdownSnapshot = await shutdownPreparedContext(preparedContext)
                let snapshot = NativeApplicationStartupSnapshot(phase: .terminated, preparationError: nil, distributionReadinessReport: distributionReadinessReport)
                startupSnapshot = snapshot
                return snapshot
            }
            context = preparedContext
            shouldShutdownPreparedLocalServer = true
            mode = distributionReadinessReport?.canStart == false ? .degradedDistributionReadiness : .preparedLocalDefault
        case .failure(let error):
            if terminationRequested {
                let snapshot = NativeApplicationStartupSnapshot(phase: .terminated, preparationError: error, distributionReadinessReport: distributionReadinessReport)
                startupSnapshot = snapshot
                shutdownSnapshot = NativeApplicationShutdownSnapshot(didRequestPreparedLocalServerShutdown: false, shutdownError: nil)
                return snapshot
            }
            logMessage("Fenrir Native failed to prepare local server; continuing with degraded localDefault context: \(error.rawValue)")
            context = fallbackLocalDefault()
            shouldShutdownPreparedLocalServer = false
            mode = .degradedLocalDefault(preparationError: error)
        }

        let themeTokens = await resolveThemeTokens()
        let runtime = composeRuntime(context, shouldShutdownPreparedLocalServer, themeTokens)
        self.runtime = runtime
        openInitialWorkspace(runtime)
        startClientControlSocket(runtime)
        activateApplication()

        let snapshot = NativeApplicationStartupSnapshot(
            phase: .running(mode),
            preparationError: mode.preparationError,
            distributionReadinessReport: distributionReadinessReport
        )
        startupSnapshot = snapshot
        return snapshot
    }

    private func resolveDistributionReadinessReport() async -> NativeDistribution.StartupReadinessReport? {
        switch await assessDistributionReadiness() {
        case .success(let report):
            for diagnostic in report.diagnostics {
                logMessage("Fenrir Native startup diagnostic [\(diagnostic.severity.rawValue)] \(diagnostic.title): \(diagnostic.message) Recovery: \(diagnostic.recoverySuggestion)")
            }
            if !report.canStart {
                logMessage("Fenrir Native startup readiness reported blocking diagnostics; continuing with degraded native shell state.")
            }
            return report
        case .failure(let error):
            logMessage("Fenrir Native startup readiness probe failed: \(String(describing: error))")
            return nil
        }
    }

    func terminate(waitingFor startupTask: Task<NativeApplicationStartupSnapshot, Never>? = nil) async -> NativeApplicationShutdownSnapshot {
        terminationRequested = true

        if runtime == nil, let startupTask {
            _ = await startupTask.value
        }

        if let shutdownSnapshot {
            return shutdownSnapshot
        }

        let snapshot = await shutdownPreparedRuntime()
        shutdownSnapshot = snapshot
        startupSnapshot = NativeApplicationStartupSnapshot(phase: .terminated, preparationError: startupSnapshot.preparationError, distributionReadinessReport: startupSnapshot.distributionReadinessReport)
        return snapshot
    }

    private func shutdownPreparedRuntime() async -> NativeApplicationShutdownSnapshot {
        guard let runtime else {
            startupSnapshot = NativeApplicationStartupSnapshot(phase: .terminated, preparationError: startupSnapshot.preparationError, distributionReadinessReport: startupSnapshot.distributionReadinessReport)
            return NativeApplicationShutdownSnapshot(didRequestPreparedLocalServerShutdown: false, shutdownError: nil)
        }

        runtime.stopClientControlSocket()
        guard runtime.shouldShutdownPreparedLocalServer else {
            return NativeApplicationShutdownSnapshot(didRequestPreparedLocalServerShutdown: false, shutdownError: nil)
        }

        return await shutdownPreparedContext(runtime.serverConnection)
    }

    private func shutdownPreparedContext(_ context: NativeAppServerConnectionContext) async -> NativeApplicationShutdownSnapshot {
        let result = await shutdownPreparedLocalServer(context)
        switch result {
        case .success:
            return NativeApplicationShutdownSnapshot(didRequestPreparedLocalServerShutdown: true, shutdownError: nil)
        case .failure(let error):
            logMessage("Fenrir Native failed to shut down prepared local server: \(error.rawValue)")
            return NativeApplicationShutdownSnapshot(didRequestPreparedLocalServerShutdown: true, shutdownError: error)
        }
    }
}

private extension NativeApplicationStartupMode {
    var preparationError: ServerConnection.ServerConnectionError? {
        switch self {
        case .preparedLocalDefault, .degradedDistributionReadiness:
            nil
        case .degradedLocalDefault(let preparationError):
            preparationError
        }
    }
}

@MainActor
final class NativeApplicationRuntime {
    let serverConnection: NativeAppServerConnectionContext
    let workspaceWindows: NativeWorkspaceWindowRegistry
    let serverEventIntegration: NativeServerEventIntegrationGraph
    let shouldShutdownPreparedLocalServer: Bool
    private let visibleWorkspaceProjector: any NativeVisibleWorkspaceProjecting
    private let initialWorkspaceID: WorkspaceID
    private var clientControlSocketServer: NativeHostLocalCLISocketServer?
    private var serverEventController: NativeHostServerEventController?
    /// D-042: strong reference for the approval banner action router — the
    /// notification-center delegate property is weak.
    private let approvalBannerRouter: NativeApprovalBannerActionRouter?

    init(
        serverConnection: NativeAppServerConnectionContext,
        workspaceWindows: NativeWorkspaceWindowRegistry,
        serverEventIntegration: NativeServerEventIntegrationGraph,
        shouldShutdownPreparedLocalServer: Bool,
        visibleWorkspaceProjector: any NativeVisibleWorkspaceProjecting,
        initialWorkspaceID: WorkspaceID,
        approvalBannerRouter: NativeApprovalBannerActionRouter? = nil
    ) {
        self.serverConnection = serverConnection
        self.workspaceWindows = workspaceWindows
        self.serverEventIntegration = serverEventIntegration
        self.shouldShutdownPreparedLocalServer = shouldShutdownPreparedLocalServer
        self.visibleWorkspaceProjector = visibleWorkspaceProjector
        self.initialWorkspaceID = initialWorkspaceID
        self.approvalBannerRouter = approvalBannerRouter
    }

    static func live(
        serverConnection: NativeAppServerConnectionContext,
        shouldShutdownPreparedLocalServer: Bool,
        themeTokens: NativeShellThemeTokens = .resolve(Settings.NativeSettingsConfiguration.defaults.appearance.themeID),
        visibleWorkspaceProjector overrideVisibleWorkspaceProjector: (any NativeVisibleWorkspaceProjecting)? = nil
    ) -> NativeApplicationRuntime {
        let terminalViewportStore = NativeAppTerminalViewportStore()
        let agentPresenceStore = AgentIntegration.InMemoryAgentPresenceStore()
        let agentPresenceClock = NativeAgentIntegrationClock()
        let workspaceWindowRegistry = NativeWorkspaceWindowRegistryReference()
        let agentPaneMetadataAttacher = serverConnection.agentPaneMetadataAttacher
        let terminalStreamIngestor = NativeTerminalStreamIngestor(
            store: terminalViewportStore,
            reservedOSCForwarder: NativeAgentPresenceOSCForwarder(
                ingestAgentPresenceSignal: AgentIntegration.IngestAgentPresenceSignal(
                    store: agentPresenceStore,
                    clock: agentPresenceClock
                ),
                onPresenceStored: { event in
                    let workspaceID = event.provenance.workspaceID
                    // D-044: session-start presence with a session id attaches
                    // {agentID, sessionID} to the pane record server-side so
                    // resumability survives client restarts. Attach failures
                    // must never break presence projection.
                    if event.state == .sessionStarted,
                       let sessionID = event.sessionID,
                       AgentIntegration.isValidAgentSessionID(sessionID) {
                        do {
                            try await agentPaneMetadataAttacher.attachResumableSessionMetadata(
                                workspaceID: workspaceID,
                                paneID: event.provenance.paneID,
                                agentID: event.agentID,
                                sessionID: sessionID
                            )
                        } catch {
                            NSLog("Fenrir Native agent session metadata attach failed: \(String(describing: error))")
                        }
                    }
                    let result = await AgentIntegration.ListAgentPresence(
                        store: agentPresenceStore,
                        clock: agentPresenceClock
                    )
                    .run(AgentIntegration.ListAgentPresenceInput(
                        requestID: RequestID(rawValue: "native-agent-presence-refresh-\(workspaceID.rawValue)"),
                        workspaceID: workspaceID,
                        source: .terminalViewport
                    ))
                    guard case .success(let presence) = result else {
                        return
                    }
                    await MainActor.run {
                        workspaceWindowRegistry.value?.updateAgentPresence(
                            workspaceID: workspaceID,
                            records: presence.records
                        )
                    }
                }
            ),
            notificationForwarder: NativeWorkspaceTerminalNotificationForwarder(
                resolveRouter: { workspaceWindowRegistry.value }
            )
        )
        let workspaceWindows = NativeWorkspaceWindowRegistry(
            paneGridRuntimeFactory: serverConnection.paneGridRuntimeFactory,
            paneStreamSubscriber: serverConnection.paneStreamSubscriber,
            terminalStreamIngestor: terminalStreamIngestor,
            agentPromptSubmitterFactory: serverConnection.agentPromptSubmitterFactory,
            neovimBridgeControllerFactory: serverConnection.neovimBridgeControllerFactory,
            workflowServerClientFactory: serverConnection.workflowServerClientFactory,
            workflowEventStreamFactory: serverConnection.workflowEventStreamFactory,
            workflowNotificationStore: serverConnection.notificationStore,
            productivityPreferences: NativeShellProductivityPreferencesStore.applicationSupport(),
            scriptPaneRunner: serverConnection.scriptPaneRunner,
            agentSessionResumer: serverConnection.agentSessionResumer,
            editorOpener: .system(),
            notificationsHub: NativeWorkspaceNotificationsHub(),
            localServersEventStream: serverConnection.localServersEventStream,
            vcsStatusProvider: serverConnection.workspaceVcsStatusProvider,
            gitProbeProvider: serverConnection.workspaceGitProbeProvider,
            approvalFeedEventStream: serverConnection.approvalFeedEventStream,
            approvalFeedDecider: serverConnection.approvalFeedDecider,
            themeTokens: themeTokens
        )
        workspaceWindowRegistry.value = workspaceWindows
        let visibleWorkspaceProjector = overrideVisibleWorkspaceProjector ?? makeVisibleWorkspaceProjector(
            serverConnection: serverConnection,
            workspaceWindows: workspaceWindows
        )
        installWorkspaceLayoutRefresher(
            serverConnection: serverConnection,
            workspaceWindows: workspaceWindows,
            workspaceWindowRegistry: workspaceWindowRegistry
        )
        // D-042: approval banner action buttons decide directly through the
        // decide RPC; the settled stream event then clears cards/banners.
        let approvalFeedDecider = serverConnection.approvalFeedDecider
        let approvalBannerRouter = NativeApprovalBannerActionRouter(onDecision: { requestID, optionID in
            Task {
                do {
                    try await approvalFeedDecider.decide(requestID: requestID, optionID: optionID)
                } catch {
                    NSLog("Fenrir Native approval banner decision rejected: \(String(describing: error))")
                }
            }
        })
        approvalBannerRouter.installIfAvailable()
        return NativeApplicationRuntime(
            serverConnection: serverConnection,
            workspaceWindows: workspaceWindows,
            serverEventIntegration: serverConnection.serverEventIntegrationGraph(workspaceWindows: workspaceWindows),
            shouldShutdownPreparedLocalServer: shouldShutdownPreparedLocalServer,
            visibleWorkspaceProjector: visibleWorkspaceProjector,
            initialWorkspaceID: initialLocalWorkspaceID(),
            approvalBannerRouter: approvalBannerRouter
        )
    }

    /// Stable workspace identity derived from the workspace root path
    /// (D-002/D-012 payoff): relaunching the app reattaches the SAME
    /// server-owned tmux session instead of minting a per-launch UUID that
    /// orphans the previous `fenrir-ws-*` session. The projector flow
    /// (ensure/reconnect) already tolerates an existing session — it
    /// reconnects by workspaceID.
    static func initialLocalWorkspaceID(
        workspaceRootPath: String = NativeLocalServerSupervisor.defaultWorkspaceRootURL().path
    ) -> WorkspaceID {
        let canonicalPath = URL(fileURLWithPath: workspaceRootPath)
            .standardizedFileURL
            .resolvingSymlinksInPath()
            .path
        let digest = SHA256.hash(data: Data(canonicalPath.utf8))
        let stableHex = digest.map { String(format: "%02x", $0) }.joined().prefix(16)
        return WorkspaceID(rawValue: "local-workspace-\(stableHex)")
    }

    private static func makeVisibleWorkspaceProjector(
        serverConnection: NativeAppServerConnectionContext,
        workspaceWindows: NativeWorkspaceWindowRegistry
    ) -> any NativeVisibleWorkspaceProjecting {
        NativeServerTmuxVisibleWorkspaceProjector(
            workspaceWindows: workspaceWindows,
            actor: NativeRuntime.RuntimeActorIdentity(
                profileID: "local",
                authSessionID: serverConnection.sessionID.rawValue,
                subject: "native-app"
            ),
            runtime: NativeRuntime.ServerTmuxRuntimeAdapter(transport: NativeServerConnectionRuntimeRPCTransport(
                sessionID: serverConnection.sessionID,
                sendServerRequest: serverConnection.sendServerRequest,
                streamServerRequest: serverConnection.streamServerRequest
            )),
            reconcileLayout: PaneGrid.ReconcileRuntimeLayout(
                store: NativeAppPaneGridStore(),
                viewportHost: NativeAppPaneViewportHost(),
                clock: NativeAppServerConnectionClock()
            )
        )
    }

    /// D-045 run-script liveness: script pane create/close (and a running
    /// script's stream ending) re-enumerates the server-owned tmux layout and
    /// applies it live, so the grid shows the new pane immediately and
    /// `reconcileRunningScript` clears the Stop state when the pane died —
    /// without waiting for a reconnect. Enumerate-only: unlike full workspace
    /// projection this never re-opens or refocuses windows.
    private static func installWorkspaceLayoutRefresher(
        serverConnection: NativeAppServerConnectionContext,
        workspaceWindows: NativeWorkspaceWindowRegistry,
        workspaceWindowRegistry: NativeWorkspaceWindowRegistryReference
    ) {
        let actor = NativeRuntime.RuntimeActorIdentity(
            profileID: "local",
            authSessionID: serverConnection.sessionID.rawValue,
            subject: "native-app"
        )
        let runtime = NativeRuntime.ServerTmuxRuntimeAdapter(transport: NativeServerConnectionRuntimeRPCTransport(
            sessionID: serverConnection.sessionID,
            sendServerRequest: serverConnection.sendServerRequest,
            streamServerRequest: serverConnection.streamServerRequest
        ))
        let reconcileLayout = PaneGrid.ReconcileRuntimeLayout(
            store: NativeAppPaneGridStore(),
            viewportHost: NativeAppPaneViewportHost(),
            clock: NativeAppServerConnectionClock()
        )
        workspaceWindows.setWorkspaceLayoutRefresher { workspaceID in
            do {
                let enumerated = try await runtime.enumerateWorkspaceRuntime(NativeRuntime.EnumerateWorkspaceRuntimeInput(
                    requestID: RequestID(rawValue: "native-layout-refresh-\(workspaceID.rawValue)-\(UUID().uuidString.lowercased())"),
                    workspaceID: workspaceID,
                    actor: actor,
                    source: .workspaceShell
                ))
                guard let snapshot = nativeTmuxLayoutSnapshot(from: enumerated.workspace, panes: enumerated.panes) else {
                    return
                }
                let layout = await reconcileLayout.run(PaneGrid.ReconcileRuntimeLayoutInput(
                    requestID: RequestID(rawValue: "native-layout-refresh-reconcile-\(workspaceID.rawValue)"),
                    snapshot: snapshot,
                    source: .workspaceShell
                ))
                guard case .success(let reconciled) = layout else {
                    return
                }
                await MainActor.run {
                    workspaceWindowRegistry.value?.applyReconnectedLayout(workspaceID: workspaceID, layout: reconciled.state)
                }
            } catch {
                NSLog("Fenrir Native workspace layout refresh failed: \(String(describing: error))")
            }
        }
    }

    func openInitialWorkspace() {
        let workspaceID = initialWorkspaceID
        let workspaceRootPath = NativeLocalServerSupervisor.defaultWorkspaceRootURL().path
        workspaceWindows.openInitialWorkspace(workspaceID: workspaceID, canonicalPath: workspaceRootPath)
        let identity = WorkspaceIndex.WorkspaceIdentity(
            kind: .localPath,
            workspaceID: workspaceID,
            canonicalPath: workspaceRootPath
        )
        Task { [visibleWorkspaceProjector] in
            let projected = await visibleWorkspaceProjector.projectWorkspace(
                requestID: RequestID(rawValue: "native-initial-workspace-project"),
                workspaceID: workspaceID,
                identity: identity,
                server: nil
            )
            if case .failure(let error) = projected {
                NSLog("Fenrir Native initial workspace projection failed: \(String(describing: error))")
            }
        }
    }

    func startClientControlSocket() {
        let dispatcher = NativeHostVisibleStateDispatcher(
            workspaceWindows: workspaceWindows,
            workspaceProjector: visibleWorkspaceProjector
        )
        let controller = NativeHostControlController(
            dispatcher: dispatcher,
            productDispatcher: dispatcher
        )
        serverEventController = NativeHostServerEventController(
            controller: controller,
            integration: serverEventIntegration,
            defaultSessionID: serverConnection.sessionID,
            projectionApplier: NativeVisibleReconnectProjectionApplier(workspaceWindows: workspaceWindows)
        )
        let serverEventController = serverEventController
        Task {
            await serverConnection.serverEventSource.setController(serverEventController)
        }
        let route = NativeHostLocalCLISocketRoute(controller: controller)
        let server = NativeHostLocalCLISocketServer(route: route)
        do {
            try server.start()
            clientControlSocketServer = server
        } catch {
            NSLog("Fenrir Native failed to start local CLI control socket: \(String(describing: error))")
        }
    }

    func stopClientControlSocket() {
        clientControlSocketServer?.stop()
        clientControlSocketServer = nil
    }
}

private final class NativeWorkspaceWindowRegistryReference: @unchecked Sendable {
    @MainActor weak var value: NativeWorkspaceWindowRegistry?
}

@MainActor
final class NativeWorkspaceWindowRegistry {
    private var controllers: [WorkspaceID: NativeWorkspaceWindowController] = [:]
    private var activeWorkspaceID: WorkspaceID?
    /// Enumerate-only live layout refresh (D-045 run-script loop); installed
    /// by the application runtime once the server-backed projection exists.
    private var workspaceLayoutRefresher: (@Sendable (WorkspaceID) async -> Void)?
    private let paneGridRuntimeFactory: any NativePaneGridRuntimeMaking
    private let paneStreamSubscriber: NativePaneStreamSubscriber?
    private let terminalStreamIngestor: NativeTerminalStreamIngestor?
    private let agentPromptSubmitterFactory: any NativeAgentPromptSubmitterMaking
    private let neovimBridgeControllerFactory: any NativeNeovimBridgeControllerMaking
    private let workflowServerClientFactory: any NativeWorkflowServerClientMaking
    private let workflowEventStreamFactory: any NativeWorkflowEventStreamMaking
    private let workflowNotificationStore: any Notifications.NotificationStore
    private let productivityPreferences: NativeShellProductivityPreferencesStore?
    private let scriptPaneRunner: any NativeWorkspaceScriptPaneRunning
    private let agentSessionResumer: any NativeAgentSessionResuming
    private let editorOpener: NativeWorkspaceEditorOpening
    private let notificationsHub: NativeWorkspaceNotificationsHub
    private let localServersEventStream: (any NativeLocalServersEventStreaming)?
    private let vcsStatusProvider: (any NativeWorkspaceVcsStatusProviding)?
    private let gitProbeProvider: (any NativeWorkspaceGitProbeProviding)?
    /// D-042 approval feed relay stream + decide RPC ports.
    private let approvalFeedEventStream: (any NativeApprovalFeedEventStreaming)?
    private let approvalFeedDecider: (any NativeApprovalFeedDeciding)?
    private let themeTokens: NativeShellThemeTokens
    private let diagnosticsActions: NativeDiagnosticsActionController
    private var notificationRoutingDiagnosticsTask: Task<Void, Never>?

    init(
        paneGridRuntimeFactory: any NativePaneGridRuntimeMaking = NativePaneGridUnavailableRuntimeFactory(),
        paneStreamSubscriber: NativePaneStreamSubscriber? = nil,
        terminalStreamIngestor: NativeTerminalStreamIngestor? = nil,
        agentPromptSubmitterFactory: any NativeAgentPromptSubmitterMaking,
        neovimBridgeControllerFactory: any NativeNeovimBridgeControllerMaking = NativeNeovimUnavailableControllerFactory(),
        workflowServerClientFactory: any NativeWorkflowServerClientMaking = NativeWorkflowUnavailableServerClientFactory(),
        workflowEventStreamFactory: any NativeWorkflowEventStreamMaking = NativeWorkflowUnavailableEventStreamFactory(),
        workflowNotificationStore: any Notifications.NotificationStore = Notifications.inMemoryNotificationStore(),
        productivityPreferences: NativeShellProductivityPreferencesStore? = nil,
        scriptPaneRunner: any NativeWorkspaceScriptPaneRunning = NativeUnavailableScriptPaneRunner(),
        agentSessionResumer: any NativeAgentSessionResuming = NativeUnavailableAgentSessionResumer(),
        editorOpener: NativeWorkspaceEditorOpening = .system(),
        notificationsHub: NativeWorkspaceNotificationsHub = NativeWorkspaceNotificationsHub(),
        localServersEventStream: (any NativeLocalServersEventStreaming)? = nil,
        vcsStatusProvider: (any NativeWorkspaceVcsStatusProviding)? = nil,
        gitProbeProvider: (any NativeWorkspaceGitProbeProviding)? = nil,
        approvalFeedEventStream: (any NativeApprovalFeedEventStreaming)? = nil,
        approvalFeedDecider: (any NativeApprovalFeedDeciding)? = nil,
        themeTokens: NativeShellThemeTokens = .resolve(Settings.NativeSettingsConfiguration.defaults.appearance.themeID),
        diagnosticsActions: NativeDiagnosticsActionController = NativeDiagnosticsActionController()
    ) {
        self.paneGridRuntimeFactory = paneGridRuntimeFactory
        self.paneStreamSubscriber = paneStreamSubscriber
        self.terminalStreamIngestor = terminalStreamIngestor
        self.agentPromptSubmitterFactory = agentPromptSubmitterFactory
        self.neovimBridgeControllerFactory = neovimBridgeControllerFactory
        self.workflowServerClientFactory = workflowServerClientFactory
        self.workflowEventStreamFactory = workflowEventStreamFactory
        self.workflowNotificationStore = workflowNotificationStore
        self.productivityPreferences = productivityPreferences
        self.scriptPaneRunner = scriptPaneRunner
        self.agentSessionResumer = agentSessionResumer
        self.editorOpener = editorOpener
        self.notificationsHub = notificationsHub
        self.localServersEventStream = localServersEventStream
        self.vcsStatusProvider = vcsStatusProvider
        self.gitProbeProvider = gitProbeProvider
        self.approvalFeedEventStream = approvalFeedEventStream
        self.approvalFeedDecider = approvalFeedDecider
        self.themeTokens = themeTokens
        self.diagnosticsActions = diagnosticsActions
    }

    func openInitialWorkspace(
        workspaceID: WorkspaceID = WorkspaceID(rawValue: "local-workspace"),
        canonicalPath: String = NativeLocalServerSupervisor.defaultWorkspaceRootURL().path
    ) {
        let summary = WorkspaceIndex.WorkspaceSummary(
            workspaceID: workspaceID,
            displayName: "Local Workspace",
            canonicalPath: canonicalPath,
            isOpenLocally: true,
            openState: WorkspaceIndex.WorkspaceOpenState(isOpenLocally: true, windowIDs: [FenrirWindowID(rawValue: "native-window-\(workspaceID.rawValue)")]),
            status: .open
        )
        _ = openWorkspace(summary: summary)
    }

    func openWorkspace(identity: WorkspaceIndex.WorkspaceIdentity) -> NativeWorkspaceOpenResult {
        let workspaceID = NativeWorkspaceWindowRegistry.workspaceID(for: identity)
        let windowID = FenrirWindowID(rawValue: "native-window-\(workspaceID.rawValue)")
        let displayName = NativeWorkspaceWindowRegistry.displayName(for: identity, workspaceID: workspaceID)
        let summary = WorkspaceIndex.WorkspaceSummary(
            workspaceID: workspaceID,
            displayName: displayName,
            canonicalPath: identity.canonicalPath,
            identity: identity,
            isOpenLocally: true,
            openState: WorkspaceIndex.WorkspaceOpenState(isOpenLocally: true, windowIDs: [windowID]),
            status: .open
        )
        return openWorkspace(summary: summary)
    }

    func focusWorkspace(identity: WorkspaceIndex.WorkspaceIdentity) -> NativeWorkspaceOpenResult? {
        let workspaceID = NativeWorkspaceWindowRegistry.workspaceID(for: identity)
        if let controller = controllers[workspaceID] {
            activeWorkspaceID = workspaceID
            controller.showWindow(nil)
            controller.window?.makeKeyAndOrderFront(nil)
            return NativeWorkspaceOpenResult(
                summary: NativeWorkspaceWindowRegistry.summary(for: workspaceID, identity: identity),
                windowID: FenrirWindowID(rawValue: "native-window-\(workspaceID.rawValue)"),
                didCreateWindow: false,
                didFocusExistingWindow: true
            )
        }
        return nil
    }

    func listVisibleWorkspaces() -> [WorkspaceIndex.WorkspaceSummary] {
        controllers.keys
            .sorted { $0.rawValue < $1.rawValue }
            .map { workspaceID in
                NativeWorkspaceWindowRegistry.summary(for: workspaceID)
            }
    }

    func activeVisibleWorkspaceID() -> WorkspaceID? {
        activeWorkspaceID
    }

    func removeWorkspace(workspaceID: WorkspaceID) -> WorkspaceIndex.WorkspaceSummary? {
        guard let controller = controllers.removeValue(forKey: workspaceID) else {
            return nil
        }
        if activeWorkspaceID == workspaceID {
            activeWorkspaceID = controllers.keys.sorted { $0.rawValue < $1.rawValue }.first
        }
        controller.window?.delegate = nil
        controller.close()
        return NativeWorkspaceWindowRegistry.summary(for: workspaceID)
    }

    func applyReconnectedLayout(workspaceID: WorkspaceID, layout: PaneGrid.State) {
        controllers[workspaceID]?.applyReconnectedLayout(layout)
    }

    func applyReconnectedNotifications(workspaceID: WorkspaceID, notifications: WorkspaceIndex.WorkspaceNotificationState) {
        controllers[workspaceID]?.applyReconnectedNotifications(notifications)
    }

    func updateAgentPresence(workspaceID: WorkspaceID, records: [AgentIntegration.AgentPresenceRecord]) {
        controllers[workspaceID]?.applyAgentPresence(records)
    }

    func setWorkspaceLayoutRefresher(_ refresher: @escaping @Sendable (WorkspaceID) async -> Void) {
        workspaceLayoutRefresher = refresher
    }

    func visibleNotificationState(workspaceID: WorkspaceID) -> WorkspaceIndex.WorkspaceNotificationState? {
        controllers[workspaceID]?.visibleNotificationState()
    }

    func visiblePaneGridState(workspaceID: WorkspaceID) -> PaneGrid.State? {
        controllers[workspaceID]?.visiblePaneGridState()
    }

    func runKeybindingPaletteSmoke(workspaceID: WorkspaceID?) async -> [String: String]? {
        guard let controller = controller(for: workspaceID) else {
            return nil
        }
        return await controller.runKeybindingPaletteSmoke()
    }

    func runAgentComposerContextSmoke(
        workspaceID: WorkspaceID?,
        contextSource: Keybinding.AgentComposerContextSource,
        expectedMarker: String?,
        selectionText: String?
    ) async -> [String: String]? {
        guard let controller = controller(for: workspaceID) else {
            return nil
        }
        return await controller.runAgentComposerContextSmoke(
            contextSource: contextSource,
            expectedMarker: expectedMarker,
            selectionText: selectionText
        )
    }

    func runTerminalTextSmoke(workspaceID: WorkspaceID?, expectedMarker: String?) async -> [String: String]? {
        guard let controller = controller(for: workspaceID) else {
            return nil
        }
        return await controller.runTerminalTextSmoke(expectedMarker: expectedMarker)
    }

    func runWorkflowTimelineSmoke(workspaceID: WorkspaceID?, runID: WorkflowControl.WorkflowRunID) async -> [String: String]? {
        guard let controller = controller(for: workspaceID) else {
            return nil
        }
        return await controller.runWorkflowTimelineSmoke(runID: runID)
    }

    func runNotificationsSmoke(
        workspaceID: WorkspaceID?,
        expectedMarker: String? = nil,
        dismiss: Bool = false
    ) async -> [String: String]? {
        guard let controller = controller(for: workspaceID) else {
            return nil
        }
        return await controller.runNotificationsSmoke(expectedMarker: expectedMarker, dismiss: dismiss)
    }

    func runTitlebarSmoke(workspaceID: WorkspaceID?) async -> [String: String]? {
        guard let controller = controller(for: workspaceID) else {
            return nil
        }
        return await controller.runTitlebarSmoke()
    }

    func runRunScriptSmoke(workspaceID: WorkspaceID?, scriptCommand: String) async -> [String: String]? {
        guard let controller = controller(for: workspaceID) else {
            return nil
        }
        return await controller.runRunScriptSmoke(scriptCommand: scriptCommand)
    }

    func runStopScriptSmoke(workspaceID: WorkspaceID?) async -> [String: String]? {
        guard let controller = controller(for: workspaceID) else {
            return nil
        }
        return await controller.runStopScriptSmoke()
    }

    func runAgentResumeSmoke(workspaceID: WorkspaceID?) async -> [String: String]? {
        guard let controller = controller(for: workspaceID) else {
            return nil
        }
        return controller.runAgentResumeSmoke()
    }

    func runGitProbeSmoke(workspaceID: WorkspaceID?) async -> [String: String]? {
        guard let controller = controller(for: workspaceID) else {
            return nil
        }
        return await controller.runGitProbeSmoke()
    }

    func runApprovalFeedSmoke(workspaceID: WorkspaceID?, expectedMarker: String? = nil) async -> [String: String]? {
        guard let controller = controller(for: workspaceID) else {
            return nil
        }
        return await controller.runApprovalFeedSmoke(expectedMarker: expectedMarker)
    }

    private func openWorkspace(summary: WorkspaceIndex.WorkspaceSummary) -> NativeWorkspaceOpenResult {
        let workspaceID = summary.workspaceID
        let windowID = FenrirWindowID(rawValue: "native-window-\(workspaceID.rawValue)")
        if let controller = controllers[workspaceID] {
            controller.showWindow(nil)
            controller.window?.makeKeyAndOrderFront(nil)
            activeWorkspaceID = workspaceID
            return NativeWorkspaceOpenResult(
                summary: summary,
                windowID: windowID,
                didCreateWindow: false,
                didFocusExistingWindow: true
            )
        }

        let workingDirectory = summary.canonicalPath ?? FileManager.default.currentDirectoryPath
        let shellState = NativeWorkspaceShellState(
            workspaceID: workspaceID,
            nativeWindowID: windowID,
            paneGridState: NativeWorkspaceWindowRegistry.bootstrapPaneGridState(
                workspaceID: workspaceID,
                nativeWindowID: windowID
            ),
            sidebarItems: [
                WorkspaceIndex.WorkspaceSidebarItem(summary: summary)
            ],
            paletteFileItems: NativeWorkspaceFilePalette.items(in: workingDirectory),
            focusedSurface: .terminal(nil)
        )
        let controller = NativeWorkspaceWindowController(
            state: shellState,
            paneGridRuntime: paneGridRuntimeFactory.makeRuntime(for: shellState),
            paneStreamSubscriber: paneStreamSubscriber,
            terminalStreamIngestor: terminalStreamIngestor,
            themeTokens: themeTokens,
            agentPromptSubmitter: agentPromptSubmitterFactory.makeSubmitter(for: shellState),
            neovimBridgeController: neovimBridgeControllerFactory.makeController(for: shellState),
            workflowServerClient: workflowServerClientFactory.makeClient(for: shellState),
            workflowEventStream: workflowEventStreamFactory.makeEventStream(for: shellState),
            workflowNotificationStore: workflowNotificationStore,
            productivityPreferences: productivityPreferences,
            scriptPaneRunner: scriptPaneRunner,
            agentSessionResumer: agentSessionResumer,
            editorOpener: editorOpener,
            notificationsHub: notificationsHub,
            localServersEventStream: localServersEventStream,
            vcsStatusProvider: vcsStatusProvider,
            gitProbeProvider: gitProbeProvider,
            approvalFeedEventStream: approvalFeedEventStream,
            approvalFeedDecider: approvalFeedDecider,
            refreshWorkspaceLayout: { [weak self] in
                let refresher = await MainActor.run { self?.workspaceLayoutRefresher }
                await refresher?(workspaceID)
            },
            switchWorkspace: { [weak self] workspaceID in
                self?.focusWorkspace(workspaceID)
            }
        )
        controllers[workspaceID] = controller
        activeWorkspaceID = workspaceID
        controller.showWindow(nil)
        controller.window?.makeKeyAndOrderFront(nil)
        return NativeWorkspaceOpenResult(
            summary: summary,
            windowID: windowID,
            didCreateWindow: true,
            didFocusExistingWindow: false
        )
    }

    private func focusWorkspace(_ workspaceID: WorkspaceID) {
        guard let controller = controllers[workspaceID] else {
            return
        }
        activeWorkspaceID = workspaceID
        controller.showWindow(nil)
        controller.window?.makeKeyAndOrderFront(nil)
    }

    func presentCommandPalette(query: String? = nil) -> WorkspaceID? {
        guard let controller = activeController() else {
            return nil
        }
        controller.presentCommandPalette(query: query)
        return controller.workspaceID
    }

    func executePaletteAction(actionID: String) -> WorkspaceID? {
        guard let controller = activeController() else {
            return nil
        }
        controller.executePaletteAction(actionID: actionID)
        return controller.workspaceID
    }

    func presentWorkflowPanel(operation: String, runID: String? = nil) -> WorkspaceID? {
        guard let controller = activeController() else {
            return nil
        }
        controller.presentWorkflowPanel(operation: operation, runID: runID)
        return controller.workspaceID
    }

    func presentDiagnosticsOverlay() -> WorkspaceID? {
        guard let controller = activeController() else {
            return nil
        }
        controller.presentDiagnosticsOverlay()
        return controller.workspaceID
    }

    private func activeController() -> NativeWorkspaceWindowController? {
        if let activeWorkspaceID, let controller = controllers[activeWorkspaceID] {
            controller.showWindow(nil)
            controller.window?.makeKeyAndOrderFront(nil)
            return controller
        }
        guard let workspaceID = controllers.keys.sorted(by: { $0.rawValue < $1.rawValue }).first else {
            return nil
        }
        activeWorkspaceID = workspaceID
        return controllers[workspaceID]
    }

    private func controller(for workspaceID: WorkspaceID?) -> NativeWorkspaceWindowController? {
        if let workspaceID {
            return controllers[workspaceID]
        }
        return activeController()
    }

    private static func workspaceID(for identity: WorkspaceIndex.WorkspaceIdentity) -> WorkspaceID {
        if let workspaceID = identity.workspaceID {
            return workspaceID
        }
        if let projectID = identity.projectID, !projectID.isEmpty {
            return WorkspaceID(rawValue: projectID)
        }
        if let canonicalPath = identity.canonicalPath, !canonicalPath.isEmpty {
            return WorkspaceID(rawValue: URL(fileURLWithPath: canonicalPath).lastPathComponent)
        }
        if let serverID = identity.serverID, !serverID.isEmpty {
            return WorkspaceID(rawValue: serverID)
        }
        return WorkspaceID(rawValue: "local-workspace")
    }

    private static func displayName(for identity: WorkspaceIndex.WorkspaceIdentity, workspaceID: WorkspaceID) -> String {
        if let canonicalPath = identity.canonicalPath, !canonicalPath.isEmpty {
            return URL(fileURLWithPath: canonicalPath).lastPathComponent
        }
        return workspaceID.rawValue
    }

    private static func summary(for workspaceID: WorkspaceID, identity: WorkspaceIndex.WorkspaceIdentity? = nil) -> WorkspaceIndex.WorkspaceSummary {
        let windowID = FenrirWindowID(rawValue: "native-window-\(workspaceID.rawValue)")
        return WorkspaceIndex.WorkspaceSummary(
            workspaceID: workspaceID,
            displayName: isLocalWorkspaceID(workspaceID) ? "Local Workspace" : workspaceID.rawValue,
            identity: identity,
            isOpenLocally: true,
            openState: WorkspaceIndex.WorkspaceOpenState(isOpenLocally: true, windowIDs: [windowID]),
            status: .open
        )
    }

    private static func isLocalWorkspaceID(_ workspaceID: WorkspaceID) -> Bool {
        workspaceID.rawValue == "local-workspace" || workspaceID.rawValue.hasPrefix("local-workspace-")
    }

    static func bootstrapPaneGridState(workspaceID: WorkspaceID, nativeWindowID: FenrirWindowID) -> PaneGrid.State {
        let pane = PaneGrid.PanePresentation(
            paneID: PaneID(rawValue: "pane-\(workspaceID.rawValue)"),
            tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: "%\(workspaceID.rawValue)"),
            viewportID: ViewportID(rawValue: "viewport-\(nativeWindowID.rawValue)"),
            title: workspaceID.rawValue,
            rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 120, rows: 36),
            isFocused: true
        )
        return PaneGrid.State(
            workspaceID: workspaceID,
            tmuxSessionID: "tmux-session-\(workspaceID.rawValue)",
            activeWindowID: nativeWindowID,
            windows: [
                PaneGrid.WindowPresentation(
                    windowID: nativeWindowID,
                    tmuxWindowID: "tmux-window-\(nativeWindowID.rawValue)",
                    index: 0,
                    title: workspaceID.rawValue,
                    root: .pane(pane),
                    activePaneID: pane.paneID,
                    panes: [pane]
                )
            ]
        )
    }
}

extension NativeWorkspaceWindowRegistry: NativeWorkspaceNotificationRouting {
    /// D-043: terminal-notification provenance resolves to the workspace's own
    /// shell controller so badges/panel/banner state land on the right window.
    /// Notifications are advisory — an unknown workspace drops the payload,
    /// but the drop is counted in diagnostics (identifiers only, never
    /// title/body content, D-031) instead of vanishing silently.
    func routeWorkspaceNotification(
        workspaceID: WorkspaceID,
        title: String?,
        body: String,
        paneID: PaneID?,
        source: Notifications.WorkspaceNotificationSource
    ) {
        guard let controller = controllers[workspaceID] else {
            let diagnostics = diagnosticsActions
            notificationRoutingDiagnosticsTask = Task { @MainActor in
                await diagnostics.record(
                    category: .nativeShell,
                    severity: .warning,
                    workspaceID: workspaceID,
                    title: "Workspace notification unroutable",
                    message: "No open workspace window matched the notification provenance; the payload was dropped.",
                    metadata: [
                        "notificationSource": source.rawValue,
                        "paneID": paneID?.rawValue ?? ""
                    ]
                )
            }
            return
        }
        controller.ingestWorkspaceNotification(
            title: title,
            body: body,
            paneID: paneID,
            source: source
        )
    }

    func waitForNotificationRoutingDiagnostics() async {
        await notificationRoutingDiagnosticsTask?.value
    }
}

struct NativeWorkspaceOpenResult: Sendable {
    let summary: WorkspaceIndex.WorkspaceSummary
    let windowID: FenrirWindowID
    let didCreateWindow: Bool
    let didFocusExistingWindow: Bool
}

final class NativeHostVisibleStateDispatcher: NativeHostClientControlDispatching, NativeHostProductCommandDispatching, @unchecked Sendable {
    private weak var workspaceWindows: NativeWorkspaceWindowRegistry?
    private let workspaceProjector: (any NativeVisibleWorkspaceProjecting)?
    private let agentIntegrationCommands: any NativeAgentIntegrationCommandHandling
    /// Script-executing smoke ops (run-script-smoke run/stop) are an
    /// arbitrary-command surface: the control socket is same-user, but the
    /// surface stays opt-in via FENRIR_SMOKE_OPS=1 in the app's environment.
    private let smokeOpsEnabled: Bool

    init(
        workspaceWindows: NativeWorkspaceWindowRegistry,
        workspaceProjector: (any NativeVisibleWorkspaceProjecting)? = nil,
        agentIntegrationCommands: any NativeAgentIntegrationCommandHandling = NativeAgentIntegrationCommandController(),
        smokeOpsEnabled: Bool = NativeHostVisibleStateDispatcher.smokeOpsEnabledFromEnvironment()
    ) {
        self.workspaceWindows = workspaceWindows
        self.workspaceProjector = workspaceProjector
        self.agentIntegrationCommands = agentIntegrationCommands
        self.smokeOpsEnabled = smokeOpsEnabled
    }

    static func smokeOpsEnabledFromEnvironment(
        _ environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> Bool {
        environment["FENRIR_SMOKE_OPS"] == "1"
    }

    func openWorkspace(_ input: ClientControl.OpenWorkspaceInput) async -> Result<ClientControl.OpenWorkspaceResult, ClientControl.ClientControlError> {
        if let workspaceProjector {
            let workspaceID = Self.workspaceID(for: input.identity)
            guard case .success(let summary) = await workspaceProjector.projectWorkspace(
                requestID: input.requestID,
                workspaceID: workspaceID,
                identity: input.identity,
                server: nil
            ) else {
                return .failure(.unavailable)
            }
            return await MainActor.run {
                guard let workspaceWindows,
                      let result = workspaceWindows.focusWorkspace(identity: input.identity)
                else {
                    return .failure(.unavailable)
                }
                return .success(ClientControl.OpenWorkspaceResult(
                    requestID: input.requestID,
                    workspace: summary,
                    windowID: result.windowID,
                    didCreateWindow: result.didCreateWindow,
                    didFocusExistingWindow: result.didFocusExistingWindow,
                    timestamp: FenrirTimestamp(Date())
                ))
            }
        }

        return await MainActor.run {
            guard let workspaceWindows else {
                return .failure(.unavailable)
            }
            let result = workspaceWindows.openWorkspace(identity: input.identity)
            return .success(ClientControl.OpenWorkspaceResult(
                requestID: input.requestID,
                workspace: result.summary,
                windowID: result.windowID,
                didCreateWindow: result.didCreateWindow,
                didFocusExistingWindow: result.didFocusExistingWindow,
                timestamp: FenrirTimestamp(Date())
            ))
        }
    }

    private static func workspaceID(for identity: WorkspaceIndex.WorkspaceIdentity) -> WorkspaceID {
        if let workspaceID = identity.workspaceID {
            return workspaceID
        }
        if let projectID = identity.projectID, !projectID.isEmpty {
            return WorkspaceID(rawValue: projectID)
        }
        if let canonicalPath = identity.canonicalPath, !canonicalPath.isEmpty {
            return WorkspaceID(rawValue: URL(fileURLWithPath: canonicalPath).lastPathComponent)
        }
        if let serverID = identity.serverID, !serverID.isEmpty {
            return WorkspaceID(rawValue: serverID)
        }
        return WorkspaceID(rawValue: "local-workspace")
    }

    func switchWorkspace(_ input: ClientControl.SwitchWorkspaceInput) async -> Result<ClientControl.SwitchWorkspaceResult, ClientControl.ClientControlError> {
        await focusWorkspace(ClientControl.FocusWorkspaceInput(requestID: input.requestID, identity: input.identity, source: input.source)).map { result in
            ClientControl.SwitchWorkspaceResult(
                requestID: input.requestID,
                workspace: result.workspace,
                windowID: result.windowID,
                timestamp: result.timestamp
            )
        }
    }

    func listWorkspaces(_ input: ClientControl.ListWorkspacesInput) async -> Result<ClientControl.ListWorkspacesResult, ClientControl.ClientControlError> {
        await MainActor.run {
            guard let workspaceWindows else {
                return .failure(.unavailable)
            }
            let timestamp = FenrirTimestamp(Date())
            return .success(ClientControl.ListWorkspacesResult(
                requestID: input.requestID,
                workspaces: workspaceWindows.listVisibleWorkspaces(),
                activeWorkspaceID: workspaceWindows.activeVisibleWorkspaceID(),
                timestamp: timestamp
            ))
        }
    }

    func attachWorkspace(_ input: ClientControl.AttachWorkspaceInput) async -> Result<ClientControl.AttachWorkspaceResult, ClientControl.ClientControlError> {
        await openWorkspace(ClientControl.OpenWorkspaceInput(requestID: input.requestID, identity: input.identity, source: input.source)).map { result in
            ClientControl.AttachWorkspaceResult(
                requestID: input.requestID,
                workspace: result.workspace,
                windowID: result.windowID,
                timestamp: result.timestamp
            )
        }
    }

    func removeWorkspace(_ input: ClientControl.RemoveWorkspaceInput) async -> Result<ClientControl.RemoveWorkspaceResult, ClientControl.ClientControlError> {
        await MainActor.run {
            guard let workspaceWindows else {
                return .failure(.unavailable)
            }
            guard let removed = workspaceWindows.removeWorkspace(workspaceID: input.workspaceID) else {
                return .failure(.workspaceNotOpen)
            }
            return .success(ClientControl.RemoveWorkspaceResult(
                requestID: input.requestID,
                workspaceID: removed.workspaceID,
                timestamp: FenrirTimestamp(Date())
            ))
        }
    }

    func focusWorkspace(_ input: ClientControl.FocusWorkspaceInput) async -> Result<ClientControl.FocusWorkspaceResult, ClientControl.ClientControlError> {
        await MainActor.run {
            guard let workspaceWindows else {
                return .failure(.unavailable)
            }
            guard let result = workspaceWindows.focusWorkspace(identity: input.identity) else {
                return .failure(.workspaceNotOpen)
            }
            return .success(ClientControl.FocusWorkspaceResult(
                requestID: input.requestID,
                workspace: result.summary,
                windowID: result.windowID,
                timestamp: FenrirTimestamp(Date())
            ))
        }
    }

    func controlWorkspace(_ input: ClientControl.ControlWorkspaceInput) async -> Result<ClientControl.ControlWorkspaceResult, ClientControl.ClientControlError> {
        guard input.operation == .reconnect,
              let workspaceProjector
        else {
            return .failure(.confirmationRequired)
        }
        guard let workspaceID = input.workspaceID ?? input.identity?.workspaceID else {
            return .failure(.decodeError)
        }
        let server: ServerConnection.Endpoint?
        switch input.serverSelection {
        case .remote(let endpoint):
            server = endpoint
        case .profile(let profileID):
            return .failure(profileID.rawValue.isEmpty ? .decodeError : .unavailable)
        case .local:
            server = nil
        }
        guard case .success(let summary) = await workspaceProjector.projectWorkspace(
            requestID: input.requestID,
            workspaceID: workspaceID,
            identity: input.identity,
            server: server
        ) else {
            return .failure(.unavailable)
        }
        return .success(ClientControl.ControlWorkspaceResult(
            requestID: input.requestID,
            operation: input.operation,
            workspaceID: workspaceID,
            workspace: summary,
            timestamp: FenrirTimestamp(Date())
        ))
    }

    func presentPalette(_ input: NativeHostPaletteInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError> {
        await MainActor.run {
            guard let workspaceID = workspaceWindows?.presentCommandPalette(query: input.query) else {
                return .failure(.unavailable)
            }
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: "PalettePresented",
                payload: [
                    "workspaceID": workspaceID.rawValue,
                    "query": input.query ?? ""
                ]
            ))
        }
    }

    func executePaletteAction(_ input: NativeHostPaletteInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError> {
        await MainActor.run {
            guard let actionID = input.actionID else {
                return .failure(.decodeError)
            }
            guard let workspaceID = workspaceWindows?.executePaletteAction(actionID: actionID) else {
                return .failure(.unavailable)
            }
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: "PaletteActionExecuted",
                payload: [
                    "workspaceID": workspaceID.rawValue,
                    "actionID": actionID
                ]
            ))
        }
    }

    func presentWorkflow(_ input: NativeHostWorkflowInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError> {
        await MainActor.run {
            guard let workspaceID = workspaceWindows?.presentWorkflowPanel(operation: input.operation, runID: input.runID) else {
                return .failure(.unavailable)
            }
            var payload = [
                "workspaceID": workspaceID.rawValue,
                "operation": input.operation
            ]
            if let runID = input.runID {
                payload["runID"] = runID
            }
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: "WorkflowPresented",
                payload: payload
            ))
        }
    }

    func presentDiagnostics(_ input: NativeHostDiagnosticsInput) async -> Result<NativeHostProductCommandResult, ClientControl.ClientControlError> {
        if input.operation.hasPrefix("agent-integration-") {
            return await agentIntegrationCommands.handle(input)
        }
        if input.operation == "keybinding-palette-smoke" {
            guard let workspaceWindows,
                  let payload = await workspaceWindows.runKeybindingPaletteSmoke(workspaceID: input.workspaceID)
            else {
                return .failure(.workspaceNotOpen)
            }
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: "KeybindingPaletteSmokeObserved",
                payload: payload
            ))
        }
        if input.operation == "agent-composer-context-smoke" {
            guard let workspaceWindows,
                  let payload = await workspaceWindows.runAgentComposerContextSmoke(
                    workspaceID: input.workspaceID,
                    contextSource: input.contextSource ?? .lastLines(3),
                    expectedMarker: input.expectedMarker,
                    selectionText: input.selectionText
                  )
            else {
                return .failure(.workspaceNotOpen)
            }
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: "AgentComposerContextSmokeObserved",
                payload: payload
            ))
        }
        if input.operation == "terminal-text-smoke" {
            guard let workspaceWindows,
                  let payload = await workspaceWindows.runTerminalTextSmoke(
                    workspaceID: input.workspaceID,
                    expectedMarker: input.expectedMarker
                  )
            else {
                return .failure(.workspaceNotOpen)
            }
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: "TerminalTextSmokeObserved",
                payload: payload
            ))
        }
        if input.operation == "workflow-timeline-smoke" {
            guard let runID = input.runID else {
                return .failure(.decodeError)
            }
            guard let workspaceWindows,
                  let payload = await workspaceWindows.runWorkflowTimelineSmoke(
                    workspaceID: input.workspaceID,
                    runID: runID
                  )
            else {
                return .failure(.workspaceNotOpen)
            }
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: "WorkflowTimelineSmokeObserved",
                payload: payload
            ))
        }
        if input.operation == "notifications-smoke" {
            guard let workspaceWindows,
                  let payload = await workspaceWindows.runNotificationsSmoke(
                      workspaceID: input.workspaceID,
                      expectedMarker: input.expectedMarker,
                      dismiss: input.dismiss
                  )
            else {
                return .failure(.workspaceNotOpen)
            }
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: "NotificationsSmokeObserved",
                payload: payload
            ))
        }
        if input.operation == "titlebar-smoke" {
            guard let workspaceWindows,
                  let payload = await workspaceWindows.runTitlebarSmoke(workspaceID: input.workspaceID)
            else {
                return .failure(.workspaceNotOpen)
            }
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: "TitlebarSmokeObserved",
                payload: payload
            ))
        }
        if input.operation == "approval-feed-smoke" {
            // Read-only D-042 probe: pending approval count plus the last
            // card's identifiers. Per D-031 the summary content never crosses
            // the diagnostics channel — verifiers pass `expectedMarker` and
            // get a match boolean plus the summary length instead. Injection
            // of fake requests happens server-side behind FENRIR_SMOKE_OPS=1.
            guard let workspaceWindows,
                  let payload = await workspaceWindows.runApprovalFeedSmoke(
                      workspaceID: input.workspaceID,
                      expectedMarker: input.expectedMarker
                  )
            else {
                return .failure(.workspaceNotOpen)
            }
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: "ApprovalFeedSmokeObserved",
                payload: payload
            ))
        }
        if input.operation == "agent-resume-smoke" {
            // Read-only D-044 plumbing probe: reports the resumable-session
            // records the shell currently knows (agentID/sessionID/paneAlive)
            // without creating panes, so no smoke-ops gate is required.
            guard let workspaceWindows,
                  let payload = await workspaceWindows.runAgentResumeSmoke(workspaceID: input.workspaceID)
            else {
                return .failure(.workspaceNotOpen)
            }
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: "AgentResumeSmokeObserved",
                payload: payload
            ))
        }
        if input.operation == "git-probe-smoke" {
            // Read-only D-045 plumbing probe: refreshes the server-side
            // workspace.gitProbe projection and reports what the shell knows
            // (branch/ahead/behind/PR + chip tone). Never scrapes panes and
            // never shells out, so no smoke-ops gate is required.
            guard let workspaceWindows,
                  let payload = await workspaceWindows.runGitProbeSmoke(workspaceID: input.workspaceID)
            else {
                return .failure(.workspaceNotOpen)
            }
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: "GitProbeSmokeObserved",
                payload: payload
            ))
        }
        if input.operation == "run-script-smoke" {
            // Opt-in gate for the arbitrary-command surface (run and stop):
            // refused with a typed permission error unless the app was
            // launched with FENRIR_SMOKE_OPS=1.
            guard smokeOpsEnabled else {
                return .failure(.permissionError)
            }
            if input.scriptOperation == "stop" {
                guard let workspaceWindows,
                      let payload = await workspaceWindows.runStopScriptSmoke(workspaceID: input.workspaceID)
                else {
                    return .failure(.workspaceNotOpen)
                }
                return .success(NativeHostProductCommandResult(
                    requestID: input.requestID,
                    resultKind: "RunScriptStopSmokeObserved",
                    payload: payload
                ))
            }
            guard let scriptCommand = input.scriptCommand, !scriptCommand.isEmpty else {
                return .failure(.decodeError)
            }
            guard let workspaceWindows,
                  let payload = await workspaceWindows.runRunScriptSmoke(
                    workspaceID: input.workspaceID,
                    scriptCommand: scriptCommand
                  )
            else {
                return .failure(.workspaceNotOpen)
            }
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: "RunScriptSmokeObserved",
                payload: payload
            ))
        }
        if input.operation == "pane-grid" {
            return await MainActor.run {
                let workspaceID = input.workspaceID ?? workspaceWindows?.listVisibleWorkspaces().first?.workspaceID
                guard let workspaceID,
                      let state = workspaceWindows?.visiblePaneGridState(workspaceID: workspaceID)
                else {
                    return .failure(.workspaceNotOpen)
                }
                let panes = state.windows.flatMap(\.panes)
                let activeWindow = state.windows.first { $0.windowID == state.activeWindowID }
                let activePane = activeWindow?.panes.first { $0.paneID == activeWindow?.activePaneID }
                return .success(NativeHostProductCommandResult(
                    requestID: input.requestID,
                    resultKind: "PaneGridProjected",
                    payload: [
                        "workspaceID": workspaceID.rawValue,
                        "tmuxSessionID": state.tmuxSessionID,
                        "activeWindowID": state.activeWindowID.rawValue,
                        "activePaneID": activePane?.paneID.rawValue ?? "",
                        "activeTmuxPaneID": activePane?.tmuxPaneID.rawValue ?? "",
                        "windowCount": String(state.windows.count),
                        "paneCount": String(panes.count),
                        "paneIDs": panes.map(\.paneID.rawValue).joined(separator: ","),
                        "tmuxPaneIDs": panes.map(\.tmuxPaneID.rawValue).joined(separator: ",")
                    ]
                ))
            }
        }
        return await MainActor.run {
            guard let workspaceID = workspaceWindows?.presentDiagnosticsOverlay() else {
                return .failure(.unavailable)
            }
            return .success(NativeHostProductCommandResult(
                requestID: input.requestID,
                resultKind: "DiagnosticsPresented",
                payload: ["workspaceID": workspaceID.rawValue]
            ))
        }
    }
}

@MainActor
final class NativeWorkspaceWindowController: NSWindowController, NSWindowDelegate {
    private let shellViewController: NativeWorkspaceRootViewController
    let workspaceID: WorkspaceID

    init(
        state: NativeWorkspaceShellState,
        paneGridRuntime: any NativePaneGridRuntimeControlling,
        paneStreamSubscriber: NativePaneStreamSubscriber? = nil,
        terminalStreamIngestor: NativeTerminalStreamIngestor? = nil,
        themeTokens: NativeShellThemeTokens = .resolve(Settings.NativeSettingsConfiguration.defaults.appearance.themeID),
        agentPromptSubmitter: any AgentInteraction.AgentPromptSubmitting,
        neovimBridgeController: NativeNeovimBridgeActionController,
        workflowServerClient: any WorkflowControl.WorkflowServerClient,
        workflowEventStream: any WorkflowControl.WorkflowEventStreaming = NativeWorkflowUnavailableEventStream(),
        workflowNotificationStore: any Notifications.NotificationStore = Notifications.inMemoryNotificationStore(),
        productivityPreferences: NativeShellProductivityPreferencesStore? = nil,
        scriptPaneRunner: any NativeWorkspaceScriptPaneRunning = NativeUnavailableScriptPaneRunner(),
        agentSessionResumer: any NativeAgentSessionResuming = NativeUnavailableAgentSessionResumer(),
        editorOpener: NativeWorkspaceEditorOpening = .system(),
        notificationsHub: NativeWorkspaceNotificationsHub = NativeWorkspaceNotificationsHub(),
        localServersEventStream: (any NativeLocalServersEventStreaming)? = nil,
        vcsStatusProvider: (any NativeWorkspaceVcsStatusProviding)? = nil,
        gitProbeProvider: (any NativeWorkspaceGitProbeProviding)? = nil,
        approvalFeedEventStream: (any NativeApprovalFeedEventStreaming)? = nil,
        approvalFeedDecider: (any NativeApprovalFeedDeciding)? = nil,
        refreshWorkspaceLayout: (@Sendable () async -> Void)? = nil,
        switchWorkspace: @MainActor @escaping (WorkspaceID) -> Void = { _ in }
    ) {
        workspaceID = state.workspaceID
        shellViewController = NativeWorkspaceRootViewController(
            controller: NativeWorkspaceShellController(state: state),
            paneGridRuntime: paneGridRuntime,
            paneStreamSubscriber: paneStreamSubscriber,
            terminalStreamIngestor: terminalStreamIngestor,
            themeTokens: themeTokens,
            agentPromptSubmitter: agentPromptSubmitter,
            neovimBridgeController: neovimBridgeController,
            workflowServerClient: workflowServerClient,
            workflowEventStream: workflowEventStream,
            workflowNotificationStore: workflowNotificationStore,
            productivityPreferences: productivityPreferences,
            scriptPaneRunner: scriptPaneRunner,
            agentSessionResumer: agentSessionResumer,
            editorOpener: editorOpener,
            notificationsHub: notificationsHub,
            localServersEventStream: localServersEventStream,
            vcsStatusProvider: vcsStatusProvider,
            gitProbeProvider: gitProbeProvider,
            approvalFeedEventStream: approvalFeedEventStream,
            approvalFeedDecider: approvalFeedDecider,
            refreshWorkspaceLayout: refreshWorkspaceLayout,
            switchWorkspace: switchWorkspace
        )
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 780),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Fenrir - \(state.workspaceID.rawValue)"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = themeTokens.rootBackground
        window.minSize = NSSize(width: 760, height: 520)
        window.center()
        window.contentViewController = shellViewController
        super.init(window: window)
        window.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    func windowDidBecomeKey(_ notification: Notification) {
        shellViewController.restoreDeterministicFocus()
    }

    func presentCommandPalette(query: String? = nil) {
        shellViewController.presentCommandPaletteFromClientControl(query: query)
    }

    func executePaletteAction(actionID: String) {
        shellViewController.executePaletteActionFromClientControl(actionID: actionID)
    }

    func presentWorkflowPanel(operation: String, runID: String? = nil) {
        shellViewController.presentWorkflowPanelFromClientControl(operation: operation, runID: runID)
    }

    func presentDiagnosticsOverlay() {
        shellViewController.presentDiagnosticsFromClientControl()
    }

    func applyReconnectedLayout(_ layout: PaneGrid.State) {
        shellViewController.applyReconnectedLayout(layout)
    }

    func applyReconnectedNotifications(_ notifications: WorkspaceIndex.WorkspaceNotificationState) {
        shellViewController.applyReconnectedNotifications(notifications)
    }

    func applyAgentPresence(_ records: [AgentIntegration.AgentPresenceRecord]) {
        shellViewController.applyAgentPresence(records)
    }

    func ingestWorkspaceNotification(
        title: String?,
        body: String,
        paneID: PaneID?,
        source: Notifications.WorkspaceNotificationSource
    ) {
        shellViewController.ingestWorkspaceNotification(
            title: title,
            body: body,
            paneID: paneID,
            source: source
        )
    }

    func visibleNotificationState() -> WorkspaceIndex.WorkspaceNotificationState? {
        shellViewController.visibleNotificationState()
    }

    func visiblePaneGridState() -> PaneGrid.State {
        shellViewController.visiblePaneGridState()
    }

    func runKeybindingPaletteSmoke() async -> [String: String] {
        await shellViewController.runKeybindingPaletteSmoke()
    }

    func runAgentComposerContextSmoke(
        contextSource: Keybinding.AgentComposerContextSource,
        expectedMarker: String? = nil,
        selectionText: String? = nil
    ) async -> [String: String] {
        await shellViewController.runAgentComposerContextSmoke(
            contextSource: contextSource,
            expectedMarker: expectedMarker,
            selectionText: selectionText
        )
    }

    func runTerminalTextSmoke(expectedMarker: String? = nil) async -> [String: String] {
        await shellViewController.runTerminalTextSmoke(expectedMarker: expectedMarker)
    }

    func runWorkflowTimelineSmoke(runID: WorkflowControl.WorkflowRunID) async -> [String: String] {
        await shellViewController.runWorkflowTimelineSmoke(runID: runID)
    }

    func runNotificationsSmoke(expectedMarker: String? = nil, dismiss: Bool = false) async -> [String: String] {
        await shellViewController.runNotificationsSmoke(expectedMarker: expectedMarker, dismiss: dismiss)
    }

    func runTitlebarSmoke() async -> [String: String] {
        await shellViewController.runTitlebarSmoke()
    }

    func runAgentResumeSmoke() -> [String: String] {
        shellViewController.runAgentResumeSmoke()
    }

    func runGitProbeSmoke() async -> [String: String] {
        await shellViewController.runGitProbeSmoke()
    }

    func runRunScriptSmoke(scriptCommand: String) async -> [String: String] {
        await shellViewController.runRunScriptSmoke(scriptCommand: scriptCommand)
    }

    func runStopScriptSmoke() async -> [String: String] {
        await shellViewController.runStopScriptSmoke()
    }

    func runApprovalFeedSmoke(expectedMarker: String? = nil) async -> [String: String] {
        await shellViewController.runApprovalFeedSmoke(expectedMarker: expectedMarker)
    }
}

@MainActor
final class NativeWorkspaceRootViewController: NSViewController {
    private var shellController: NativeWorkspaceShellController
    private let paneGridActions: any NativePaneGridActionDispatching
    private let paneStreamSubscriber: NativePaneStreamSubscriber?
    private let terminalStreamIngestor: NativeTerminalStreamIngestor?
    private let themeTokens: NativeShellThemeTokens
    private let agentComposerActions: NativeAgentComposerActionController
    private let neovimBridgeActions: NativeNeovimBridgeActionController
    private let workflowActions: NativeWorkflowActionController
    private let workflowEventStream: any WorkflowControl.WorkflowEventStreaming
    private let workflowNotifications: NativeWorkflowNotificationController
    private let diagnosticsActions: NativeDiagnosticsActionController
    private let agentIntegrationActions: any NativeAgentIntegrationActionDispatching
    private let switchWorkspace: @MainActor (WorkspaceID) -> Void
    private let productivityPreferences: NativeShellProductivityPreferencesStore
    private let scriptPaneRunner: any NativeWorkspaceScriptPaneRunning
    private let agentSessionResumer: any NativeAgentSessionResuming
    private let editorOpener: NativeWorkspaceEditorOpening
    private let notificationsHub: NativeWorkspaceNotificationsHub
    /// D-045 row metadata sources: listening ports (localServers discovery
    /// contract), workspace branch (server vcs contract) and PR status
    /// (server workspace.gitProbe contract).
    private let localServersEventStream: (any NativeLocalServersEventStreaming)?
    private let vcsStatusProvider: (any NativeWorkspaceVcsStatusProviding)?
    private let gitProbeProvider: (any NativeWorkspaceGitProbeProviding)?
    /// D-042 approval feed: relay stream, decide RPC, pending-card store,
    /// and actionable banner port. Cards carry only the structured payload;
    /// settlement always comes from the stream.
    private let approvalFeedEventStream: (any NativeApprovalFeedEventStreaming)?
    private let approvalFeedDecider: (any NativeApprovalFeedDeciding)?
    private let approvalFeedStore: any Notifications.ApprovalFeedStoring
    private let approvalBannerPresenter: any Notifications.ApprovalBannerPresenting
    private var approvalFeedTask: Task<Void, Never>?
    private var approvalFeedRefreshTask: Task<Void, Never>?
    /// In-flight decide request ids: double-clicking an option button must
    /// dispatch exactly one decide RPC (late/duplicate decisions are typed
    /// rejections server-side, the client avoids provoking them).
    private var approvalDecisionsInFlight: Set<String> = []
    /// Enumerate-only re-projection of the server-owned tmux layout (D-019):
    /// run after script pane create/close and when a running script's pane
    /// stream ends, so the grid and the run button track live pane state.
    private let refreshWorkspaceLayout: (@Sendable () async -> Void)?
    private let isAppActive: @MainActor () -> Bool
    private var agentComposerTask: Task<Void, Never>?
    private var neovimTask: Task<Void, Never>?
    private var workflowTask: Task<Void, Never>?
    private var workflowEventStreamTask: Task<Void, Never>?
    private var localServersTask: Task<Void, Never>?
    private var workspaceMetadataTask: Task<Void, Never>?
    /// In-flight refresh of the workspace.gitProbe snapshot (D-045 PR chip).
    private var gitProbeRefreshTask: Task<Void, Never>?
    /// 60s poll loop that re-probes while the window stays key (D-045).
    private var gitProbePollTask: Task<Void, Never>?
    /// Last decoded workspace.gitProbe snapshot, reported by git-probe-smoke.
    private var lastGitProbeSnapshot: WorkspaceIndex.WorkspaceGitProbeSnapshot?
    private var diagnosticsTask: Task<Void, Never>?
    private var agentIntegrationTask: Task<Void, Never>?
    private var productivityTask: Task<Void, Never>?
    private var didRunFirstRunAgentIntegrationRefresh = false
    private var runningScript: (script: Settings.ScriptDefinition, paneID: PaneID)?
    /// In-flight guard for the run/stop split-button actions: a double-click
    /// must not double-create or double-close script panes (D-045).
    private var scriptOperationInFlight = false
    /// In-flight guard for D-044 resume: a double-click on a Resume row must
    /// not create two panes for the same recorded session.
    private var resumeOperationInFlight = false
    private var presenceStateByPane: [PaneID: AgentIntegration.AgentPresenceState] = [:]
    private var rootView: NativeWorkspaceRootView {
        view as! NativeWorkspaceRootView
    }

    init(
        controller: NativeWorkspaceShellController,
        paneGridRuntime: any NativePaneGridRuntimeControlling,
        paneStreamSubscriber: NativePaneStreamSubscriber? = nil,
        terminalStreamIngestor: NativeTerminalStreamIngestor? = nil,
        themeTokens: NativeShellThemeTokens = .resolve(Settings.NativeSettingsConfiguration.defaults.appearance.themeID),
        agentPromptSubmitter: any AgentInteraction.AgentPromptSubmitting,
        neovimBridgeController: NativeNeovimBridgeActionController = NativeNeovimBridgeActionController.unavailable(),
        workflowServerClient: any WorkflowControl.WorkflowServerClient = NativeWorkflowUnavailableServerClient(),
        workflowEventStream: any WorkflowControl.WorkflowEventStreaming = NativeWorkflowUnavailableEventStream(),
        workflowNotificationStore: any Notifications.NotificationStore = Notifications.inMemoryNotificationStore(),
        diagnosticsActions: NativeDiagnosticsActionController? = nil,
        agentIntegrationActions: any NativeAgentIntegrationActionDispatching = NativeAgentIntegrationActionController(),
        productivityPreferences: NativeShellProductivityPreferencesStore? = nil,
        scriptPaneRunner: any NativeWorkspaceScriptPaneRunning = NativeUnavailableScriptPaneRunner(),
        agentSessionResumer: any NativeAgentSessionResuming = NativeUnavailableAgentSessionResumer(),
        editorOpener: NativeWorkspaceEditorOpening = .system(),
        notificationsHub: NativeWorkspaceNotificationsHub = NativeWorkspaceNotificationsHub(),
        localServersEventStream: (any NativeLocalServersEventStreaming)? = nil,
        vcsStatusProvider: (any NativeWorkspaceVcsStatusProviding)? = nil,
        gitProbeProvider: (any NativeWorkspaceGitProbeProviding)? = nil,
        approvalFeedEventStream: (any NativeApprovalFeedEventStreaming)? = nil,
        approvalFeedDecider: (any NativeApprovalFeedDeciding)? = nil,
        approvalFeedStore: (any Notifications.ApprovalFeedStoring)? = nil,
        approvalBannerPresenter: (any Notifications.ApprovalBannerPresenting)? = nil,
        refreshWorkspaceLayout: (@Sendable () async -> Void)? = nil,
        isAppActive: @MainActor @escaping () -> Bool = { NSApplication.shared.isActive },
        switchWorkspace: @MainActor @escaping (WorkspaceID) -> Void = { _ in }
    ) {
        shellController = controller
        self.switchWorkspace = switchWorkspace
        paneGridActions = NativePaneGridActionController(
            initialState: controller.state.paneGridState,
            runtime: paneGridRuntime
        )
        self.paneStreamSubscriber = paneStreamSubscriber
        self.terminalStreamIngestor = terminalStreamIngestor
        self.themeTokens = themeTokens
        agentComposerActions = NativeAgentComposerActionController(submitter: agentPromptSubmitter)
        neovimBridgeActions = neovimBridgeController
        workflowActions = NativeWorkflowActionController(
            workspaceID: controller.state.workspaceID,
            serverClient: workflowServerClient
        )
        self.workflowEventStream = workflowEventStream
        workflowNotifications = NativeWorkflowNotificationController(
            workspaceID: controller.state.workspaceID,
            store: workflowNotificationStore
        )
        self.diagnosticsActions = diagnosticsActions ?? NativeDiagnosticsActionController()
        self.agentIntegrationActions = agentIntegrationActions
        self.productivityPreferences = productivityPreferences
            ?? NativeShellProductivityPreferencesStore.applicationSupport()
            ?? NativeShellProductivityPreferencesStore.ephemeral()
        self.scriptPaneRunner = scriptPaneRunner
        self.agentSessionResumer = agentSessionResumer
        self.editorOpener = editorOpener
        self.notificationsHub = notificationsHub
        self.localServersEventStream = localServersEventStream
        self.vcsStatusProvider = vcsStatusProvider
        self.gitProbeProvider = gitProbeProvider
        self.approvalFeedEventStream = approvalFeedEventStream
        self.approvalFeedDecider = approvalFeedDecider
        self.approvalFeedStore = approvalFeedStore ?? Notifications.inMemoryApprovalFeedStore()
        self.approvalBannerPresenter = approvalBannerPresenter
            ?? Notifications.UserNotificationCenterApprovalBannerPresenter()
        self.refreshWorkspaceLayout = refreshWorkspaceLayout
        self.isAppActive = isAppActive
        super.init(nibName: nil, bundle: nil)
        // Preferences write failures must not stay silent (D-045): the store
        // reverts its cache to the last-persisted state and this hook routes
        // the failure into the D-043 notifications hub. The error detail is
        // already NSLog'd by the store; the notification stays content-free.
        let hub = notificationsHub
        let workspaceID = controller.state.workspaceID
        self.productivityPreferences.setPersistenceFailureHandler { [weak self] _ in
            Task { @MainActor in
                _ = await hub.ingest(
                    Notifications.WorkspaceNotificationDraft(
                        workspaceID: workspaceID,
                        paneID: nil,
                        title: "Preferences not saved",
                        body: "Saving productivity preferences failed; recent changes were not persisted.",
                        source: .system
                    ),
                    isAppActive: self?.isAppActive() ?? false
                )
                await self?.refreshNotificationsProjectionNow()
            }
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func loadView() {
        view = NativeWorkspaceRootView(
            state: shellController.state,
            paneGridActions: paneGridActions,
            paneStreamSubscriber: paneStreamSubscriber,
            terminalStreamIngestor: terminalStreamIngestor,
            themeTokens: themeTokens
        )
        rootView.onToggleSidebar = { [weak self] in
            self?.toggleSidebar()
        }
        rootView.onFocusTerminal = { [weak self] in
            self?.focusTerminal()
        }
        rootView.onFocusSidebar = { [weak self] in
            self?.focusSidebar()
        }
        rootView.onDismissCommandPalette = { [weak self] in
            self?.dismissCommandPalette()
        }
        rootView.onCloseOverlay = { [weak self] overlayID in
            self?.closeOverlay(overlayID)
        }
        rootView.onExecutePaletteAction = { [weak self] action in
            self?.executePaletteAction(action)
        }
        rootView.onPresentCommandPalette = { [weak self] in
            self?.presentCommandPalette()
        }
        rootView.onPresentDiagnosticsOverlay = { [weak self] in
            self?.presentDiagnosticsOverlay()
        }
        rootView.onPresentAgentComposer = { [weak self] contextSource in
            self?.presentAgentComposer(contextSource)
        }
        rootView.onPresentWorkflowPanel = { [weak self] in
            self?.presentWorkflowPanel()
        }
        rootView.onSubmitAgentComposer = { [weak self] command in
            self?.submitAgentComposer(command)
        }
        rootView.onCancelAgentComposer = { [weak self] input in
            self?.cancelAgentComposer(input)
        }
        rootView.onWorkflowCommand = { [weak self] command in
            self?.dispatchWorkflowCommand(command)
        }
        rootView.onAgentIntegrationCommand = { [weak self] command in
            self?.dispatchAgentIntegrationCommand(command)
        }
        rootView.onSwitchWorkspace = { [weak self] workspaceID in
            guard let self, workspaceID != self.shellController.state.workspaceID else {
                return
            }
            self.switchWorkspace(workspaceID)
        }
        rootView.onOpenAgentIntegrations = { [weak self] in
            self?.presentAgentIntegrationsOverlay()
        }
        rootView.onResumeAgentSession = { [weak self] agentID, sessionID in
            self?.resumeAgentSession(agentID: agentID, sessionID: sessionID)
        }
        rootView.onRunPrimaryScript = { [weak self] in
            self?.runPrimaryScriptOrStop()
        }
        rootView.onRunScript = { [weak self] scriptID in
            self?.runScript(withID: scriptID)
        }
        rootView.onManageScripts = { [weak self] in
            self?.presentManageScriptsOverlay()
        }
        rootView.onOpenEditorPrimary = { [weak self] in
            self?.openWorkspaceInEditor(targetID: nil, persistChoice: false)
        }
        rootView.onPickEditorTarget = { [weak self] targetID in
            self?.openWorkspaceInEditor(targetID: targetID, persistChoice: true)
        }
        rootView.onOpenNotifications = { [weak self] in
            self?.presentNotificationsPanel()
        }
        rootView.onJumpToLatestUnread = { [weak self] in
            self?.jumpToLatestUnreadNotification()
        }
        rootView.onSelectNotification = { [weak self] notificationID, paneID in
            self?.selectNotification(notificationID, paneID: paneID)
        }
        rootView.onMarkAllNotificationsRead = { [weak self] in
            self?.markAllNotificationsRead()
        }
        rootView.onOpenApprovals = { [weak self] in
            self?.presentApprovalsPanel()
        }
        rootView.onDecideApproval = { [weak self] requestID, optionID in
            self?.decideApproval(requestID: requestID, optionID: optionID)
        }
        rootView.onAddScript = { [weak self] name, command in
            self?.addWorkspaceScript(name: name, command: command)
        }
        rootView.onRemoveScript = { [weak self] scriptID in
            self?.removeWorkspaceScript(scriptID)
        }
        rootView.terminalPaneHost.onPaneStreamEnded = { [weak self] paneID in
            self?.handlePaneStreamEnded(paneID)
        }
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        restoreDeterministicFocus()
        runFirstRunAgentIntegrationRefreshIfNeeded()
        refreshTitlebarControls()
        refreshNotificationsProjection()
        startLocalServersStreamIfNeeded()
        startApprovalFeedStreamIfNeeded()
        refreshWorkspaceBranch()
        refreshWorkspaceGitProbe()
        startGitProbePollingIfNeeded()
    }

    deinit {
        workflowEventStreamTask?.cancel()
        localServersTask?.cancel()
        approvalFeedTask?.cancel()
        approvalFeedRefreshTask?.cancel()
        gitProbeRefreshTask?.cancel()
        gitProbePollTask?.cancel()
    }

    func restoreDeterministicFocus() {
        rootView.apply(shellController.state)
        focus(shellController.state.focusedSurface)
    }

    func applyReconnectedLayout(_ layout: PaneGrid.State) {
        diagnosticsTask = Task { @MainActor in
            await diagnosticsActions.record(
                category: .tmuxKernel,
                severity: .info,
                workspaceID: shellController.state.workspaceID,
                title: "tmux layout reconciled",
                message: "Reconnected workspace layout from server-owned tmux state.",
                metadata: [
                    "windowCount": "\(layout.windows.count)",
                    "paneCount": "\(layout.windows.flatMap(\.panes).count)"
                ]
            )
        }
        paneGridActions.markServerBackedPaneGridState(layout)
        shellController.updatePaneGrid(layout)
        reconcileRunningScript(with: layout)
        prunePresenceState(for: layout)
        refreshWorkspaceBranch()
        refreshWorkspaceGitProbe()
        restoreDeterministicFocus()
    }

    /// Subscribes to the server's localServers discovery stream and projects
    /// listening-port chips into the workspace row (D-045 row metadata). The
    /// subscription re-establishes itself after stream failures; a lost
    /// stream degrades to stale/absent chips, never to client-side probing.
    private func startLocalServersStreamIfNeeded() {
        guard localServersTask == nil, let localServersEventStream else {
            return
        }
        localServersTask = Task { [weak self] in
            var didRecordFailure = false
            while !Task.isCancelled {
                let stream = await localServersEventStream.observeLocalServers()
                do {
                    for try await snapshot in stream {
                        didRecordFailure = false
                        self?.applyLocalServersSnapshot(snapshot)
                    }
                } catch is CancellationError {
                    return
                } catch {
                    if !didRecordFailure {
                        didRecordFailure = true
                        await self?.recordLocalServersStreamError(error)
                    }
                }
                guard !Task.isCancelled, self != nil else {
                    return
                }
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }

    private func applyLocalServersSnapshot(_ snapshot: NativeLocalServersSnapshot) {
        let chips = Set(snapshot.servers.map(\.port))
            .sorted()
            .map { NativeSidebarWorkspacePortChip(port: $0) }
        rootView.updateLocalServerPorts(chips)
    }

    private func recordLocalServersStreamError(_ error: Error) async {
        await diagnosticsActions.record(
            category: .serverConnection,
            severity: .warning,
            workspaceID: shellController.state.workspaceID,
            title: "Local servers stream failed",
            message: String(describing: error),
            metadata: ["surface": "workspace-row-ports"]
        )
    }

    /// Resolves the workspace's current branch through the server vcs
    /// contract and projects it into the workspace row (D-041/D-045: name,
    /// branch, hotkey slot). Refreshed on appear and on layout reconciles.
    private func refreshWorkspaceBranch() {
        guard let vcsStatusProvider else {
            return
        }
        let workspaceID = shellController.state.workspaceID
        guard let workspacePath = shellController.state.sidebarItems
            .first(where: { $0.workspaceID == workspaceID })?
            .canonicalPath
        else {
            return
        }
        workspaceMetadataTask = Task { @MainActor [weak self] in
            guard let branch = try? await vcsStatusProvider.currentRefName(workspacePath: workspacePath) else {
                return
            }
            self?.rootView.updateWorkspaceBranch(workspaceID, branch: branch)
        }
    }

    /// Resolves the workspace git/PR probe through the server-side
    /// `workspace.gitProbe` contract (D-045) and projects the PR chip into
    /// the workspace row. Runs on appear, on layout reconciles (workspace
    /// projection), and on the 60s key-window poll — never via pane scraping.
    private func refreshWorkspaceGitProbe() {
        guard let gitProbeProvider else {
            return
        }
        let workspaceID = shellController.state.workspaceID
        guard let workspacePath = shellController.state.sidebarItems
            .first(where: { $0.workspaceID == workspaceID })?
            .canonicalPath
        else {
            return
        }
        gitProbeRefreshTask = Task { @MainActor [weak self] in
            guard let snapshot = try? await gitProbeProvider.probe(workspacePath: workspacePath) else {
                return
            }
            guard let self else {
                return
            }
            self.lastGitProbeSnapshot = snapshot
            self.rootView.updateWorkspacePullRequest(
                workspaceID,
                chip: WorkspaceIndex.pullRequestChip(from: snapshot)
            )
        }
    }

    /// D-045 PR chip freshness: re-probe every 60s while the window is key.
    /// Skipped ticks (background window) cost nothing; the server keeps its
    /// own short-TTL cache so key-window polling stays cheap.
    private func startGitProbePollingIfNeeded() {
        guard gitProbePollTask == nil, gitProbeProvider != nil else {
            return
        }
        gitProbePollTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                guard let self else {
                    return
                }
                guard !Task.isCancelled, self.view.window?.isKeyWindow == true else {
                    continue
                }
                self.refreshWorkspaceGitProbe()
            }
        }
    }

    func waitForWorkspaceMetadataActions() async {
        await workspaceMetadataTask?.value
        await gitProbeRefreshTask?.value
    }

    /// Clears the run-button "Stop" state when the script pane died outside
    /// the shell (server-owned layout is the source of truth, D-019).
    private func reconcileRunningScript(with layout: PaneGrid.State) {
        guard let runningScript else {
            return
        }
        let paneIDs = Set(layout.windows.flatMap(\.panes).map(\.paneID))
        if !paneIDs.contains(runningScript.paneID) {
            self.runningScript = nil
            refreshTitlebarControls()
        }
    }

    /// Drops presence entries for panes that no longer exist in the
    /// server-owned tmux layout (D-019). A pane killed without a final
    /// presence transition (script stop, tmux kill-pane, agent crash) must
    /// not pin the workspace in the D-045 attention set forever.
    private func prunePresenceState(for layout: PaneGrid.State) {
        let livePaneIDs = Set(layout.windows.flatMap(\.panes).map(\.paneID))
        let pruned = presenceStateByPane.filter { livePaneIDs.contains($0.key) }
        guard pruned.count != presenceStateByPane.count else {
            return
        }
        presenceStateByPane = pruned
        refreshNotificationsProjection()
    }

    func applyReconnectedNotifications(_ notifications: WorkspaceIndex.WorkspaceNotificationState) {
        diagnosticsTask = Task { @MainActor in
            await diagnosticsActions.record(
                category: .serverConnection,
                severity: .info,
                workspaceID: shellController.state.workspaceID,
                title: "Server notifications projected",
                message: "Server reconnect events updated workspace notification state.",
                metadata: [
                    "unreadCount": "\(notifications.unreadCount)",
                    "level": notifications.level.rawValue
                ]
            )
        }
        shellController.updateWorkspaceNotifications(notifications)
        rootView.apply(shellController.state)
    }

    func applyAgentPresence(_ records: [AgentIntegration.AgentPresenceRecord]) {
        rootView.updateAgentPresence(records)

        // D-045 attention loop: awaiting-input presence draws the pane ring.
        let workspaceID = shellController.state.workspaceID
        let workspaceRecords = records.filter { $0.provenance.workspaceID == workspaceID }
        let attentionPaneIDs = Set(workspaceRecords
            .filter { $0.state == .awaitingInput || $0.state == .awaitingApproval }
            .map(\.provenance.paneID))
        rootView.updateAttentionPaneIDs(attentionPaneIDs)

        // D-043 companion: transitions into a waiting presence state
        // (awaiting-input or awaiting-approval, D-045 attention loop) append a
        // workspace notification (source: agentPresence) so badges, the panel,
        // banners, and jump-to-unread work without OSC-emitting CLIs.
        //
        // The map is rebuilt from the presence snapshot on every application
        // (D-038/D-043: attention is event-driven state, never an accumulating
        // cache) — entries for panes that dropped out of the records are
        // pruned so a killed pane cannot pin the workspace in the attention
        // set forever.
        var transitioned: [AgentIntegration.AgentPresenceRecord] = []
        var reconciled: [PaneID: AgentIntegration.AgentPresenceState] = [:]
        for record in workspaceRecords {
            let paneID = record.provenance.paneID
            let previous = reconciled[paneID] ?? presenceStateByPane[paneID]
            let isWaitingState = record.state == .awaitingInput || record.state == .awaitingApproval
            if isWaitingState, previous != record.state {
                transitioned.append(record)
            }
            reconciled[paneID] = record.state
        }
        presenceStateByPane = reconciled
        for record in transitioned {
            let agentName = AgentIntegration.supportedAgentDescriptors
                .first { $0.id == record.agentID }?
                .displayName ?? record.agentID.rawValue
            ingestWorkspaceNotification(
                title: agentName,
                body: record.state == .awaitingApproval ? "approval required" : "awaiting input",
                paneID: record.provenance.paneID,
                source: .agentPresence
            )
        }
    }

    func visibleNotificationState() -> WorkspaceIndex.WorkspaceNotificationState? {
        guard let item = shellController.state.sidebarItems.first(where: { $0.workspaceID == shellController.state.workspaceID }) else {
            return nil
        }
        return WorkspaceIndex.WorkspaceNotificationState(
            unreadCount: item.notificationCount,
            level: item.notificationLevel
        )
    }

    func visiblePaneGridState() -> PaneGrid.State {
        shellController.state.paneGridState
    }

    func waitForAgentComposerActions() async {
        await agentComposerTask?.value
    }

    func waitForWorkflowActions() async {
        await workflowTask?.value
    }

    func waitForNeovimActions() async {
        await neovimTask?.value
    }

    func waitForDiagnosticsActions() async {
        await diagnosticsTask?.value
    }

    func waitForAgentIntegrationActions() async {
        await agentIntegrationTask?.value
    }

    func visibleAgentIntegrationState() -> AgentIntegration.AgentIntegrationPanelState? {
        rootView.visibleAgentIntegrationState()
    }

    func runKeybindingPaletteSmoke() async -> [String: String] {
        let keymap = NativeTmuxKeymapLoader.effectiveKeymap()
        let imported = try? await Keybinding.ImportTmuxKeymap(clock: NativeKeybindingClock())
            .run(Keybinding.ImportTmuxKeymapInput(
                requestID: "native-e2e-keybinding-import",
                source: .nativeHost,
                keymap: keymap
            ))
            .get()
            .importedMap
        let actions = imported?.bindings.map(\.action) ?? []

        let cmdPHandled = NativeWorkspaceShellKeyboardEventFactory.commandP(windowNumber: view.window?.windowNumber ?? 0)
            .map { rootView.performKeyEquivalent(with: $0) } ?? false
        restoreDeterministicFocus()

        return [
            "workspaceID": shellController.state.workspaceID.rawValue,
            "commandPaletteVisible": String(rootView.visibleOverlayTitles().contains("Command Palette")),
            "cmdPHandled": String(cmdPHandled),
            "palettePrefixes": (imported?.palettePrefixes.map(\.rawValue).joined(separator: ",") ?? ""),
            "tmuxBindingCount": String(imported?.bindings.count ?? 0),
            "tmuxUnsupportedCount": String(imported?.unsupportedBindings.count ?? 0),
            "tmuxFocusLeft": String(actions.contains(.focusPane(.left))),
            "tmuxFocusRight": String(actions.contains(.focusPane(.right))),
            "tmuxFocusUp": String(actions.contains(.focusPane(.up))),
            "tmuxFocusDown": String(actions.contains(.focusPane(.down))),
            "tmuxSwitchWindowNext": String(actions.contains(.switchWindow(.next))),
            "tmuxSwitchWindowPrevious": String(actions.contains(.switchWindow(.previous)))
        ]
    }

    func runAgentComposerContextSmoke(
        contextSource: Keybinding.AgentComposerContextSource,
        expectedMarker: String? = nil,
        selectionText: String? = nil
    ) async -> [String: String] {
        let terminal = rootView.terminalPaneHost.terminalView
        let awaitedText = selectionText ?? expectedMarker
        let awaitedTextObserved = await waitForTerminalText(awaitedText, in: terminal)
        if awaitedTextObserved {
            await waitForTerminalTextStability(in: terminal)
        }
        let selectedText = contextSource == .selection
            ? selectionText.flatMap { NativeTerminalSelectionSmokeSupport.selectText($0, in: terminal) }
            : nil
        let before = terminal.captureLastLines(maxLines: nil).text

        let openComposerError: String
        do {
            _ = try await openAgentComposer(contextSource)
            openComposerError = ""
        } catch {
            openComposerError = String(describing: error)
        }

        let after = terminal.captureLastLines(maxLines: nil).text
        let composer = rootView.visibleAgentComposerState()
        let attachment = composer?.attachments.first
        return [
            "workspaceID": shellController.state.workspaceID.rawValue,
            "overlayVisible": String(rootView.visibleOverlayTitles().contains("Agent Composer")),
            "contextKind": attachment?.kind.rawValue ?? "",
            "attachmentLineCount": String(attachment?.lineCount ?? 0),
            "attachmentCharacterCount": String(attachment?.characterCount ?? 0),
            "attachmentContainsMarker": String(expectedMarker.map { attachment?.text.contains($0) ?? false } ?? false),
            "expectedTextObserved": String(awaitedTextObserved),
            "selectionWasApplied": String(selectedText != nil),
            "attachmentMatchesSelectedText": String(selectedText.map { attachment?.text == $0 } ?? false),
            "paneTextUnchangedByComposer": String(before == after),
            "composerStatus": composer?.status.rawValue ?? "",
            "openComposerError": openComposerError,
            "agentWroteIntoPane": String(before != after)
        ]
    }

    func runTerminalTextSmoke(expectedMarker: String? = nil) async -> [String: String] {
        let terminal = rootView.terminalPaneHost.terminalView
        let expectedTextObserved = await waitForTerminalText(expectedMarker, in: terminal)
        let text = terminal.captureLastLines(maxLines: nil).text
        return [
            "workspaceID": shellController.state.workspaceID.rawValue,
            "expectedTextObserved": String(expectedTextObserved),
            "lineCount": String(text.split(separator: "\n", omittingEmptySubsequences: false).count),
            "characterCount": String(text.count),
            "containsMarker": String(expectedMarker.map { text.contains($0) } ?? false)
        ]
    }

    func runWorkflowTimelineSmoke(runID: WorkflowControl.WorkflowRunID) async -> [String: String] {
        presentWorkflowPanelFromClientControl(operation: "timeline", runID: runID.rawValue)
        await waitForWorkflowActions()

        let state = rootView.visibleWorkflowState()
        var payload = [
            "workspaceID": shellController.state.workspaceID.rawValue,
            "runID": runID.rawValue,
            "overlayVisible": String(rootView.visibleOverlayTitles().contains("Workflows")),
            "runCount": String(state.runs.count),
            "timelineEventCount": String(state.timeline?.events.count ?? 0),
            "workflowError": state.error.map { String(describing: $0) } ?? ""
        ]
        if let timeline = state.timeline {
            payload["timelineRunID"] = timeline.runID.rawValue
            payload["timelineEventIDs"] = timeline.events.map(\.eventID.rawValue).joined(separator: ",")
        }
        return payload
    }

    // MARK: - D-045 titlebar productivity controls

    func waitForProductivityActions() async {
        await productivityTask?.value
    }

    private func workspaceCanonicalPath() -> String? {
        shellController.state.sidebarItems
            .first { $0.workspaceID == shellController.state.workspaceID }?
            .canonicalPath
    }

    private func mergedWorkspaceScripts() -> [Settings.ScriptDefinition] {
        productivityPreferences.scripts(forRepositoryPath: workspaceCanonicalPath())
    }

    func refreshTitlebarControls() {
        let scripts = mergedWorkspaceScripts()
        let primary = productivityPreferences.primaryRunScript(forRepositoryPath: workspaceCanonicalPath())
            ?? scripts.first
        // Chrome labels follow the Settings display-name contract (D-045
        // `ScriptDefinition.displayName`): predefined kinds render their kind
        // label so future renames propagate; custom scripts render the
        // user-facing name (visual contract: "stop web").
        let menuItems = scripts.map { script in
            NativeShellRunScriptMenuItem(scriptID: script.id, title: script.displayName)
        }
        let run: NativeShellRunControlState = if let runningScript {
            NativeShellRunControlState(
                phase: .running,
                title: "Stop \(runningScript.script.displayName)",
                menuItems: menuItems
            )
        } else if let primary {
            NativeShellRunControlState(phase: .idle, title: "Run \(primary.displayName)", menuItems: menuItems)
        } else {
            NativeShellRunControlState(phase: .unavailable, title: "Run", menuItems: menuItems)
        }

        let installed = editorOpener.installedTargets()
        let preferredTargetID = productivityPreferences.editorTargetID(forRepositoryPath: workspaceCanonicalPath())
        let resolvedTarget = preferredTargetID.flatMap { targetID in installed.first { $0.id == targetID } }
            ?? installed.first
        let editor = NativeShellEditorControlState(
            title: resolvedTarget.map { "Open in \($0.displayName)" } ?? "Open",
            isEnabled: resolvedTarget != nil && workspaceCanonicalPath() != nil,
            menuItems: installed.map { NativeShellEditorMenuItem(targetID: $0.id, title: $0.displayName) }
        )

        // D-042: the bell badge counts unread notifications plus pending
        // approval cards, so waiting agents surface even with zero unread.
        rootView.updateTitlebarControls(NativeShellTitlebarControlsState(
            run: run,
            editor: editor,
            notificationUnreadCount: rootView.visibleNotificationsUnreadCount()
                + rootView.visibleApprovalsPendingCount()
        ))
    }

    private func runPrimaryScriptOrStop() {
        guard !scriptOperationInFlight else {
            return
        }
        if runningScript != nil {
            stopRunningScript()
            return
        }
        let primary = productivityPreferences.primaryRunScript(forRepositoryPath: workspaceCanonicalPath())
            ?? mergedWorkspaceScripts().first
        guard let primary else {
            presentManageScriptsOverlay()
            return
        }
        runScript(primary)
    }

    private func runScript(withID scriptID: Settings.ScriptID) {
        guard let script = mergedWorkspaceScripts().first(where: { $0.id == scriptID }) else {
            return
        }
        runScript(script)
    }

    private func runScript(_ script: Settings.ScriptDefinition) {
        guard !scriptOperationInFlight else {
            return
        }
        guard let request = scriptPaneRequest(command: script.command, title: script.name, processDefID: "script:\(script.id.rawValue)") else {
            return
        }
        scriptOperationInFlight = true
        productivityTask = Task { @MainActor in
            _ = await self.executeScriptPane(request, trackAs: script)
            self.scriptOperationInFlight = false
        }
    }

    private func scriptPaneRequest(command: String, title: String, processDefID: String) -> NativeScriptPaneRequest? {
        let state = shellController.state
        let grid = state.paneGridState
        guard let window = grid.windows.first(where: { $0.windowID == grid.activeWindowID }) ?? grid.windows.first else {
            return nil
        }
        return NativeScriptPaneRequest(
            workspaceID: state.workspaceID,
            windowID: window.windowID,
            workingDirectory: workspaceCanonicalPath(),
            command: command,
            title: title,
            processDefID: processDefID
        )
    }

    @discardableResult
    private func executeScriptPane(
        _ request: NativeScriptPaneRequest,
        trackAs script: Settings.ScriptDefinition?
    ) async -> PaneID? {
        do {
            let paneID = try await scriptPaneRunner.createScriptPane(request)
            if let script {
                runningScript = (script: script, paneID: paneID)
            }
            refreshTitlebarControls()
            // The pane grid is server-owned (D-019): re-project the layout so
            // the new script pane appears live, not on the next reconnect.
            await refreshWorkspaceLayout?()
            return paneID
        } catch {
            await diagnosticsActions.record(
                category: .nativeShell,
                severity: .error,
                workspaceID: request.workspaceID,
                title: "Run script failed",
                message: String(describing: error),
                metadata: ["script": request.title]
            )
            refreshTitlebarControls()
            return nil
        }
    }

    private func stopRunningScript() {
        guard !scriptOperationInFlight, let running = runningScript else {
            return
        }
        let workspaceID = shellController.state.workspaceID
        scriptOperationInFlight = true
        productivityTask = Task { @MainActor in
            do {
                try await self.scriptPaneRunner.closeScriptPane(workspaceID: workspaceID, paneID: running.paneID)
                self.runningScript = nil
            } catch {
                // The close RPC failed, so the pane may well still be alive
                // server-side (D-019: the server owns the pane). Keep the
                // Stop state — clearing it would lie about a running script —
                // and surface the failure as a workspace notification so the
                // user sees why the button did not flip.
                await self.diagnosticsActions.record(
                    category: .nativeShell,
                    severity: .error,
                    workspaceID: workspaceID,
                    title: "Stop script failed",
                    message: String(describing: error),
                    metadata: ["script": running.script.name]
                )
                _ = await self.notificationsHub.ingest(
                    Notifications.WorkspaceNotificationDraft(
                        workspaceID: workspaceID,
                        paneID: running.paneID,
                        title: "Stop \(running.script.displayName) failed",
                        body: "Fenrir could not close the script pane; it may still be running.",
                        source: .system
                    ),
                    isAppActive: self.isAppActive()
                )
                await self.refreshNotificationsProjectionNow()
            }
            self.scriptOperationInFlight = false
            self.refreshTitlebarControls()
            await self.refreshWorkspaceLayout?()
        }
    }

    /// F3 (D-045 attention loop): when the running script's pane stream ends
    /// (process exit, kill from another client), re-project the layout so
    /// `reconcileRunningScript` flips the Stop button back without a reconnect.
    private func handlePaneStreamEnded(_ paneID: PaneID) {
        guard runningScript?.paneID == paneID, let refreshWorkspaceLayout else {
            return
        }
        productivityTask = Task { @MainActor in
            await refreshWorkspaceLayout()
        }
    }

    private func presentManageScriptsOverlay() {
        rootView.updateManageableScripts(mergedWorkspaceScripts())
        shellController.presentOverlay(NativeOverlayHostView.manageScriptsOverlayID)
        restoreDeterministicFocus()
    }

    private func addWorkspaceScript(name: String, command: String) {
        guard let canonicalPath = workspaceCanonicalPath() else {
            return
        }
        let existing = productivityPreferences.load().scripts.repositoryScripts[canonicalPath] ?? []
        let kind: Settings.ScriptKind = existing.contains { $0.kind == .run } ? .custom : .run
        let script = Settings.ScriptDefinition(kind: kind, name: name, command: command)
        productivityPreferences.replaceRepositoryScripts(existing + [script], canonicalPath: canonicalPath)
        rootView.updateManageableScripts(mergedWorkspaceScripts())
        refreshTitlebarControls()
    }

    private func removeWorkspaceScript(_ scriptID: Settings.ScriptID) {
        guard let canonicalPath = workspaceCanonicalPath() else {
            return
        }
        let existing = productivityPreferences.load().scripts.repositoryScripts[canonicalPath] ?? []
        productivityPreferences.replaceRepositoryScripts(
            existing.filter { $0.id != scriptID },
            canonicalPath: canonicalPath
        )
        rootView.updateManageableScripts(mergedWorkspaceScripts())
        refreshTitlebarControls()
    }

    private func openWorkspaceInEditor(targetID: WorkspaceIndex.EditorTargetID?, persistChoice: Bool) {
        guard let workspacePath = workspaceCanonicalPath() else {
            return
        }
        let installed = editorOpener.installedTargets()
        let resolvedTargetID = targetID
            ?? productivityPreferences.editorTargetID(forRepositoryPath: workspacePath)
                .flatMap { preferred in installed.first { $0.id == preferred }?.id }
            ?? installed.first?.id
        guard let resolvedTargetID else {
            return
        }
        productivityTask = Task { @MainActor in
            switch await self.editorOpener.open(targetID: resolvedTargetID, workspacePath: workspacePath) {
            case .success(.opened):
                if persistChoice {
                    self.productivityPreferences.persistEditorTarget(resolvedTargetID, canonicalPath: workspacePath)
                }
                self.refreshTitlebarControls()
            case .success(.routeToTerminalPane(let command)):
                // $EDITOR runs inside a real tmux pane via the server (D-019);
                // the client never launches the editor process itself.
                if persistChoice {
                    self.productivityPreferences.persistEditorTarget(resolvedTargetID, canonicalPath: workspacePath)
                }
                let commandLine = ([command.executable] + command.arguments)
                    .map(Self.shellQuoted)
                    .joined(separator: " ")
                if let request = self.scriptPaneRequest(
                    command: commandLine,
                    title: "$EDITOR",
                    processDefID: "editor:environment"
                ) {
                    _ = await self.executeScriptPane(request, trackAs: nil)
                }
                self.refreshTitlebarControls()
            case .failure(let error):
                await self.diagnosticsActions.record(
                    category: .nativeShell,
                    severity: .error,
                    workspaceID: self.shellController.state.workspaceID,
                    title: "Open in editor failed",
                    message: error.rawValue,
                    metadata: ["target": resolvedTargetID.rawValue]
                )
            }
        }
    }

    private static func shellQuoted(_ value: String) -> String {
        guard value.rangeOfCharacter(from: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_./")).inverted) != nil else {
            return value
        }
        return "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    // MARK: - D-043/D-045 workspace notifications

    func ingestWorkspaceNotification(
        title: String?,
        body: String,
        paneID: PaneID?,
        source: Notifications.WorkspaceNotificationSource
    ) {
        let draft = Notifications.WorkspaceNotificationDraft(
            workspaceID: shellController.state.workspaceID,
            paneID: paneID,
            title: title,
            body: body,
            source: source
        )
        let hub = notificationsHub
        let active = isAppActive()
        productivityTask = Task { @MainActor in
            if await hub.ingest(draft, isAppActive: active) == nil {
                // D-043: malformed payloads are dropped with a diagnostics
                // count only — title/body content never reaches diagnostics
                // surfaces (D-031).
                await self.diagnosticsActions.record(
                    category: .nativeShell,
                    severity: .warning,
                    workspaceID: draft.workspaceID,
                    title: "Workspace notification dropped",
                    message: "D-043 sanitization dropped a malformed notification payload.",
                    metadata: ["notificationSource": draft.source.rawValue]
                )
            }
            await self.refreshNotificationsProjectionNow()
        }
    }

    private func refreshNotificationsProjection() {
        productivityTask = Task { @MainActor in
            await self.refreshNotificationsProjectionNow()
        }
    }

    private func refreshNotificationsProjectionNow() async {
        let workspaceID = shellController.state.workspaceID
        let store = notificationsHub.store
        let feed = await store.notifications(workspaceID: workspaceID)
        let unreadCount = await store.unreadCount(workspaceID: workspaceID)

        var latestLines: [WorkspaceID: String] = [:]
        var attentionWorkspaceIDs: Set<WorkspaceID> = []
        for item in shellController.state.sidebarItems {
            if let latest = await store.latest(workspaceID: item.workspaceID) {
                latestLines[item.workspaceID] = nativeSidebarLatestNotificationLine(latest)
            }
            if await store.unreadCount(workspaceID: item.workspaceID) > 0 {
                attentionWorkspaceIDs.insert(item.workspaceID)
            }
        }
        // Only panes still present in the server-owned layout can hold the
        // workspace in the attention set — a recorded waiting state for a
        // dead pane is stale by definition (D-045 attention loop stays
        // driven by live D-038/D-043 state).
        let livePaneIDs = Set(shellController.state.paneGridState.windows.flatMap(\.panes).map(\.paneID))
        let hasWaitingPane = presenceStateByPane.contains { paneID, state in
            livePaneIDs.contains(paneID) && (state == .awaitingInput || state == .awaitingApproval)
        }
        if hasWaitingPane {
            attentionWorkspaceIDs.insert(workspaceID)
        }

        rootView.updateNotifications(
            feed: feed,
            unreadCount: unreadCount,
            latestLines: latestLines,
            attentionWorkspaceIDs: attentionWorkspaceIDs
        )
        if unreadCount > 0 || !feed.isEmpty {
            shellController.updateWorkspaceNotifications(WorkspaceIndex.WorkspaceNotificationState(
                unreadCount: unreadCount,
                level: unreadCount > 0 ? .attention : .badge
            ))
            rootView.apply(shellController.state)
        }
        refreshTitlebarControls()
    }

    func presentNotificationsPanel() {
        shellController.presentOverlay(NativeOverlayHostView.notificationsOverlayID)
        restoreDeterministicFocus()
        refreshNotificationsProjection()
    }

    private func jumpToLatestUnreadNotification() {
        let workspaceID = shellController.state.workspaceID
        let store = notificationsHub.store
        productivityTask = Task { @MainActor in
            guard let latest = await store.latestUnread(workspaceID: workspaceID) else {
                return
            }
            _ = await store.markRead(latest.id)
            self.focusNotificationTarget(paneID: latest.paneID)
            await self.refreshNotificationsProjectionNow()
            self.restoreDeterministicFocus()
        }
    }

    private func selectNotification(_ notificationID: Notifications.NotificationID, paneID: PaneID?) {
        let store = notificationsHub.store
        productivityTask = Task { @MainActor in
            _ = await store.markRead(notificationID)
            self.focusNotificationTarget(paneID: paneID)
            await self.refreshNotificationsProjectionNow()
            self.restoreDeterministicFocus()
        }
    }

    private func markAllNotificationsRead() {
        let workspaceID = shellController.state.workspaceID
        let store = notificationsHub.store
        productivityTask = Task { @MainActor in
            _ = await store.markAllRead(workspaceID: workspaceID)
            await self.refreshNotificationsProjectionNow()
        }
    }

    private func focusNotificationTarget(paneID: PaneID?) {
        guard let paneID else {
            return
        }
        let panes = shellController.state.paneGridState.windows.flatMap(\.panes).map(\.paneID)
        guard panes.contains(paneID) else {
            return
        }
        _ = rootView.terminalPaneHost.paneGridView.focusPane(paneID)
        shellController.focusTerminal(paneID: paneID)
    }

    // MARK: - D-042 agent approval feed

    /// Subscribes to the server's approval-feed relay stream and projects
    /// pending cards into the feed overlay, the bell badge, and actionable
    /// macOS banners. The subscription re-establishes itself after stream
    /// failures; on resubscribe the pending set is resynced from the
    /// stream's replay, so a lost stream degrades to stale cards, never to
    /// client-side polling.
    func startApprovalFeedStreamIfNeeded() {
        guard approvalFeedTask == nil, let approvalFeedEventStream else {
            return
        }
        let store = approvalFeedStore
        approvalFeedTask = Task { [weak self] in
            var didRecordFailure = false
            while !Task.isCancelled {
                // The stream replays the authoritative pending set on
                // subscribe; drop local cards first so settled-while-offline
                // requests do not linger.
                await store.removeAll()
                let stream = await approvalFeedEventStream.observeApprovalFeed()
                do {
                    for try await event in stream {
                        didRecordFailure = false
                        await self?.applyApprovalFeedEvent(event)
                    }
                } catch is CancellationError {
                    return
                } catch {
                    if !didRecordFailure {
                        didRecordFailure = true
                        await self?.recordApprovalFeedStreamError(error)
                    }
                }
                guard !Task.isCancelled, self != nil else {
                    return
                }
                try? await Task.sleep(nanoseconds: 5_000_000_000)
            }
        }
    }

    private func applyApprovalFeedEvent(_ event: Notifications.ApprovalFeedStreamEvent) async {
        let outcome = await approvalFeedStore.apply(event)
        switch outcome {
        case .added(let card):
            // Actionable banner only while the app is inactive, mirroring
            // the D-043 banner rule; banner buttons decide directly.
            if !isAppActive() {
                await approvalBannerPresenter.presentApprovalBanner(card: card)
            }
        case .settled(let card, _, _):
            approvalDecisionsInFlight.remove(card.requestID)
            await approvalBannerPresenter.withdrawApprovalBanner(requestID: card.requestID)
        case .ignored:
            return
        }
        await refreshApprovalFeedProjectionNow()
    }

    private func recordApprovalFeedStreamError(_ error: Error) async {
        await diagnosticsActions.record(
            category: .serverConnection,
            severity: .warning,
            workspaceID: shellController.state.workspaceID,
            title: "Approval feed stream failed",
            message: String(describing: error),
            metadata: ["surface": "approval-feed"]
        )
    }

    private func refreshApprovalFeedProjectionNow() async {
        let cards = await approvalFeedStore.pendingCards(workspaceID: shellController.state.workspaceID)
        rootView.updateApprovalFeed(cards)
        refreshTitlebarControls()
    }

    func presentApprovalsPanel() {
        shellController.presentOverlay(NativeOverlayHostView.approvalsOverlayID)
        restoreDeterministicFocus()
        approvalFeedRefreshTask = Task { @MainActor in
            await self.refreshApprovalFeedProjectionNow()
        }
    }

    /// Dispatches exactly one decide RPC per card (D-040 authority: the
    /// hook applies the decision in the agent's process; the card leaves
    /// the overlay when the stream's settled event arrives).
    func decideApproval(requestID: String, optionID: String) {
        guard !approvalDecisionsInFlight.contains(requestID) else {
            return
        }
        guard let approvalFeedDecider else {
            return
        }
        approvalDecisionsInFlight.insert(requestID)
        approvalFeedRefreshTask = Task { @MainActor in
            do {
                try await approvalFeedDecider.decide(requestID: requestID, optionID: optionID)
            } catch {
                // Late/duplicate decisions are typed rejections; the agent
                // has already fallen back to its own TUI. Drop the local
                // card and record metadata-only diagnostics.
                self.approvalDecisionsInFlight.remove(requestID)
                _ = await self.approvalFeedStore.apply(
                    .settled(requestID: requestID, reason: .timeout, optionID: nil)
                )
                await self.approvalBannerPresenter.withdrawApprovalBanner(requestID: requestID)
                await self.diagnosticsActions.record(
                    category: .serverConnection,
                    severity: .warning,
                    workspaceID: self.shellController.state.workspaceID,
                    title: "Approval decision rejected",
                    message: String(describing: error),
                    metadata: ["surface": "approval-feed", "requestID": requestID]
                )
                await self.refreshApprovalFeedProjectionNow()
            }
        }
    }

    /// Read-only D-042 smoke: pending count plus last card metadata.
    /// D-031: the card summary embeds hook/injector-controlled content
    /// (`tool_name` from agent hook input), so — exactly like
    /// `runNotificationsSmoke` — only identifiers, the summary LENGTH, and an
    /// expected-marker match cross the diagnostics control channel; the
    /// summary text itself never does.
    func runApprovalFeedSmoke(expectedMarker: String? = nil) async -> [String: String] {
        await refreshApprovalFeedProjectionNow()
        let cards = rootView.visibleApprovalFeedCards()
        let last = cards.last
        let lastSummaryMatchesExpected = expectedMarker.map { marker in
            last?.summary.contains(marker) ?? false
        }
        return [
            "workspaceID": shellController.state.workspaceID.rawValue,
            "pendingCount": String(cards.count),
            "lastRequestID": last?.requestID ?? "",
            "lastKind": last?.kind.rawValue ?? "",
            "lastAgentID": last?.agentID ?? "",
            "lastSummaryLength": last.map { String($0.summary.count) } ?? "",
            "lastSummaryMatchesExpected": lastSummaryMatchesExpected.map(String.init) ?? "",
            "lastOptionIDs": last?.options.map(\.id).joined(separator: ",") ?? "",
            "panelVisible": String(shellController.state.activeOverlayIDs.contains(NativeOverlayHostView.approvalsOverlayID))
        ]
    }

    // MARK: - D-045 diagnostics smoke operations

    func runNotificationsSmoke(expectedMarker: String? = nil, dismiss: Bool = false) async -> [String: String] {
        // `dismiss` restores the pre-smoke overlay state after reading, so a
        // smoke against a live session does not leave the panel open. The
        // default keeps the panel visible (CI screenshots verify the panel).
        let panelWasAlreadyVisible = shellController.state.activeOverlayIDs
            .contains(NativeOverlayHostView.notificationsOverlayID)
        presentNotificationsPanel()
        await productivityTask?.value
        await refreshNotificationsProjectionNow()
        let feed = rootView.visibleNotificationsFeed()
        let latest = feed.last
        // D-031/D-043: notification title/body are user-visible content and are
        // excluded from the diagnostics control channel. The smoke returns
        // identifiers plus an expected-marker match so end-to-end verification
        // never exfiltrates pane-controlled text.
        let latestMatchesExpected = expectedMarker.map { marker in
            (latest?.title?.contains(marker) ?? false) || (latest?.body.contains(marker) ?? false)
        }
        var payload: [String: String] = [
            "workspaceID": shellController.state.workspaceID.rawValue,
            "unreadCount": String(rootView.visibleNotificationsUnreadCount()),
            "notificationCount": String(feed.count),
            "panelVisible": String(rootView.visibleOverlayTitles().contains("Notifications")),
            "latestNotificationID": latest?.id.rawValue ?? "",
            "latestSource": latest?.source.rawValue ?? "",
            "latestPaneID": latest?.paneID?.rawValue ?? ""
        ]
        payload["latestMatchesExpected"] = latestMatchesExpected.map(String.init) ?? ""
        payload["dismissed"] = String(dismiss && !panelWasAlreadyVisible)
        if dismiss, !panelWasAlreadyVisible {
            closeOverlay(NativeOverlayHostView.notificationsOverlayID)
        }
        return payload
    }

    func runTitlebarSmoke() async -> [String: String] {
        await refreshNotificationsProjectionNow()
        let controls = rootView.titlebarControlsState()
        return [
            "workspaceID": shellController.state.workspaceID.rawValue,
            "runButtonState": controls.run.phase.rawValue,
            "runButtonTitle": controls.run.title,
            "editorButtonTitle": controls.editor.title,
            "notificationBadgeCount": String(controls.notificationUnreadCount)
        ]
    }

    func runRunScriptSmoke(scriptCommand: String) async -> [String: String] {
        let script = Settings.ScriptDefinition(kind: .run, name: "smoke", command: scriptCommand)
        guard let request = scriptPaneRequest(
            command: script.command,
            title: script.name,
            processDefID: "script:\(script.id.rawValue)"
        ) else {
            return [
                "workspaceID": shellController.state.workspaceID.rawValue,
                "paneID": "",
                "runButtonState": rootView.titlebarControlsState().run.phase.rawValue,
                "error": "no-active-window"
            ]
        }
        let paneID = await executeScriptPane(request, trackAs: script)
        let controls = rootView.titlebarControlsState()
        return [
            "workspaceID": shellController.state.workspaceID.rawValue,
            "paneID": paneID?.rawValue ?? "",
            "runButtonState": controls.run.phase.rawValue,
            "runButtonTitle": controls.run.title,
            "error": paneID == nil ? "create-failed" : ""
        ]
    }

    /// Stop-path smoke (operation=stop): stops the tracked running script
    /// through the same Stop action the titlebar uses and reports the closed
    /// pane id, so verification can exercise Stop end-to-end.
    func runStopScriptSmoke() async -> [String: String] {
        guard let running = runningScript else {
            return [
                "workspaceID": shellController.state.workspaceID.rawValue,
                "stoppedPaneID": "",
                "runButtonState": rootView.titlebarControlsState().run.phase.rawValue,
                "error": "no-running-script"
            ]
        }
        stopRunningScript()
        await productivityTask?.value
        let controls = rootView.titlebarControlsState()
        let didStop = runningScript == nil
        return [
            "workspaceID": shellController.state.workspaceID.rawValue,
            "stoppedPaneID": didStop ? running.paneID.rawValue : "",
            "runButtonState": controls.run.phase.rawValue,
            "runButtonTitle": controls.run.title,
            "error": didStop ? "" : "stop-failed"
        ]
    }

    // MARK: - D-044 agent session resume

    /// User-initiated resume of a dead agent session (sidebar row action or
    /// palette). Resume is NEVER automatic — auto-resume on workspace
    /// projection is a deferred opt-in setting (D-044 follow-up). The command
    /// comes exclusively from the AgentIntegration descriptor table after
    /// session-id validation.
    func resumeAgentSession(agentID: AgentIntegration.AgentCLIIdentifier, sessionID: String) {
        guard !resumeOperationInFlight else {
            return
        }
        guard AgentIntegration.resumeCommand(agentID: agentID, sessionID: sessionID) != nil else {
            // Unsupported adapter or session id outside the allowlist — the
            // id never reaches the shell.
            return
        }
        let state = shellController.state
        let grid = state.paneGridState
        guard let window = grid.windows.first(where: { $0.windowID == grid.activeWindowID }) ?? grid.windows.first else {
            return
        }
        let request = NativeAgentResumeRequest(
            workspaceID: state.workspaceID,
            windowID: window.windowID,
            workingDirectory: workspaceCanonicalPath(),
            agentID: agentID,
            sessionID: sessionID
        )
        resumeOperationInFlight = true
        productivityTask = Task { @MainActor in
            do {
                _ = try await self.agentSessionResumer.resumeAgentSession(request)
                // The resumed pane is server-owned (D-019): re-project the
                // layout so it appears live, not on the next reconnect.
                await self.refreshWorkspaceLayout?()
            } catch {
                await self.diagnosticsActions.record(
                    category: .nativeShell,
                    severity: .error,
                    workspaceID: request.workspaceID,
                    title: "Agent session resume failed",
                    message: String(describing: error),
                    metadata: ["agentID": agentID.rawValue]
                )
                _ = await self.notificationsHub.ingest(
                    Notifications.WorkspaceNotificationDraft(
                        workspaceID: request.workspaceID,
                        paneID: nil,
                        title: "Resume failed",
                        body: "Fenrir could not relaunch the recorded agent session.",
                        source: .system
                    ),
                    isAppActive: self.isAppActive()
                )
                await self.refreshNotificationsProjectionNow()
            }
            self.resumeOperationInFlight = false
        }
    }

    /// Palette action ids carry only (agentID, sessionID); session ids cannot
    /// contain ":" (allowlist), so the 3-way split is unambiguous.
    private func executeResumeAgentPaletteAction(_ actionID: String) {
        let components = actionID.split(separator: ":", maxSplits: 2).map(String.init)
        guard components.count == 3,
              components[0] == "action-resume-agent",
              let agentID = AgentIntegration.AgentCLIIdentifier(rawValue: components[1])
        else {
            return
        }
        resumeAgentSession(agentID: agentID, sessionID: components[2])
    }

    /// D-044 diagnostics smoke: reports the resumable-session records the
    /// shell currently knows (agentID/sessionID/paneAlive), so verification
    /// can assert the plumbing without a real agent CLI.
    func runAgentResumeSmoke() -> [String: String] {
        let sessions = rootView.visibleResumableAgentSessions()
        return [
            "workspaceID": shellController.state.workspaceID.rawValue,
            "resumableCount": String(sessions.count),
            "deadResumableCount": String(sessions.filter { !$0.paneAlive }.count),
            "records": sessions
                .map { "\($0.agentID.rawValue):\($0.sessionID):paneAlive=\($0.paneAlive)" }
                .joined(separator: ",")
        ]
    }

    /// Read-only D-045 git-probe plumbing probe: refreshes the
    /// workspace.gitProbe projection and reports what the shell knows
    /// (branch/ahead/behind/PR + rendered chip tone) without touching panes,
    /// so no smoke-ops gate is required.
    func runGitProbeSmoke() async -> [String: String] {
        refreshWorkspaceGitProbe()
        await gitProbeRefreshTask?.value
        let workspaceID = shellController.state.workspaceID
        let snapshot = lastGitProbeSnapshot
        let chip = rootView.visibleWorkspacePullRequests()[workspaceID]
        return [
            "workspaceID": workspaceID.rawValue,
            "probeAvailable": gitProbeProvider == nil ? "false" : "true",
            "branch": snapshot?.branch ?? "",
            "ahead": snapshot?.ahead.map(String.init) ?? "",
            "behind": snapshot?.behind.map(String.init) ?? "",
            "prNumber": snapshot?.pr.map { String($0.number) } ?? "",
            "prState": snapshot?.pr?.state.rawValue ?? "",
            "prChecks": snapshot?.pr?.checks.rawValue ?? "",
            "chipTone": chip?.tone.rawValue ?? "",
            "chipGlyph": chip?.glyph ?? ""
        ]
    }

    private func toggleSidebar() {
        shellController.toggleSidebarVisibility()
        restoreDeterministicFocus()
    }

    private func focusTerminal() {
        shellController.focusTerminal()
        restoreDeterministicFocus()
    }

    private func focusSidebar() {
        shellController.focusSidebar()
        restoreDeterministicFocus()
    }

    private func dismissCommandPalette() {
        shellController.dismissCommandPalette()
        restoreDeterministicFocus()
    }

    private func closeOverlay(_ overlayID: WorkspaceOverlays.OverlayID) {
        shellController.closeOverlay(overlayID)
        restoreDeterministicFocus()
    }

    private func presentCommandPalette() {
        shellController.presentCommandPalette()
        restoreDeterministicFocus()
    }

    func presentCommandPaletteFromClientControl(query: String? = nil) {
        shellController.presentCommandPalette()
        rootView.apply(shellController.state)
        if let query, !query.isEmpty {
            rootView.setPaletteQuery(query)
        }
        restoreDeterministicFocus()
    }

    func executePaletteActionFromClientControl(actionID: String) {
        if actionID == "action-diagnostics" {
            presentDiagnosticsOverlay()
            rootView.apply(shellController.state)
            return
        }
        if actionID == "action-agent-integrations" || actionID == "action-settings-agent-integrations" {
            presentAgentIntegrationsOverlay()
            rootView.apply(shellController.state)
            return
        }
        if actionID == "workflow-panel" {
            presentWorkflowPanel()
            rootView.apply(shellController.state)
            return
        }
        if actionID == "action-run-script" {
            runPrimaryScriptOrStop()
            rootView.apply(shellController.state)
            return
        }
        if actionID == "action-stop-script" {
            stopRunningScript()
            rootView.apply(shellController.state)
            return
        }
        if actionID == "action-open-in-editor" {
            openWorkspaceInEditor(targetID: nil, persistChoice: false)
            rootView.apply(shellController.state)
            return
        }
        if actionID == "action-open-notifications" {
            presentNotificationsPanel()
            rootView.apply(shellController.state)
            return
        }
        if actionID == "action-jump-latest-unread" {
            jumpToLatestUnreadNotification()
            rootView.apply(shellController.state)
            return
        }
        if actionID == "action-open-approvals" {
            presentApprovalsPanel()
            rootView.apply(shellController.state)
            return
        }
        if actionID.hasPrefix("action-resume-agent:") {
            executeResumeAgentPaletteAction(actionID)
            rootView.apply(shellController.state)
            return
        }
        presentCommandPaletteFromClientControl(query: actionID)
    }

    func presentWorkflowPanelFromClientControl(operation: String, runID: String? = nil) {
        shellController.presentOverlay(NativeWorkflowOverlay.overlayID)
        rootView.apply(shellController.state)
        restoreDeterministicFocus()
        startWorkflowEventStreamIfNeeded()
        switch operation {
        case "timeline":
            if let runID {
                dispatchWorkflowCommand(WorkflowControl.WorkflowViewCommand(
                    kind: .observeTimeline(
                        runID: WorkflowControl.WorkflowRunID(rawValue: runID),
                        afterSequence: nil
                    )
                ))
            } else {
                dispatchWorkflowCommand(WorkflowControl.WorkflowViewCommand(kind: .refreshRuns))
            }
        default:
            dispatchWorkflowCommand(WorkflowControl.WorkflowViewCommand(kind: .refreshRuns))
        }
    }

    func presentDiagnosticsFromClientControl() {
        presentDiagnosticsOverlay()
        rootView.apply(shellController.state)
    }

    private func presentDiagnosticsOverlay() {
        refreshDiagnosticsOverlay()
        shellController.presentOverlay("diagnostics")
        restoreDeterministicFocus()
    }

    private func presentAgentIntegrationsOverlay() {
        shellController.presentOverlay(NativeAgentIntegrationOverlay.overlayID)
        restoreDeterministicFocus()
        dispatchAgentIntegrationCommand(.init(source: .workspaceShell, kind: .refresh))
    }

    private func presentAgentComposer(_ contextSource: Keybinding.AgentComposerContextSource) {
        enqueueAgentComposerAction { [weak self] in
            do {
                _ = try await self?.openAgentComposer(contextSource)
            } catch {
                NSLog("Fenrir Native agent composer open failed: \(String(describing: error))")
            }
        }
    }

    @discardableResult
    private func openAgentComposer(_ contextSource: Keybinding.AgentComposerContextSource) async throws -> AgentInteraction.ComposerState {
        let composer = try await agentComposerActions.openComposer(
            contextSource: contextSource,
            shellState: shellController.state,
            terminalHost: rootView.terminalPaneHost
        )
        rootView.updateAgentComposer(composer)
        shellController.presentOverlay(NativeAgentComposerOverlay.overlayID)
        rootView.apply(shellController.state)
        restoreDeterministicFocus()
        return composer
    }

    private func waitForTerminalText(_ text: String?, in terminal: FenrirTerminalView) async -> Bool {
        guard let text, !text.isEmpty else {
            return true
        }
        let deadline = Date().addingTimeInterval(2)
        while Date() < deadline {
            if terminal.captureLastLines(maxLines: nil).text.contains(text) {
                return true
            }
            try? await Task.sleep(nanoseconds: 25_000_000)
        }
        return terminal.captureLastLines(maxLines: nil).text.contains(text)
    }

    private func waitForTerminalTextStability(
        in terminal: FenrirTerminalView,
        stableNanoseconds: UInt64 = 150_000_000,
        timeoutNanoseconds: UInt64 = 1_000_000_000
    ) async {
        let deadline = DispatchTime.now().uptimeNanoseconds + timeoutNanoseconds
        var lastText = terminal.captureLastLines(maxLines: nil).text
        var stableSince = DispatchTime.now().uptimeNanoseconds

        while DispatchTime.now().uptimeNanoseconds < deadline {
            try? await Task.sleep(nanoseconds: 25_000_000)
            let currentText = terminal.captureLastLines(maxLines: nil).text
            let now = DispatchTime.now().uptimeNanoseconds
            if currentText == lastText {
                if now - stableSince >= stableNanoseconds {
                    return
                }
            } else {
                lastText = currentText
                stableSince = now
            }
        }
    }

    private func presentWorkflowPanel() {
        shellController.presentOverlay(NativeWorkflowOverlay.overlayID)
        restoreDeterministicFocus()
        startWorkflowEventStreamIfNeeded()
        dispatchWorkflowCommand(WorkflowControl.WorkflowViewCommand(kind: .refreshRuns))
    }

    private func startWorkflowEventStreamIfNeeded() {
        guard workflowEventStreamTask == nil else {
            return
        }
        let workspaceID = shellController.state.workspaceID
        let action = WorkflowControl.ObserveWorkflowEventStream(eventStream: workflowEventStream)
        workflowEventStreamTask = Task { [weak self] in
            let stream = await action.run(.init(
                requestID: RequestID(rawValue: "native-workflow-events-\(workspaceID.rawValue)"),
                filter: WorkflowControl.WorkflowEventStreamFilter(projectID: workspaceID.rawValue),
                source: .workspaceShell
            ))
            do {
                for try await item in stream {
                    await self?.applyWorkflowEventStreamItem(item)
                }
            } catch is CancellationError {
            } catch {
                await self?.recordWorkflowEventStreamError(error)
            }
        }
    }

    private func applyWorkflowEventStreamItem(_ item: WorkflowControl.WorkflowEventStreamItem) async {
        switch item.kind {
        case .runChanged:
            guard let run = item.run else { return }
            rootView.updateWorkflowRun(run)
        case .eventAppended:
            guard let event = item.event else { return }
            let state = rootView.visibleWorkflowState()
            guard state.timeline?.runID == event.runID || state.runs.contains(where: { $0.runID == event.runID }) else {
                return
            }
            rootView.updateWorkflowTimeline(mergedWorkflowTimeline(appending: event))
            if let notifications = await workflowNotifications.projectNotifications(from: [event]) {
                shellController.updateWorkspaceNotifications(notifications)
                rootView.apply(shellController.state)
            }
        }
    }

    private func mergedWorkflowTimeline(appending event: WorkflowControl.WorkflowTimelineEvent) -> WorkflowControl.WorkflowRunTimeline {
        let state = rootView.visibleWorkflowState()
        var events = state.timeline?.runID == event.runID ? state.timeline?.events ?? [] : []
        events.removeAll { $0.eventID == event.eventID }
        events.append(event)
        events.sort { lhs, rhs in
            if lhs.sequence == rhs.sequence {
                return lhs.createdAt < rhs.createdAt
            }
            return lhs.sequence < rhs.sequence
        }
        return WorkflowControl.WorkflowRunTimeline(
            runID: event.runID,
            events: events,
            projectedStatus: state.runs.first(where: { $0.runID == event.runID })?.status,
            nextSequence: events.last.map { $0.sequence + 1 },
            replayedFromSequence: max(0, event.sequence - 1),
            replayIncludesHistoricalEvents: false
        )
    }

    private func recordWorkflowEventStreamError(_ error: Error) async {
        await diagnosticsActions.record(
            category: .workflow,
            severity: .error,
            workspaceID: shellController.state.workspaceID,
            title: "Workflow event stream failed",
            message: String(describing: error),
            metadata: ["surface": "workflow-panel"]
        )
        if let workflowError = error as? WorkflowControl.WorkflowControlError {
            rootView.updateWorkflowError(workflowError)
        } else {
            rootView.updateWorkflowError(.serverFailure(String(describing: error)))
        }
    }

    private func dispatchWorkflowCommand(_ command: WorkflowControl.WorkflowViewCommand) {
        workflowTask = Task { @MainActor in
            let update = await workflowActions.dispatch(command)
            switch update {
            case .runs(let runs):
                rootView.updateWorkflowRuns(runs)
            case .timeline(let timeline):
                rootView.updateWorkflowTimeline(timeline)
                if let notifications = await workflowNotifications.projectNotifications(from: timeline.events) {
                    shellController.updateWorkspaceNotifications(notifications)
                    rootView.apply(shellController.state)
                }
            case .run(let run):
                rootView.updateWorkflowRun(run)
            case .error(let error):
                await diagnosticsActions.record(
                    category: .workflow,
                    severity: .error,
                    workspaceID: shellController.state.workspaceID,
                    title: "Workflow command failed",
                    message: String(describing: error),
                    metadata: ["surface": "workflow-panel"]
                )
                rootView.updateWorkflowError(error)
            }
            restoreDeterministicFocus()
        }
    }

    private func dispatchAgentIntegrationCommand(_ command: AgentIntegration.AgentIntegrationViewCommand) {
        agentIntegrationTask = Task { @MainActor in
            let state = await agentIntegrationActions.dispatch(command, workspaceID: shellController.state.workspaceID)
            rootView.updateAgentIntegration(state)
            if let message = state.lastErrorMessage {
                await diagnosticsActions.record(
                    category: .nativeShell,
                    severity: .error,
                    workspaceID: shellController.state.workspaceID,
                    title: "Agent Integrations command failed",
                    message: message,
                    metadata: ["command": String(describing: command.kind)]
                )
            }
            restoreDeterministicFocus()
        }
    }

    private func runFirstRunAgentIntegrationRefreshIfNeeded() {
        guard !didRunFirstRunAgentIntegrationRefresh else {
            return
        }
        didRunFirstRunAgentIntegrationRefresh = true
        agentIntegrationTask = Task { @MainActor in
            let command = AgentIntegration.AgentIntegrationViewCommand(source: .workspaceShell, kind: .refresh)
            let state = await agentIntegrationActions.dispatch(command, workspaceID: shellController.state.workspaceID)
            rootView.updateAgentIntegration(state)
            let promptGate = AgentIntegration.AgentIntegrationFirstRunPromptGate.applicationSupport()
            guard promptGate?.shouldPresentPrompt(for: state) ?? state.shouldPresentFirstRunPrompt else {
                restoreDeterministicFocus()
                return
            }
            promptGate?.markPromptPresented(for: state)
            await diagnosticsActions.record(
                category: .nativeShell,
                severity: .warning,
                workspaceID: shellController.state.workspaceID,
                title: "Agent Integrations first-run prompt shown",
                message: state.summaryText,
                metadata: [
                    "degradedAgentIDs": state.degradedStatuses.map(\.agent.id.rawValue).joined(separator: ",")
                ]
            )
            shellController.presentOverlay(NativeAgentIntegrationOverlay.overlayID)
            restoreDeterministicFocus()
        }
    }

    private func submitAgentComposer(_ command: AgentInteraction.SubmitComposerDraftCommand) {
        enqueueAgentComposerAction { [weak self] in
            guard let self else {
                return
            }
            let result = await self.agentComposerActions.submitComposer(command)
            self.rootView.updateAgentComposer(result.composer, error: result.error)
            self.restoreDeterministicFocus()
        }
    }

    private func cancelAgentComposer(_ input: AgentInteraction.CancelAgentComposerInput) {
        enqueueAgentComposerAction { [weak self] in
            guard let self else {
                return
            }
            guard let composer = await self.agentComposerActions.cancelComposer(input) else {
                return
            }
            self.rootView.updateAgentComposer(composer)
            self.shellController.closeOverlay(NativeAgentComposerOverlay.overlayID)
            self.restoreDeterministicFocus()
        }
    }

    private func enqueueAgentComposerAction(_ operation: @escaping @MainActor @Sendable () async -> Void) {
        agentComposerTask = Task { @MainActor in
            await operation()
        }
    }

    private func executePaletteAction(_ action: WorkspaceOverlays.PaletteAction) {
        switch action {
        case .switchWorkspace(let workspaceID):
            shellController.dismissCommandPalette()
            switchWorkspace(workspaceID)
        case .openDiagnostics:
            shellController.dismissCommandPalette()
            refreshDiagnosticsOverlay(
                category: .keybinding,
                title: "Diagnostics opened from palette",
                message: "Command palette executed the diagnostics overlay action.",
                metadata: ["action": "openDiagnostics"]
            )
            shellController.presentOverlay("diagnostics")
        case .openWorkflow:
            shellController.dismissCommandPalette()
            shellController.presentOverlay(NativeWorkflowOverlay.overlayID)
            dispatchWorkflowCommand(WorkflowControl.WorkflowViewCommand(kind: .refreshRuns))
        case .runAction("action-agent-integrations"), .runAction("action-settings-agent-integrations"):
            shellController.dismissCommandPalette()
            presentAgentIntegrationsOverlay()
        case .openHelp(let topic):
            shellController.dismissCommandPalette()
            shellController.presentOverlay(WorkspaceOverlays.OverlayID(rawValue: "help-\(topic)"))
        case .runAction("toggle-sidebar"):
            shellController.dismissCommandPalette()
            shellController.toggleSidebarVisibility()
        case .runAction("action-run-script"):
            shellController.dismissCommandPalette()
            runPrimaryScriptOrStop()
        case .runAction("action-stop-script"):
            shellController.dismissCommandPalette()
            stopRunningScript()
        case .runAction("action-open-in-editor"):
            shellController.dismissCommandPalette()
            openWorkspaceInEditor(targetID: nil, persistChoice: false)
        case .runAction("action-open-approvals"):
            presentApprovalsPanel()
        case .runAction("action-open-notifications"):
            shellController.dismissCommandPalette()
            presentNotificationsPanel()
        case .runAction("action-jump-latest-unread"):
            shellController.dismissCommandPalette()
            jumpToLatestUnreadNotification()
        case .runAction(let actionID) where actionID.hasPrefix("action-resume-agent:"):
            shellController.dismissCommandPalette()
            executeResumeAgentPaletteAction(actionID)
        case .openFile(let path):
            shellController.dismissCommandPalette()
            let state = shellController.state
            neovimTask = Task { @MainActor [weak self] in
                guard let self else {
                    return
                }
                await self.neovimBridgeActions.openFile(path, in: state)
                self.restoreDeterministicFocus()
            }
        default:
            shellController.dismissCommandPalette()
        }
        restoreDeterministicFocus()
    }

    private func refreshDiagnosticsOverlay(
        category: Diagnostics.DiagnosticCategory = .nativeShell,
        title: String = "Diagnostics overlay requested",
        message: String = "Native shell is presenting support-bundle-safe diagnostics.",
        metadata: [String: String] = ["overlay": "diagnostics"]
    ) {
        diagnosticsTask = Task { @MainActor in
            await diagnosticsActions.record(
                category: category,
                severity: .info,
                workspaceID: shellController.state.workspaceID,
                title: title,
                message: message,
                metadata: metadata
            )
            let viewModel = await diagnosticsActions.overlayViewModel(workspaceID: shellController.state.workspaceID)
            rootView.updateDiagnostics(viewModel)
            rootView.apply(shellController.state)
        }
    }

    private func focus(_ surface: NativeWorkspaceFocusSurface) {
        switch surface {
        case .terminal:
            rootView.terminalPaneHost.setTerminalFocused(true)
        case .sidebar:
            rootView.terminalPaneHost.setTerminalFocused(false)
            view.window?.makeFirstResponder(rootView.sidebarList)
        case .overlay:
            rootView.terminalPaneHost.setTerminalFocused(false)
            if let composerView = rootView.overlayHost.visibleAgentComposerView() {
                composerView.focusPrompt(in: view.window)
            } else {
                view.window?.makeFirstResponder(rootView.overlayHost)
            }
        case .commandPalette:
            rootView.terminalPaneHost.setTerminalFocused(false)
            view.window?.makeFirstResponder(rootView.overlayHost)
        }
    }
}

enum NativeWorkspaceShellKeyboardShortcut: Equatable, Sendable {
    case commandPalette
    case diagnostics
    case toggleSidebar
    case workspaceHotkey(Int)
    case agentComposer(Keybinding.AgentComposerContextSource)
    /// D-045: ⌘⇧U jumps to the pane of the latest unread notification. Only
    /// consumed while an unread notification exists; otherwise the event
    /// falls through to the terminal.
    case jumpToLatestUnread
}

private extension NativeWorkspaceShellKeyboardShortcut {
    init?(event: NSEvent) {
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard let key = event.charactersIgnoringModifiers?.lowercased() else {
            return nil
        }

        switch key {
        case "p" where modifiers == [.command]:
            self = .commandPalette
        case "b" where modifiers == [.command]:
            self = .toggleSidebar
        case "d" where modifiers == [.command, .shift]:
            self = .diagnostics
        case "a" where modifiers == [.command, .shift]:
            self = .agentComposer(.selection)
        case "a" where modifiers == [.command, .option]:
            self = .agentComposer(.viewport)
        case "a" where modifiers == [.control, .option]:
            self = .agentComposer(.lastLines(80))
        case "u" where modifiers == [.command, .shift]:
            self = .jumpToLatestUnread
        case "1", "2", "3", "4", "5", "6", "7", "8", "9":
            guard modifiers == [.command], let slot = Int(key) else {
                return nil
            }
            self = .workspaceHotkey(slot)
        default:
            return nil
        }
    }
}

private enum NativeWorkspaceShellKeyboardEventFactory {
    static func commandP(windowNumber: Int) -> NSEvent? {
        NSEvent.keyEvent(
            with: .keyDown,
            location: .zero,
            modifierFlags: .command,
            timestamp: 0,
            windowNumber: windowNumber,
            context: nil,
            characters: "p",
            charactersIgnoringModifiers: "p",
            isARepeat: false,
            keyCode: 35
        )
    }
}

@MainActor
final class NativeWorkspaceRootView: NSView {
    let terminalPaneHost: NativeTerminalPaneHostView
    let sidebarList: NativeWorkspaceSidebarView
    let overlayHost: NativeOverlayHostView
    let themeTokens: NativeShellThemeTokens

    var onToggleSidebar: (() -> Void)?
    var onFocusTerminal: (() -> Void)?
    var onFocusSidebar: (() -> Void)?
    var onDismissCommandPalette: (() -> Void)?
    var onCloseOverlay: ((WorkspaceOverlays.OverlayID) -> Void)?
    var onExecutePaletteAction: ((WorkspaceOverlays.PaletteAction) -> Void)?
    var onPresentCommandPalette: (() -> Void)?
    var onPresentDiagnosticsOverlay: (() -> Void)?
    var onPresentAgentComposer: ((Keybinding.AgentComposerContextSource) -> Void)?
    var onPresentWorkflowPanel: (() -> Void)?
    var onSubmitAgentComposer: ((AgentInteraction.SubmitComposerDraftCommand) -> Void)?
    var onCancelAgentComposer: ((AgentInteraction.CancelAgentComposerInput) -> Void)?
    var onWorkflowCommand: ((WorkflowControl.WorkflowViewCommand) -> Void)?
    var onAgentIntegrationCommand: ((AgentIntegration.AgentIntegrationViewCommand) -> Void)?
    var onSwitchWorkspace: ((WorkspaceID) -> Void)?
    var onOpenAgentIntegrations: (() -> Void)?
    var onRunPrimaryScript: (() -> Void)?
    var onRunScript: ((Settings.ScriptID) -> Void)?
    var onManageScripts: (() -> Void)?
    var onOpenEditorPrimary: (() -> Void)?
    var onPickEditorTarget: ((WorkspaceIndex.EditorTargetID) -> Void)?
    var onOpenNotifications: (() -> Void)?
    var onJumpToLatestUnread: (() -> Void)?
    var onSelectNotification: ((Notifications.NotificationID, PaneID?) -> Void)?
    var onMarkAllNotificationsRead: (() -> Void)?
    /// D-042 approval feed: open the overlay / decide (requestID, optionID).
    var onOpenApprovals: (() -> Void)?
    var onDecideApproval: ((String, String) -> Void)?
    var onAddScript: ((String, String) -> Void)?
    var onRemoveScript: ((Settings.ScriptID) -> Void)?
    /// D-044: user-initiated resume of a dead agent session.
    var onResumeAgentSession: ((AgentIntegration.AgentCLIIdentifier, String) -> Void)?

    private let titlebar: NativeShellTitlebarView
    private let statusBar: NativeShellStatusBarView
    private let bodyRow = NSView()
    private let sidebarContainer = NSView()
    private let mainContainer = NSView()
    private let reconnectBanner = NSTextField(labelWithString: "")
    private var sidebarWidthConstraint: NSLayoutConstraint?
    private var bannerHeightConstraint: NSLayoutConstraint?
    private var lastAppliedState: NativeWorkspaceShellState?
    private var agentComposer: AgentInteraction.ComposerState?
    private var workflowRuns: [WorkflowControl.WorkflowRunSnapshot] = []
    private var workflowTimeline: WorkflowControl.WorkflowRunTimeline?
    private var workflowError: WorkflowControl.WorkflowControlError?
    private var agentPresenceRecords: [AgentIntegration.AgentPresenceRecord] = []
    private var diagnosticsViewModel = Diagnostics.DiagnosticsOverlayViewModel(report: Diagnostics.DiagnosticsReport(
        generatedAt: FenrirTimestamp(Date(timeIntervalSince1970: 0)),
        policy: .defaults,
        events: [],
        categoryCounts: [:],
        redactionNotice: "Sensitive metadata and terminal content are redacted."
    ))
    private var agentIntegrationState: AgentIntegration.AgentIntegrationPanelState?
    private var titlebarControls = NativeShellTitlebarControlsState()
    private var notificationsFeed: [Notifications.WorkspaceNotification] = []
    private var notificationsUnreadCount = 0
    private var approvalFeedCards: [Notifications.ApprovalFeedCard] = []
    private var latestNotificationLines: [WorkspaceID: String] = [:]
    private var attentionWorkspaceIDs: Set<WorkspaceID> = []
    private var workspaceBranches: [WorkspaceID: String] = [:]
    private var workspacePullRequests: [WorkspaceID: WorkspaceIndex.WorkspaceGitPullRequestChip] = [:]
    private var localServerPortChips: [NativeSidebarWorkspacePortChip] = []
    private var manageableScripts: [Settings.ScriptDefinition] = []

    init(
        state: NativeWorkspaceShellState,
        paneGridActions: (any NativePaneGridActionDispatching)? = nil,
        paneStreamSubscriber: NativePaneStreamSubscriber? = nil,
        terminalStreamIngestor: NativeTerminalStreamIngestor? = nil,
        themeTokens: NativeShellThemeTokens = .resolve(Settings.NativeSettingsConfiguration.defaults.appearance.themeID)
    ) {
        self.themeTokens = themeTokens
        titlebar = NativeShellTitlebarView(themeTokens: themeTokens)
        statusBar = NativeShellStatusBarView(themeTokens: themeTokens)
        sidebarList = NativeWorkspaceSidebarView(themeTokens: themeTokens)
        overlayHost = NativeOverlayHostView(themeTokens: themeTokens)
        terminalPaneHost = NativeTerminalPaneHostView(
            paneGridState: state.paneGridState,
            paneGridActions: paneGridActions,
            paneStreamSubscriber: paneStreamSubscriber,
            terminalStreamIngestor: terminalStreamIngestor,
            themeTokens: themeTokens
        )
        super.init(frame: .zero)
        buildViewTree()
        apply(state)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override var acceptsFirstResponder: Bool { true }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if let shortcut = NativeWorkspaceShellKeyboardShortcut(event: event) {
            return handleShellKeyboardShortcut(shortcut)
        }
        return super.performKeyEquivalent(with: event)
    }

    @discardableResult
    func handleShellKeyboardShortcut(_ shortcut: NativeWorkspaceShellKeyboardShortcut) -> Bool {
        switch shortcut {
        case .commandPalette:
            onPresentCommandPalette?()
        case .diagnostics:
            onPresentDiagnosticsOverlay?()
        case .toggleSidebar:
            onToggleSidebar?()
        case .workspaceHotkey(let slot):
            guard let items = lastAppliedState?.sidebarItems else {
                return false
            }
            let ordered = NativeSidebarViewModel.hotkeyOrderedWorkspaces(items: items)
            guard ordered.indices.contains(slot - 1) else {
                return false
            }
            onSwitchWorkspace?(ordered[slot - 1].workspaceID)
        case .agentComposer(let contextSource):
            onPresentAgentComposer?(contextSource)
        case .jumpToLatestUnread:
            // Only consume ⌘⇧U while an unread notification exists; otherwise
            // let the event fall through to the terminal (D-045).
            guard notificationsUnreadCount > 0 else {
                return false
            }
            onJumpToLatestUnread?()
        }
        return true
    }

    func updateTitlebarControls(_ controls: NativeShellTitlebarControlsState) {
        titlebarControls = controls
        titlebar.applyControls(controls)
    }

    func titlebarControlsState() -> NativeShellTitlebarControlsState {
        titlebar.controlsState
    }

    func titlebarRunIndicatorVisible() -> Bool {
        titlebar.runControlShowsRunningIndicator()
    }

    func updateNotifications(
        feed: [Notifications.WorkspaceNotification],
        unreadCount: Int,
        latestLines: [WorkspaceID: String],
        attentionWorkspaceIDs: Set<WorkspaceID>
    ) {
        notificationsFeed = feed
        notificationsUnreadCount = unreadCount
        latestNotificationLines = latestLines
        self.attentionWorkspaceIDs = attentionWorkspaceIDs
        overlayHost.updateNotificationsPanel(feed: feed, unreadCount: unreadCount)
        if let lastAppliedState {
            applyChrome(lastAppliedState)
        }
    }

    func visibleNotificationsFeed() -> [Notifications.WorkspaceNotification] {
        notificationsFeed
    }

    func visibleNotificationsUnreadCount() -> Int {
        notificationsUnreadCount
    }

    /// D-042 approval feed projection (current workspace pending cards).
    func updateApprovalFeed(_ cards: [Notifications.ApprovalFeedCard]) {
        approvalFeedCards = cards
        overlayHost.updateApprovalsPanel(cards: cards)
        if let lastAppliedState {
            applyChrome(lastAppliedState)
        }
    }

    func visibleApprovalFeedCards() -> [Notifications.ApprovalFeedCard] {
        approvalFeedCards
    }

    func visibleApprovalsPendingCount() -> Int {
        approvalFeedCards.count
    }

    func visibleAttentionWorkspaceIDs() -> Set<WorkspaceID> {
        attentionWorkspaceIDs
    }

    /// D-045 row metadata: current branch per workspace (server vcs contract).
    func updateWorkspaceBranch(_ workspaceID: WorkspaceID, branch: String?) {
        guard workspaceBranches[workspaceID] != branch else {
            return
        }
        workspaceBranches[workspaceID] = branch
        if let lastAppliedState {
            applyChrome(lastAppliedState)
        }
    }

    /// D-045 row metadata: PR status chip per workspace (server
    /// workspace.gitProbe contract).
    func updateWorkspacePullRequest(
        _ workspaceID: WorkspaceID,
        chip: WorkspaceIndex.WorkspaceGitPullRequestChip?
    ) {
        guard workspacePullRequests[workspaceID] != chip else {
            return
        }
        workspacePullRequests[workspaceID] = chip
        if let lastAppliedState {
            applyChrome(lastAppliedState)
        }
    }

    func visibleWorkspacePullRequests() -> [WorkspaceID: WorkspaceIndex.WorkspaceGitPullRequestChip] {
        workspacePullRequests
    }

    /// D-045 row metadata: listening-port chips (localServers discovery).
    func updateLocalServerPorts(_ chips: [NativeSidebarWorkspacePortChip]) {
        guard localServerPortChips != chips else {
            return
        }
        localServerPortChips = chips
        if let lastAppliedState {
            applyChrome(lastAppliedState)
        }
    }

    func visibleWorkspaceBranches() -> [WorkspaceID: String] {
        workspaceBranches
    }

    func visibleLocalServerPortChips() -> [NativeSidebarWorkspacePortChip] {
        localServerPortChips
    }

    func updateAttentionPaneIDs(_ paneIDs: Set<PaneID>) {
        terminalPaneHost.paneGridView.applyAttentionPaneIDs(paneIDs)
    }

    func updateManageableScripts(_ scripts: [Settings.ScriptDefinition]) {
        manageableScripts = scripts
        overlayHost.updateManageScripts(scripts)
    }

    func updateAgentComposer(_ composer: AgentInteraction.ComposerState, error: AgentInteraction.AgentInteractionError? = nil) {
        agentComposer = composer
        overlayHost.updateAgentComposer(composer, error: error)
    }

    func updateWorkflowRuns(_ runs: [WorkflowControl.WorkflowRunSnapshot]) {
        workflowRuns = runs
        workflowError = nil
        overlayHost.updateWorkflow(runs: runs, timeline: workflowTimeline, error: nil)
        if let lastAppliedState {
            applyChrome(lastAppliedState)
        }
    }

    func updateWorkflowTimeline(_ timeline: WorkflowControl.WorkflowRunTimeline) {
        workflowTimeline = timeline
        workflowError = nil
        overlayHost.updateWorkflow(runs: workflowRuns, timeline: timeline, error: nil)
    }

    func updateWorkflowRun(_ run: WorkflowControl.WorkflowRunSnapshot) {
        if let index = workflowRuns.firstIndex(where: { $0.runID == run.runID }) {
            workflowRuns[index] = run
        } else {
            workflowRuns.insert(run, at: 0)
        }
        workflowError = nil
        overlayHost.updateWorkflow(runs: workflowRuns, timeline: workflowTimeline, error: nil)
    }

    func updateWorkflowError(_ error: WorkflowControl.WorkflowControlError) {
        workflowError = error
        overlayHost.updateWorkflow(runs: workflowRuns, timeline: workflowTimeline, error: error)
    }

    func updateDiagnostics(_ viewModel: Diagnostics.DiagnosticsOverlayViewModel) {
        diagnosticsViewModel = viewModel
        overlayHost.updateDiagnostics(viewModel)
    }

    func updateAgentIntegration(_ state: AgentIntegration.AgentIntegrationPanelState) {
        agentIntegrationState = state
        overlayHost.updateAgentIntegration(state)
        if let lastAppliedState {
            applyChrome(lastAppliedState)
        }
    }

    func updateAgentPresence(_ records: [AgentIntegration.AgentPresenceRecord]) {
        agentPresenceRecords = records
        if let lastAppliedState {
            applyChrome(lastAppliedState)
        }
    }

    /// D-044: recorded resumable agent sessions, derived from the workspace's
    /// presence records against the live pane grid. `paneAlive == false`
    /// means the pane process is gone and the session is offered for resume.
    static func resumableAgentSessions(
        records: [AgentIntegration.AgentPresenceRecord],
        state: NativeWorkspaceShellState
    ) -> [AgentIntegration.AgentResumableSessionSnapshot] {
        AgentIntegration.resumableAgentSessions(
            records: records.filter { $0.provenance.workspaceID == state.workspaceID },
            livePaneIDs: Set(state.paneGridState.windows.flatMap(\.panes).map(\.paneID))
        )
    }

    func visibleResumableAgentSessions() -> [AgentIntegration.AgentResumableSessionSnapshot] {
        guard let lastAppliedState else {
            return []
        }
        return Self.resumableAgentSessions(records: agentPresenceRecords, state: lastAppliedState)
    }

    func apply(_ state: NativeWorkspaceShellState) {
        lastAppliedState = state
        sidebarContainer.isHidden = !state.isSidebarVisible
        sidebarWidthConstraint?.constant = state.isSidebarVisible ? NativeShellChromeMetrics.sidebarWidth : 0
        reconnectBanner.isHidden = state.reconnectBanner == nil
        reconnectBanner.stringValue = state.reconnectBanner?.message ?? ""
        bannerHeightConstraint?.constant = state.reconnectBanner == nil ? 0 : 28
        terminalPaneHost.applyPaneGrid(state.paneGridState)
        applyChrome(state)
        overlayHost.apply(
            focusedSurface: state.focusedSurface,
            activeOverlayIDs: state.activeOverlayIDs,
            paletteItems: paletteItems(for: state),
            agentComposer: agentComposer,
            workflowRuns: workflowRuns,
            workflowTimeline: workflowTimeline,
            workflowError: workflowError,
            diagnosticsViewModel: diagnosticsViewModel,
            agentIntegrationState: agentIntegrationState
        )
    }

    private func applyChrome(_ state: NativeWorkspaceShellState) {
        let currentItem = state.sidebarItems.first { $0.workspaceID == state.workspaceID }
        let attentionCount = currentItem?.notificationLevel == .attention ? (currentItem?.notificationCount ?? 0) : 0
        let attentionText = attentionCount > 0 ? "\(attentionCount) need input" : nil
        let isConnected = state.reconnectBanner == nil

        titlebar.apply(
            windows: state.paneGridState.windows,
            activeWindowID: state.paneGridState.activeWindowID,
            agentPresenceRecords: agentPresenceRecords,
            health: NativeShellHealthSummary(
                serverText: isConnected ? state.workspaceID.rawValue : (state.reconnectBanner?.message ?? "reconnecting…"),
                isServerHealthy: isConnected,
                attentionText: attentionText
            ),
            controls: titlebarControls
        )

        sidebarList.apply(model: NativeSidebarViewModel(
            items: state.sidebarItems,
            activeWorkspaceID: state.workspaceID,
            paneGridState: state.paneGridState,
            agentStatuses: agentIntegrationState?.statuses ?? [],
            agentPresenceRecords: agentPresenceRecords,
            workflowRuns: workflowRuns,
            serverStatusText: isConnected ? "local server" : "server reconnecting…",
            isServerHealthy: isConnected,
            latestNotificationLines: latestNotificationLines,
            attentionWorkspaceIDs: attentionWorkspaceIDs,
            workspaceBranches: workspaceBranches,
            workspacePullRequests: workspacePullRequests,
            activeWorkspacePorts: localServerPortChips,
            resumableAgentSessions: Self.resumableAgentSessions(records: agentPresenceRecords, state: state)
        ))

        let paneCount = state.paneGridState.windows
            .first { $0.windowID == state.paneGridState.activeWindowID }?
            .panes.count ?? 0
        statusBar.apply(
            connectionText: isConnected ? "connected" : (state.reconnectBanner?.message ?? "reconnecting…"),
            isHealthy: isConnected,
            tmuxSummary: "tmux \(state.workspaceID.rawValue) · \(paneCount) pane\(paneCount == 1 ? "" : "s")",
            attentionText: attentionText
        )
    }

    func setPaletteQuery(_ query: String) {
        overlayHost.setPaletteQuery(query)
    }

    func visibleOverlayTitles() -> [String] {
        overlayHost.visibleOverlayTitles()
    }

    func visibleAgentComposerState() -> AgentInteraction.ComposerState? {
        agentComposer
    }

    func visibleWorkflowState() -> (
        runs: [WorkflowControl.WorkflowRunSnapshot],
        timeline: WorkflowControl.WorkflowRunTimeline?,
        error: WorkflowControl.WorkflowControlError?
    ) {
        (workflowRuns, workflowTimeline, workflowError)
    }

    func visibleAgentIntegrationState() -> AgentIntegration.AgentIntegrationPanelState? {
        agentIntegrationState
    }

    private func buildViewTree() {
        wantsLayer = true
        layer?.backgroundColor = themeTokens.rootBackground.cgColor

        [titlebar, bodyRow, overlayHost].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }
        [sidebarContainer, mainContainer].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            bodyRow.addSubview($0)
        }

        titlebar.onToggleSidebar = { [weak self] in self?.onToggleSidebar?() }
        titlebar.onSelectWindow = { [weak self] windowID in
            _ = self?.terminalPaneHost.paneGridView.selectWindow(windowID)
        }
        titlebar.onRunPrimaryScript = { [weak self] in self?.onRunPrimaryScript?() }
        titlebar.onRunScript = { [weak self] scriptID in self?.onRunScript?(scriptID) }
        titlebar.onManageScripts = { [weak self] in self?.onManageScripts?() }
        titlebar.onOpenEditorPrimary = { [weak self] in self?.onOpenEditorPrimary?() }
        titlebar.onPickEditorTarget = { [weak self] targetID in self?.onPickEditorTarget?(targetID) }
        titlebar.onOpenNotifications = { [weak self] in self?.onOpenNotifications?() }

        sidebarWidthConstraint = sidebarContainer.widthAnchor.constraint(equalToConstant: NativeShellChromeMetrics.sidebarWidth)
        NSLayoutConstraint.activate([
            titlebar.leadingAnchor.constraint(equalTo: leadingAnchor),
            titlebar.trailingAnchor.constraint(equalTo: trailingAnchor),
            titlebar.topAnchor.constraint(equalTo: topAnchor),

            bodyRow.leadingAnchor.constraint(equalTo: leadingAnchor),
            bodyRow.trailingAnchor.constraint(equalTo: trailingAnchor),
            bodyRow.topAnchor.constraint(equalTo: titlebar.bottomAnchor),
            bodyRow.bottomAnchor.constraint(equalTo: bottomAnchor),

            sidebarContainer.leadingAnchor.constraint(equalTo: bodyRow.leadingAnchor),
            sidebarContainer.topAnchor.constraint(equalTo: bodyRow.topAnchor),
            sidebarContainer.bottomAnchor.constraint(equalTo: bodyRow.bottomAnchor),
            sidebarWidthConstraint!,
            mainContainer.leadingAnchor.constraint(equalTo: sidebarContainer.trailingAnchor),
            mainContainer.trailingAnchor.constraint(equalTo: bodyRow.trailingAnchor),
            mainContainer.topAnchor.constraint(equalTo: bodyRow.topAnchor),
            mainContainer.bottomAnchor.constraint(equalTo: bodyRow.bottomAnchor),

            overlayHost.leadingAnchor.constraint(equalTo: leadingAnchor),
            overlayHost.trailingAnchor.constraint(equalTo: trailingAnchor),
            overlayHost.topAnchor.constraint(equalTo: topAnchor),
            overlayHost.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])

        buildSidebar()
        buildMainArea()
    }

    private func buildSidebar() {
        sidebarContainer.wantsLayer = true
        sidebarContainer.layer?.backgroundColor = themeTokens.sidebarBackground.cgColor

        let rightHairline = NSView()
        rightHairline.wantsLayer = true
        rightHairline.layer?.backgroundColor = themeTokens.hairline.cgColor

        [sidebarList, rightHairline].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            sidebarContainer.addSubview($0)
        }
        NSLayoutConstraint.activate([
            sidebarList.leadingAnchor.constraint(equalTo: sidebarContainer.leadingAnchor),
            sidebarList.trailingAnchor.constraint(equalTo: sidebarContainer.trailingAnchor),
            sidebarList.topAnchor.constraint(equalTo: sidebarContainer.topAnchor),
            sidebarList.bottomAnchor.constraint(equalTo: sidebarContainer.bottomAnchor),

            rightHairline.trailingAnchor.constraint(equalTo: sidebarContainer.trailingAnchor),
            rightHairline.topAnchor.constraint(equalTo: sidebarContainer.topAnchor),
            rightHairline.bottomAnchor.constraint(equalTo: sidebarContainer.bottomAnchor),
            rightHairline.widthAnchor.constraint(equalToConstant: 1)
        ])
        sidebarList.onFocusRequested = { [weak self] in self?.onFocusSidebar?() }
        sidebarList.onSelectWorkspace = { [weak self] workspaceID in self?.onSwitchWorkspace?(workspaceID) }
        sidebarList.onOpenAgentIntegrations = { [weak self] in self?.onOpenAgentIntegrations?() }
        sidebarList.onResumeAgentSession = { [weak self] agentID, sessionID in
            self?.onResumeAgentSession?(agentID, sessionID)
        }
    }

    private func buildMainArea() {
        [reconnectBanner, terminalPaneHost, statusBar].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            mainContainer.addSubview($0)
        }

        reconnectBanner.font = NSFont.monospacedSystemFont(ofSize: 11.5, weight: .medium)
        reconnectBanner.textColor = themeTokens.attentionBadge
        reconnectBanner.alignment = .center
        reconnectBanner.wantsLayer = true
        reconnectBanner.layer?.backgroundColor = themeTokens.panelBackground.cgColor
        reconnectBanner.isHidden = true

        overlayHost.isHidden = false
        overlayHost.onDismissCommandPalette = { [weak self] in self?.onDismissCommandPalette?() }
        overlayHost.onCloseOverlay = { [weak self] overlayID in self?.onCloseOverlay?(overlayID) }
        overlayHost.onExecutePaletteItem = { [weak self] item in self?.onExecutePaletteAction?(item.action) }
        overlayHost.onSubmitAgentComposer = { [weak self] command in self?.onSubmitAgentComposer?(command) }
        overlayHost.onCancelAgentComposer = { [weak self] input in self?.onCancelAgentComposer?(input) }
        overlayHost.onWorkflowCommand = { [weak self] command in self?.onWorkflowCommand?(command) }
        overlayHost.onAgentIntegrationCommand = { [weak self] command in self?.onAgentIntegrationCommand?(command) }
        overlayHost.onSelectNotification = { [weak self] notificationID, paneID in
            self?.onSelectNotification?(notificationID, paneID)
        }
        overlayHost.onMarkAllNotificationsRead = { [weak self] in self?.onMarkAllNotificationsRead?() }
        overlayHost.onDecideApproval = { [weak self] requestID, optionID in
            self?.onDecideApproval?(requestID, optionID)
        }
        overlayHost.onJumpToLatestUnread = { [weak self] in self?.onJumpToLatestUnread?() }
        overlayHost.onAddScript = { [weak self] name, command in self?.onAddScript?(name, command) }
        overlayHost.onRemoveScript = { [weak self] scriptID in self?.onRemoveScript?(scriptID) }
        terminalPaneHost.onFocusRequested = { [weak self] in self?.onFocusTerminal?() }

        bannerHeightConstraint = reconnectBanner.heightAnchor.constraint(equalToConstant: 0)
        NSLayoutConstraint.activate([
            reconnectBanner.leadingAnchor.constraint(equalTo: mainContainer.leadingAnchor),
            reconnectBanner.trailingAnchor.constraint(equalTo: mainContainer.trailingAnchor),
            reconnectBanner.topAnchor.constraint(equalTo: mainContainer.topAnchor),
            bannerHeightConstraint!,

            terminalPaneHost.leadingAnchor.constraint(equalTo: mainContainer.leadingAnchor),
            terminalPaneHost.trailingAnchor.constraint(equalTo: mainContainer.trailingAnchor),
            terminalPaneHost.topAnchor.constraint(equalTo: reconnectBanner.bottomAnchor),
            terminalPaneHost.bottomAnchor.constraint(equalTo: statusBar.topAnchor),

            statusBar.leadingAnchor.constraint(equalTo: mainContainer.leadingAnchor),
            statusBar.trailingAnchor.constraint(equalTo: mainContainer.trailingAnchor),
            statusBar.bottomAnchor.constraint(equalTo: mainContainer.bottomAnchor)
        ])
    }

    private func paletteItems(for state: NativeWorkspaceShellState) -> [WorkspaceOverlays.PaletteItem] {
        let workspaceItems = state.sidebarItems
            .filter { $0.visibility == .visible }
            .map { item in
                WorkspaceOverlays.PaletteItem(
                    id: "workspace-\(item.workspaceID.rawValue)",
                    domain: .workspaces,
                    title: item.displayName,
                    subtitle: item.canonicalPath ?? item.status.rawValue,
                    keywords: [item.workspaceID.rawValue, item.canonicalPath ?? ""].filter { !$0.isEmpty },
                    action: .switchWorkspace(item.workspaceID),
                    baseScore: item.isOpenLocally ? 90 : 50
                )
            }
        // D-044: resume actions for recorded agent sessions whose pane
        // process died. The action id carries only (agentID, sessionID); the
        // command is derived from the descriptor table at execution time.
        let resumeItems = Self.resumableAgentSessions(records: agentPresenceRecords, state: state)
            .filter { !$0.paneAlive }
            .map { session in
                let displayName = AgentIntegration.supportedAgentDescriptors
                    .first { $0.id == session.agentID }?
                    .displayName ?? session.agentID.rawValue
                return WorkspaceOverlays.PaletteItem(
                    id: "action-resume-agent-\(session.agentID.rawValue)-\(session.sessionID)",
                    domain: .actions,
                    title: "Resume \(displayName) Session",
                    subtitle: "Relaunch session \(NativeWorkspaceSidebarView.shortSessionID(session.sessionID)) in a new tmux pane",
                    keywords: ["resume", "agent", "session", session.agentID.rawValue],
                    action: .runAction("action-resume-agent:\(session.agentID.rawValue):\(session.sessionID)"),
                    baseScore: 77
                )
            }
        return workspaceItems + resumeItems + state.paletteFileItems + [
            WorkspaceOverlays.PaletteItem(
                id: "action-diagnostics",
                domain: .actions,
                title: "Open Diagnostics",
                subtitle: "Inspect connection, tmux kernel, and pane stream state",
                keywords: ["health", "server", "tmux"],
                action: .openDiagnostics,
                baseScore: 80
            ),
            WorkspaceOverlays.PaletteItem(
                id: "action-toggle-sidebar",
                domain: .actions,
                title: "Toggle Sidebar",
                subtitle: "Show or hide the workspace list",
                keywords: ["workspace", "navigator"],
                action: .runAction("toggle-sidebar"),
                baseScore: 60
            ),
            WorkspaceOverlays.PaletteItem(
                id: "action-agent-integrations",
                domain: .actions,
                title: "Agent Integrations",
                subtitle: "Repair or remove detected agent CLI integrations",
                keywords: ["agent", "integration", "repair", "settings"],
                action: .runAction("action-agent-integrations"),
                baseScore: 78
            ),
            WorkspaceOverlays.PaletteItem(
                id: "action-settings-agent-integrations",
                domain: .actions,
                title: "Settings: Agent Integrations",
                subtitle: "Manage provider hooks, MCP config, repair, and removal",
                keywords: ["settings", "preferences", "agent", "integration", "repair", "mcp", "hooks"],
                action: .runAction("action-settings-agent-integrations"),
                baseScore: 79
            ),
            WorkspaceOverlays.PaletteItem(
                id: "workflow-panel",
                domain: .workflows,
                title: "Open Workflows",
                subtitle: "List server workflow runs and timeline state",
                keywords: ["runs", "timeline", "agents", "tasks", "input"],
                action: .openWorkflow("native-workflow-panel"),
                baseScore: 75
            ),
            WorkspaceOverlays.PaletteItem(
                id: "action-run-script",
                domain: .actions,
                title: titlebarControls.run.phase == .running ? "Run Script (running)" : "Run Script",
                subtitle: "Run the primary run-kind script in a tmux pane",
                keywords: ["run", "script", "dev", "start"],
                action: .runAction("action-run-script"),
                baseScore: 74
            ),
            WorkspaceOverlays.PaletteItem(
                id: "action-stop-script",
                domain: .actions,
                title: "Stop Script",
                subtitle: "Stop the running script pane",
                keywords: ["stop", "script", "kill"],
                action: .runAction("action-stop-script"),
                baseScore: 73
            ),
            WorkspaceOverlays.PaletteItem(
                id: "action-open-in-editor",
                domain: .actions,
                title: "Open in Editor",
                subtitle: "Open the workspace path with the default editor target",
                keywords: ["editor", "open", "ide", "vscode", "zed", "finder"],
                action: .runAction("action-open-in-editor"),
                baseScore: 72
            ),
            WorkspaceOverlays.PaletteItem(
                id: "action-open-approvals",
                domain: .actions,
                title: "Approvals",
                subtitle: "Review pending agent approval requests",
                keywords: ["approvals", "approve", "deny", "permission", "agent", "feed"],
                action: .runAction("action-open-approvals"),
                baseScore: 76
            ),
            WorkspaceOverlays.PaletteItem(
                id: "action-open-notifications",
                domain: .actions,
                title: "Open Notifications",
                subtitle: "Show the workspace notifications panel",
                keywords: ["notifications", "unread", "attention", "bell"],
                action: .runAction("action-open-notifications"),
                baseScore: 71
            ),
            WorkspaceOverlays.PaletteItem(
                id: "action-jump-latest-unread",
                domain: .actions,
                title: "Jump to Latest Unread Notification",
                subtitle: "Focus the pane of the newest unread notification (⌘⇧U)",
                keywords: ["jump", "unread", "notification", "attention"],
                action: .runAction("action-jump-latest-unread"),
                baseScore: 70
            ),
            WorkspaceOverlays.PaletteItem(
                id: "help-keyboard",
                domain: .help,
                title: "Keyboard Help",
                subtitle: "Open native shell keyboard reference",
                keywords: ["shortcuts", "keys"],
                action: .openHelp("keyboard"),
                baseScore: 40
            )
        ]
    }
}

typealias NativePaneStreamSubscriber = @Sendable (
    _ workspaceID: WorkspaceID,
    _ pane: PaneGrid.PanePresentation,
    _ backfill: NativeRuntime.BackfillMode
) async -> AsyncThrowingStream<NativeRuntime.PaneStreamEnvelope, Error>

private struct NativeVisiblePaneStreamSubscription: Equatable {
    let paneID: PaneID
    let streamID: StreamID
}

@MainActor
private final class NativeTerminalInputRouter {
    weak var host: NativeTerminalPaneHostView?

    func send(_ bytes: Data, paneID: PaneID) {
        host?.dispatchTerminalInput(bytes, paneID: paneID)
    }

    func resize(_ size: TerminalViewport.Size, paneID: PaneID) {
        if host == nil {
            NSLog("Fenrir Native terminal resize dropped: router has no host pane=%@", paneID.rawValue)
        }
        host?.dispatchTerminalResize(size, paneID: paneID)
    }
}

@MainActor
final class NativeTerminalPaneHostView: NSView {
    let paneGridView: PaneGrid.AppKitPaneGridView
    let themeTokens: NativeShellThemeTokens
    private let paneGridActions: any NativePaneGridActionDispatching
    private let paneGridActionQueue = NativePaneGridActionQueue()
    private let paneStreamSubscriber: NativePaneStreamSubscriber?
    private let terminalStreamIngestor: NativeTerminalStreamIngestor?
    private let terminalInputRouter: NativeTerminalInputRouter
    private var streamTasksByViewportID: [ViewportID: Task<Void, Never>] = [:]
    private var streamSubscriptionsByViewportID: [ViewportID: NativeVisiblePaneStreamSubscription] = [:]
    private var lastObservedSequenceByPaneID: [PaneID: UInt64] = [:]
    var terminalView: FenrirTerminalView {
        guard let terminal = paneGridView.focusedTerminalView() else {
            fatalError("PaneGrid must expose a focused terminal for the active tmux pane")
        }
        return terminal
    }
    var onFocusRequested: (() -> Void)?
    /// Fires once per subscription when a pane's output stream ends outside a
    /// resubscribe (server closed it or it failed) — the live signal that the
    /// pane process likely died (D-045 run-script reconcile).
    var onPaneStreamEnded: ((PaneID) -> Void)?

    init(
        paneGridState: PaneGrid.State,
        paneGridActions: (any NativePaneGridActionDispatching)? = nil,
        paneStreamSubscriber: NativePaneStreamSubscriber? = nil,
        terminalStreamIngestor: NativeTerminalStreamIngestor? = nil,
        themeTokens: NativeShellThemeTokens = .resolve(Settings.NativeSettingsConfiguration.defaults.appearance.themeID),
        frame frameRect: NSRect = .zero
    ) {
        let terminalInputRouter = NativeTerminalInputRouter()
        self.terminalInputRouter = terminalInputRouter
        self.themeTokens = themeTokens
        self.paneStreamSubscriber = paneStreamSubscriber
        self.terminalStreamIngestor = terminalStreamIngestor
        self.paneGridActions = paneGridActions ?? NativePaneGridActionController(
            initialState: paneGridState,
            runtime: NativePaneGridUnavailableRuntimeController()
        )
        paneGridView = PaneGrid.AppKitPaneGridView(
            state: paneGridState,
            style: PaneGrid.PaneGridStyle(
                background: themeTokens.rootBackground,
                paneBackground: themeTokens.terminalBackground,
                paneHeaderBackground: themeTokens.panelBackground,
                paneBorder: themeTokens.hairline,
                focusedPaneBorder: themeTokens.accent.withAlphaComponent(0.55),
                attentionPaneBorder: themeTokens.attentionBadge.withAlphaComponent(0.7),
                headerPrimaryText: themeTokens.primaryText,
                headerSecondaryText: themeTokens.tertiaryText,
                tabText: themeTokens.tertiaryText,
                activeTabText: themeTokens.primaryText,
                activeTabUnderline: themeTokens.accent
            ),
            showsWindowTabBar: false
        ) { pane in
            let terminal = FenrirTerminalView(backend: FenrirGhosttyTerminalBackend(
                onUserInput: { [weak terminalInputRouter] bytes in
                    Task { @MainActor in
                        terminalInputRouter?.send(bytes, paneID: pane.paneID)
                    }
                },
                onResize: { [weak terminalInputRouter] size in
                    Task { @MainActor in
                        terminalInputRouter?.resize(size, paneID: pane.paneID)
                    }
                }
            ))
            return terminal
        }
        super.init(frame: frameRect)
        terminalInputRouter.host = self
        build()
        attachVisiblePaneStreams()
        paneGridView.onFocusPane = { [weak self] target in
            self?.dispatchFocus(target)
        }
        paneGridView.onSelectWindow = { [weak self] command in
            self?.dispatchSelect(command)
        }
        paneGridView.onResizePane = { [weak self] allocation in
            self?.dispatchResize(allocation)
        }
        paneGridView.onResizePaneToSize = { [weak self] target, size in
            self?.dispatchMeasuredResize(target, size: size)
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    deinit {
        streamTasksByViewportID.values.forEach { $0.cancel() }
    }

    override var acceptsFirstResponder: Bool { true }

    override func mouseDown(with event: NSEvent) {
        onFocusRequested?()
        super.mouseDown(with: event)
    }

    private func build() {
        wantsLayer = true
        layer?.backgroundColor = themeTokens.terminalBackground.cgColor

        paneGridView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(paneGridView)

        NSLayoutConstraint.activate([
            paneGridView.leadingAnchor.constraint(equalTo: leadingAnchor),
            paneGridView.trailingAnchor.constraint(equalTo: trailingAnchor),
            paneGridView.topAnchor.constraint(equalTo: topAnchor),
            paneGridView.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    private func attachVisiblePaneStreams() {
        guard let paneStreamSubscriber else {
            return
        }
        let visiblePanes = paneGridView.state.windows
            .first { $0.windowID == paneGridView.state.activeWindowID }?
            .panes ?? []
        let visibleSubscriptionsByViewportID = Dictionary(uniqueKeysWithValues: visiblePanes.compactMap { pane in
            pane.streamID.map { streamID in
                (
                    pane.viewportID,
                    NativeVisiblePaneStreamSubscription(paneID: pane.paneID, streamID: streamID)
                )
            }
        })
        for viewportID in Array(streamTasksByViewportID.keys) where streamSubscriptionsByViewportID[viewportID] != visibleSubscriptionsByViewportID[viewportID] {
            streamTasksByViewportID.removeValue(forKey: viewportID)?.cancel()
            streamSubscriptionsByViewportID.removeValue(forKey: viewportID)
        }
        for pane in visiblePanes where streamTasksByViewportID[pane.viewportID] == nil {
            guard let streamID = pane.streamID else {
                continue
            }
            guard let terminal = paneGridView.terminalView(viewportID: pane.viewportID) else {
                continue
            }
            terminal.attach(streamID: streamID)
            let backfill = lastObservedSequenceByPaneID[pane.paneID].map(NativeRuntime.BackfillMode.fromSeq) ?? .fromSeq(0)
            let workspaceID = paneGridView.state.workspaceID
            streamSubscriptionsByViewportID[pane.viewportID] = NativeVisiblePaneStreamSubscription(paneID: pane.paneID, streamID: streamID)
            streamTasksByViewportID[pane.viewportID] = Task { [weak self, workspaceID, pane, terminal, paneStreamSubscriber] in
                do {
                    let stream = await paneStreamSubscriber(workspaceID, pane, backfill)
                    for try await envelope in stream {
                        await self?.apply(envelope, pane: pane, to: terminal)
                    }
                    self?.onPaneStreamEnded?(pane.paneID)
                } catch is CancellationError {
                } catch {
                    NSLog("Fenrir Native pane stream failed pane=\(pane.paneID.rawValue): \(String(describing: error))")
                    self?.onPaneStreamEnded?(pane.paneID)
                }
            }
        }
    }

    private func apply(_ envelope: NativeRuntime.PaneStreamEnvelope, pane: PaneGrid.PanePresentation, to terminal: FenrirTerminalView) async {
        switch envelope.kind {
        case .output:
            var didAcceptOutput = false
            if let bytes = envelope.bytes {
                if let sequence = envelope.sequence, let terminalStreamIngestor {
                    let result = await terminalStreamIngestor.ingestOutput(
                        workspaceID: paneGridView.state.workspaceID,
                        windowID: paneGridView.state.activeWindowID,
                        pane: pane,
                        streamID: envelope.streamID,
                        sequence: sequence,
                        bytes: bytes,
                        terminalView: terminal
                    )
                    switch result {
                    case .success:
                        didAcceptOutput = true
                    case .failure(let error):
                        NSLog("Fenrir Native terminal viewport ingest failed pane=\(pane.paneID.rawValue) sequence=\(sequence): \(String(describing: error))")
                    }
                } else {
                    terminal.applyRuntimeOutput(bytes)
                    didAcceptOutput = true
                }
            }
            if didAcceptOutput, let sequence = envelope.sequence {
                lastObservedSequenceByPaneID[envelope.paneID] = sequence
            }
        case .gap, .overflow:
            if let highReplaySeq = envelope.highReplaySeq {
                lastObservedSequenceByPaneID[envelope.paneID] = highReplaySeq
            }
        case .backfillStarted, .closed:
            break
        }
    }

    func setTerminalFocused(_ focused: Bool) {
        if focused {
            paneGridView.restoreFocusedPane()
        } else {
            terminalView.setTerminalFocused(false)
        }
    }

    func applyPaneGrid(_ state: PaneGrid.State) {
        paneGridActions.applyPaneGridState(state)
        paneGridView.apply(state)
        attachVisiblePaneStreams()
    }

    func focusedAgentContextTarget() -> NativeAgentComposerTarget? {
        let state = paneGridView.state
        guard let window = state.windows.first(where: { $0.windowID == state.activeWindowID }),
              let pane = window.panes.first(where: { $0.paneID == window.activePaneID })
        else {
            return nil
        }
        return NativeAgentComposerTarget(
            workspaceID: state.workspaceID,
            windowID: window.windowID,
            paneID: pane.paneID,
            viewportID: pane.viewportID
        )
    }

    func waitForPaneGridActions() async {
        await paneGridActionQueue.waitForIdle()
    }

    private func dispatchFocus(_ target: PaneGrid.PaneKernelTarget) {
        onFocusRequested?()
        enqueuePaneGridAction { [weak self, paneGridActions] in
            if let next = await paneGridActions.focusPane(target) {
                await MainActor.run {
                    self?.paneGridView.apply(next)
                }
            }
        }
    }

    private func dispatchSelect(_ command: PaneGrid.SelectTabWindowCommand) {
        enqueuePaneGridAction { [weak self, paneGridActions] in
            if let next = await paneGridActions.selectWindow(command) {
                await MainActor.run {
                    self?.paneGridView.apply(next)
                    self?.attachVisiblePaneStreams()
                }
            }
        }
    }

    private func dispatchResize(_ allocation: PaneGrid.PaneResizeAllocation) {
        let state = paneGridView.state
        enqueuePaneGridAction { [paneGridActions] in
            await paneGridActions.resizePane(allocation, in: state)
        }
    }

    private func dispatchMeasuredResize(_ target: PaneGrid.PaneKernelTarget, size: TerminalViewport.Size) {
        let state = paneGridView.state
        enqueuePaneGridAction { [paneGridActions] in
            await paneGridActions.resizePane(target, size: size, in: state)
        }
    }

    fileprivate func dispatchTerminalInput(_ bytes: Data, paneID: PaneID) {
        guard !bytes.isEmpty, let target = target(for: paneID) else {
            return
        }
        enqueuePaneGridAction { [paneGridActions] in
            await paneGridActions.writeInput(bytes, to: target)
        }
    }

    fileprivate func dispatchTerminalResize(_ size: TerminalViewport.Size, paneID: PaneID) {
        guard size.columns > 0, size.rows > 0 else {
            return
        }
        guard let target = target(for: paneID) else {
            NSLog(
                "Fenrir Native terminal resize dropped: no kernel target pane=%@ cols=%d rows=%d",
                paneID.rawValue,
                size.columns,
                size.rows
            )
            return
        }
        dispatchMeasuredResize(target, size: size)
    }

    private func target(for paneID: PaneID) -> PaneGrid.PaneKernelTarget? {
        let state = paneGridView.state
        guard let window = state.windows.first(where: { $0.panes.contains { $0.paneID == paneID } }),
              let pane = window.panes.first(where: { $0.paneID == paneID })
        else {
            return nil
        }
        return PaneGrid.PaneKernelTarget(
            workspaceID: state.workspaceID,
            windowID: window.windowID,
            tmuxWindowID: window.tmuxWindowID,
            paneID: pane.paneID,
            tmuxPaneID: pane.tmuxPaneID
        )
    }

    private func enqueuePaneGridAction(_ operation: @escaping @Sendable () async -> Void) {
        paneGridActionQueue.enqueue(operation)
    }
}

private enum NativeTerminalSelectionSmokeSupport {
    @MainActor
    static func selectText(_ text: String, in terminal: FenrirTerminalView) -> String? {
        guard let textView = textView(in: terminal) else {
            return terminal.setSyntheticSelectionForTesting(text) ? text : nil
        }
        guard let range = textView.string.range(of: text) else {
            return nil
        }
        let nsRange = NSRange(range, in: textView.string)
        textView.setSelectedRange(nsRange)
        return (textView.string as NSString).substring(with: nsRange)
    }

    @MainActor
    private static func textView(in view: NSView) -> NSTextView? {
        if let textView = view as? NSTextView {
            return textView
        }
        for subview in view.subviews {
            if let textView = textView(in: subview) {
                return textView
            }
        }
        return nil
    }
}

private enum NativeAgentComposerOverlay {
    static let overlayID = WorkspaceOverlays.OverlayID(rawValue: "agent-composer")
}

private enum NativeWorkflowOverlay {
    static let overlayID = WorkspaceOverlays.OverlayID(rawValue: "workflow-panel")
}

private enum NativeAgentIntegrationOverlay {
    static let overlayID = WorkspaceOverlays.OverlayID(rawValue: "agent-integrations")
}

protocol NativeNeovimBridgeControllerMaking: Sendable {
    func makeController(for state: NativeWorkspaceShellState) -> NativeNeovimBridgeActionController
}

struct NativeNeovimServerConnectionControllerFactory: NativeNeovimBridgeControllerMaking {
    private let actor: NativeRuntime.RuntimeActorIdentity
    private let sessionID: ServerConnection.SessionID
    private let sendServerRequest: ServerConnection.SendServerRequest

    init(
        actor: NativeRuntime.RuntimeActorIdentity,
        sessionID: ServerConnection.SessionID,
        sendServerRequest: ServerConnection.SendServerRequest
    ) {
        self.actor = actor
        self.sessionID = sessionID
        self.sendServerRequest = sendServerRequest
    }

    func makeController(for state: NativeWorkspaceShellState) -> NativeNeovimBridgeActionController {
        let transport = NativeServerConnectionRuntimeRPCTransport(
            sessionID: sessionID,
            sendServerRequest: sendServerRequest
        )
        let runtime = NativeRuntime.ServerTmuxRuntimeAdapter(transport: transport)
        return NativeNeovimBridgeActionController(
            workspaceID: state.workspaceID,
            actor: actor,
            action: NeovimBridge.OpenFileInNeovim(
                catalog: NeovimBridge.runtimeMetadataPaneCatalog(
                    enumerator: runtime,
                    actor: actor,
                    source: .workspaceShell
                ),
                bridgeClient: NeovimBridge.unsupportedBridgeClient(),
                creator: NeovimBridge.serverTmuxPaneCreator(transport: transport),
                enumerator: runtime,
                focuser: runtime,
                clock: NativeNeovimBridgeClock()
            )
        )
    }
}

struct NativeNeovimUnavailableControllerFactory: NativeNeovimBridgeControllerMaking {
    func makeController(for state: NativeWorkspaceShellState) -> NativeNeovimBridgeActionController {
        NativeNeovimBridgeActionController.unavailable(workspaceID: state.workspaceID)
    }
}

struct NativeNeovimBridgeActionController: Sendable {
    private let workspaceID: WorkspaceID
    private let actor: NativeRuntime.RuntimeActorIdentity
    private let action: NeovimBridge.OpenFileInNeovim?

    init(
        workspaceID: WorkspaceID,
        actor: NativeRuntime.RuntimeActorIdentity,
        action: NeovimBridge.OpenFileInNeovim?
    ) {
        self.workspaceID = workspaceID
        self.actor = actor
        self.action = action
    }

    static func unavailable(workspaceID: WorkspaceID = "unavailable") -> NativeNeovimBridgeActionController {
        NativeNeovimBridgeActionController(
            workspaceID: workspaceID,
            actor: NativeRuntime.RuntimeActorIdentity(profileID: "local", authSessionID: "native-app", subject: "native-app"),
            action: nil
        )
    }

    func openFile(_ path: String, in state: NativeWorkspaceShellState) async {
        guard let action else {
            return
        }
        let windowID = state.paneGridState.activeWindowID
        _ = await action.run(NeovimBridge.OpenFileInNeovimInput(
            requestID: RequestID(rawValue: "native-open-file-\(UUID().uuidString)"),
            workspaceID: workspaceID,
            windowID: windowID,
            actor: actor,
            target: NeovimBridge.FileTarget(path: path),
            policy: .createIfNeeded,
            source: .workspaceShell
        ))
    }
}

private struct NativeNeovimBridgeClock: NeovimBridge.NeovimBridgeClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date())
    }
}

private struct NativeKeybindingClock: Keybinding.KeybindingClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date())
    }
}

private enum NativeTmuxKeymapLoader {
    static func effectiveKeymap() -> Keybinding.EffectiveTmuxKeymap {
        Keybinding.EffectiveTmuxKeymap(prefix: .control("b"), bindings: loadPrefixBindings())
    }

    private static func loadPrefixBindings() -> [Keybinding.TmuxKeyBinding] {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["tmux", "list-keys", "-T", "prefix"]
        let output = Pipe()
        process.standardOutput = output
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                return []
            }
            let data = output.fileHandleForReading.readDataToEndOfFile()
            return String(decoding: data, as: UTF8.self)
                .split(separator: "\n")
                .compactMap { binding(from: String($0)) }
        } catch {
            return []
        }
    }

    private static func binding(from line: String) -> Keybinding.TmuxKeyBinding? {
        let tokens = line.split(whereSeparator: \.isWhitespace).map(String.init)
        guard tokens.first == "bind-key",
              let tableFlag = tokens.firstIndex(of: "-T"),
              tokens.indices.contains(tableFlag + 2)
        else {
            return nil
        }
        let table = tokens[tableFlag + 1]
        let key = keyStroke(from: tokens[tableFlag + 2])
        let commandStart = tableFlag + 3
        guard commandStart < tokens.endIndex else {
            return nil
        }
        return Keybinding.TmuxKeyBinding(
            table: table,
            key: key,
            command: tokens[commandStart...].joined(separator: " ")
        )
    }

    private static func keyStroke(from rawKey: String) -> Keybinding.KeyStroke {
        let key = rawKey.removingTmuxEscapedPrefix()
        if key.hasPrefix("C-"), key.count > 2 {
            return .control(String(key.dropFirst(2)).lowercased())
        }
        if key.hasPrefix("M-"), key.count > 2 {
            return Keybinding.KeyStroke(String(key.dropFirst(2)).lowercased(), modifiers: [.option])
        }
        return Keybinding.KeyStroke(key)
    }
}

private extension String {
    func removingTmuxEscapedPrefix() -> String {
        guard hasPrefix("\\") else {
            return self
        }
        return String(dropFirst())
    }
}

private enum NativeWorkspaceFilePalette {
    static func items(in directory: String, fileManager: FileManager = .default) -> [WorkspaceOverlays.PaletteItem] {
        guard let entries = try? fileManager.contentsOfDirectory(atPath: directory) else {
            return []
        }
        return entries
            .filter { !$0.hasPrefix(".") }
            .sorted()
            .prefix(200)
            .map { entry in
                let path = URL(fileURLWithPath: directory).appendingPathComponent(entry).path
                return WorkspaceOverlays.PaletteItem(
                    id: "file:\(path)",
                    domain: .files,
                    title: entry,
                    subtitle: path,
                    keywords: [entry, path],
                    action: .openFile(path),
                    baseScore: 20
                )
            }
    }
}

enum NativeWorkflowViewUpdate: Sendable {
    case runs([WorkflowControl.WorkflowRunSnapshot])
    case timeline(WorkflowControl.WorkflowRunTimeline)
    case run(WorkflowControl.WorkflowRunSnapshot)
    case error(WorkflowControl.WorkflowControlError)
}

protocol NativeAgentIntegrationActionDispatching: Sendable {
    func dispatch(
        _ command: AgentIntegration.AgentIntegrationViewCommand,
        workspaceID: WorkspaceID
    ) async -> AgentIntegration.AgentIntegrationPanelState
}

struct NativeAgentIntegrationActionController: NativeAgentIntegrationActionDispatching, Sendable {
    private let detector: any AgentIntegration.AgentIntegrationDetecting
    private let installer: any AgentIntegration.AgentIntegrationInstalling
    private let clock: any AgentIntegration.AgentIntegrationClock

    init(
        detector: any AgentIntegration.AgentIntegrationDetecting = AgentIntegration.pathAgentIntegrationDetector(),
        installer: (any AgentIntegration.AgentIntegrationInstalling)? = nil,
        clock: any AgentIntegration.AgentIntegrationClock = NativeAgentIntegrationClock()
    ) {
        self.detector = detector
        self.clock = clock
        self.installer = installer ?? AgentIntegration.providerStructuredAgentIntegrationProvisioner(
            configStore: AgentIntegration.LocalAgentIntegrationConfigFileStore(),
            clock: clock
        )
    }

    func dispatch(
        _ command: AgentIntegration.AgentIntegrationViewCommand,
        workspaceID: WorkspaceID
    ) async -> AgentIntegration.AgentIntegrationPanelState {
        switch command.kind {
        case .refresh:
            return await refresh(requestID: command.requestID, lastProvisioningResult: nil)
        case .repair(let agentID):
            return await provision(
                command,
                workspaceID: workspaceID,
                agentID: agentID,
                action: AgentIntegration.InstallAgentIntegration(installer: installer).run
            )
        case .remove(let agentID):
            return await provision(
                command,
                workspaceID: workspaceID,
                agentID: agentID,
                action: AgentIntegration.RemoveAgentIntegration(installer: installer).run
            )
        }
    }

    private func refresh(
        requestID: RequestID,
        lastProvisioningResult: AgentIntegration.AgentProvisioningResult?,
        lastErrorMessage: String? = nil
    ) async -> AgentIntegration.AgentIntegrationPanelState {
        let action = AgentIntegration.DetectAgentIntegrations(detector: detector, clock: clock)
        switch await action.run(.init(requestID: requestID, source: .workspaceShell)) {
        case .success(let result):
            return AgentIntegration.AgentIntegrationPanelState(
                statuses: result.statuses,
                lastProvisioningResult: lastProvisioningResult,
                lastErrorMessage: lastErrorMessage,
                timestamp: result.timestamp
            )
        case .failure(let error):
            return AgentIntegration.AgentIntegrationPanelState(
                statuses: [],
                lastProvisioningResult: lastProvisioningResult,
                lastErrorMessage: String(describing: error),
                timestamp: clock.now()
            )
        }
    }

    private func provision(
        _ command: AgentIntegration.AgentIntegrationViewCommand,
        workspaceID: WorkspaceID,
        agentID: AgentIntegration.AgentCLIIdentifier,
        action: (AgentIntegration.AgentProvisioningRequest) async -> Result<AgentIntegration.AgentProvisioningResult, AgentIntegration.AgentIntegrationError>
    ) async -> AgentIntegration.AgentIntegrationPanelState {
        let request = AgentIntegration.AgentProvisioningRequest(
            requestID: command.requestID,
            agentID: agentID,
            workspaceID: workspaceID,
            targetVersion: "1.0.0",
            source: command.source
        )
        switch await action(request) {
        case .success(let result):
            return await refresh(requestID: command.requestID, lastProvisioningResult: result)
        case .failure(let error):
            return await refresh(
                requestID: command.requestID,
                lastProvisioningResult: nil,
                lastErrorMessage: String(describing: error)
            )
        }
    }
}

@MainActor
final class NativeWorkflowActionController {
    private let workspaceID: WorkspaceID
    private let serverClient: any WorkflowControl.WorkflowServerClient
    private let clock = NativeWorkflowClock()

    init(workspaceID: WorkspaceID, serverClient: any WorkflowControl.WorkflowServerClient) {
        self.workspaceID = workspaceID
        self.serverClient = serverClient
    }

    func dispatch(_ command: WorkflowControl.WorkflowViewCommand) async -> NativeWorkflowViewUpdate {
        switch command.kind {
        case .refreshRuns:
            let action = WorkflowControl.ListWorkflowRuns(clock: clock, serverClient: serverClient)
            let result = await action.run(.init(
                requestID: command.requestID,
                filter: .init(projectID: workspaceID.rawValue),
                source: .workspaceShell
            ))
            switch result {
            case .success(let output):
                return .runs(output.runs)
            case .failure(let error):
                return .error(error)
            }
        case .observeTimeline(let runID, let afterSequence):
            let action = WorkflowControl.ObserveWorkflowRunTimeline(clock: clock, serverClient: serverClient)
            let result = await action.run(.init(
                requestID: command.requestID,
                runID: runID,
                afterSequence: afterSequence,
                source: .workspaceShell
            ))
            switch result {
            case .success(let output):
                return .timeline(output.timeline)
            case .failure(let error):
                return .error(error)
            }
        case .pause(let runID):
            let action = WorkflowControl.PauseWorkflowRun(clock: clock, serverClient: serverClient)
            return commandResult(await action.run(.init(requestID: command.requestID, runID: runID, source: .workspaceShell)))
        case .stop(let runID):
            let action = WorkflowControl.StopWorkflowRun(clock: clock, serverClient: serverClient)
            return commandResult(await action.run(.init(requestID: command.requestID, runID: runID, source: .workspaceShell)))
        case .rerun(let runID):
            let action = WorkflowControl.RerunWorkflowRun(clock: clock, serverClient: serverClient)
            return commandResult(await action.run(.init(requestID: command.requestID, runID: runID, source: .workspaceShell)))
        case .respond(let runID, let inputRequestID, let response):
            let action = WorkflowControl.RespondToWorkflowInputRequest(clock: clock, serverClient: serverClient)
            return commandResult(await action.run(.init(
                requestID: command.requestID,
                runID: runID,
                inputRequestID: inputRequestID,
                response: response,
                source: .workspaceShell
            )))
        }
    }

    private func commandResult(
        _ result: Result<WorkflowControl.WorkflowRunCommandResult, WorkflowControl.WorkflowControlError>
    ) -> NativeWorkflowViewUpdate {
        switch result {
        case .success(let output):
            return .run(output.run)
        case .failure(let error):
            return .error(error)
        }
    }
}

private struct NativeWorkflowClock: WorkflowControl.WorkflowControlClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date())
    }
}

@MainActor
final class NativeDiagnosticsActionController {
    private let store: any Diagnostics.DiagnosticsStore
    private let redactor: any Diagnostics.DiagnosticsRedactor
    private let clock: any Diagnostics.DiagnosticsClock
    private let policy: Diagnostics.DiagnosticsPolicy

    init(
        store: any Diagnostics.DiagnosticsStore = Diagnostics.localFileDiagnosticsStore(),
        redactor: any Diagnostics.DiagnosticsRedactor = Diagnostics.supportBundleRedactor(),
        clock: any Diagnostics.DiagnosticsClock = NativeDiagnosticsClock(),
        policy: Diagnostics.DiagnosticsPolicy = Diagnostics.DiagnosticsPolicy(detailLevel: .verboseLocal)
    ) {
        self.store = store
        self.redactor = redactor
        self.clock = clock
        self.policy = policy
    }

    func record(
        category: Diagnostics.DiagnosticCategory,
        severity: Diagnostics.DiagnosticSeverity,
        workspaceID: WorkspaceID?,
        title: String,
        message: String,
        metadata: [String: String] = [:]
    ) async {
        let event = Diagnostics.DiagnosticEvent(
            workspaceID: workspaceID,
            category: category,
            severity: severity,
            title: title,
            message: message,
            metadata: metadata,
            occurredAt: clock.now()
        )
        let action = Diagnostics.RecordDiagnosticEvent(clock: clock, store: store, redactor: redactor)
        _ = await action.run(.init(
            requestID: .generated(),
            event: event,
            policy: policy,
            source: .nativeHost
        ))
    }

    func overlayViewModel(workspaceID: WorkspaceID?) async -> Diagnostics.DiagnosticsOverlayViewModel {
        let action = Diagnostics.BuildDiagnosticsReport(clock: clock, store: store)
        let result = await action.run(.init(
            requestID: .generated(),
            workspaceID: workspaceID,
            policy: policy,
            source: .workspaceShell
        ))

        switch result {
        case .success(let result):
            return Diagnostics.DiagnosticsOverlayViewModel(report: result.report)
        case .failure(let error):
            let fallback = Diagnostics.DiagnosticsReport(
                generatedAt: clock.now(),
                policy: policy,
                events: [],
                categoryCounts: [.nativeShell: 1],
                redactionNotice: "Diagnostics report unavailable: \(String(describing: error))"
            )
            return Diagnostics.DiagnosticsOverlayViewModel(report: fallback)
        }
    }
}

private struct NativeDiagnosticsClock: Diagnostics.DiagnosticsClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date())
    }
}

@MainActor
final class NativeWorkflowNotificationController {
    private let workspaceID: WorkspaceID
    private let store: any Notifications.NotificationStore
    private let clock = NativeWorkflowNotificationClock()

    init(
        workspaceID: WorkspaceID,
        store: any Notifications.NotificationStore = Notifications.inMemoryNotificationStore()
    ) {
        self.workspaceID = workspaceID
        self.store = store
    }

    func projectNotifications(
        from events: [WorkflowControl.WorkflowTimelineEvent]
    ) async -> WorkspaceIndex.WorkspaceNotificationState? {
        let notificationEvents = events.filter { $0.kind == .notificationEmitted }
        guard !notificationEvents.isEmpty else {
            return nil
        }

        let create = Notifications.CreateNotification(clock: clock, store: store)
        for event in notificationEvents {
            _ = await create.run(.init(
                requestID: RequestID(rawValue: "workflow-notification-\(event.eventID.rawValue)"),
                workspaceID: workspaceID,
                source: .workflow(runID: event.runID.rawValue),
                severity: NativeWorkflowNotificationController.severity(for: event),
                title: event.title,
                message: event.body ?? event.title,
                dedupeKey: Notifications.NotificationDedupeKey(rawValue: "workflow:\(event.eventID.rawValue)"),
                sourceAction: .workspaceShell
            ))
        }

        let project = Notifications.ProjectWorkspaceNotifications(clock: clock, store: store)
        guard case .success(let result) = await project.run(.init(
            requestID: "workflow-notifications-project",
            workspaceID: workspaceID,
            source: .workspaceShell
        )) else {
            return nil
        }

        return WorkspaceIndex.WorkspaceNotificationState(
            unreadCount: result.projection.unacknowledgedCount,
            level: NativeWorkflowNotificationController.workspaceLevel(for: result.projection.highestSeverity)
        )
    }

    private static func severity(for event: WorkflowControl.WorkflowTimelineEvent) -> Notifications.NotificationSeverity {
        guard case .object(let payload) = event.payload,
              case .string(let level)? = payload["level"]
        else {
            return .info
        }
        switch level {
        case "critical", "error":
            return .critical
        case "warning", "warn":
            return .warning
        default:
            return .info
        }
    }

    private static func workspaceLevel(for severity: Notifications.NotificationSeverity?) -> WorkspaceIndex.WorkspaceNotificationLevel {
        switch severity {
        case .critical, .warning:
            return .attention
        case .info:
            return .badge
        case nil:
            return .none
        }
    }
}

private struct NativeWorkflowNotificationClock: Notifications.NotificationsClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date())
    }
}

protocol NativeWorkflowServerClientMaking: Sendable {
    func makeClient(for state: NativeWorkspaceShellState) -> any WorkflowControl.WorkflowServerClient
}

struct NativeWorkflowUnavailableServerClientFactory: NativeWorkflowServerClientMaking {
    func makeClient(for state: NativeWorkspaceShellState) -> any WorkflowControl.WorkflowServerClient {
        NativeWorkflowUnavailableServerClient()
    }
}

struct NativeWorkflowUnavailableServerClient: WorkflowControl.WorkflowServerClient {
    func listWorkflowRuns(filter: WorkflowControl.WorkflowRunListFilter) async throws -> [WorkflowControl.WorkflowRunSnapshot] {
        throw WorkflowControl.WorkflowControlError.unavailable
    }

    func getWorkflowRun(runID: WorkflowControl.WorkflowRunID) async throws -> WorkflowControl.WorkflowRunSnapshot {
        throw WorkflowControl.WorkflowControlError.unavailable
    }

    func getWorkflowTimeline(runID: WorkflowControl.WorkflowRunID) async throws -> [WorkflowControl.WorkflowTimelineEvent] {
        throw WorkflowControl.WorkflowControlError.unavailable
    }

    func pauseWorkflowRun(runID: WorkflowControl.WorkflowRunID) async throws -> WorkflowControl.WorkflowRunSnapshot {
        throw WorkflowControl.WorkflowControlError.commandRejected("workflow pause is not exposed by the current server contract")
    }

    func stopWorkflowRun(runID: WorkflowControl.WorkflowRunID) async throws -> WorkflowControl.WorkflowRunSnapshot {
        throw WorkflowControl.WorkflowControlError.unavailable
    }

    func rerunWorkflowRun(runID: WorkflowControl.WorkflowRunID) async throws -> WorkflowControl.WorkflowRunSnapshot {
        throw WorkflowControl.WorkflowControlError.unavailable
    }

    func respondToWorkflowInput(
        runID: WorkflowControl.WorkflowRunID,
        inputRequestID: WorkflowControl.WorkflowInputRequestID,
        response: WorkflowControl.WorkflowJSONValue
    ) async throws -> WorkflowControl.WorkflowRunSnapshot {
        throw WorkflowControl.WorkflowControlError.unavailable
    }
}

protocol NativeWorkflowEventStreamMaking: Sendable {
    func makeEventStream(for state: NativeWorkspaceShellState) -> any WorkflowControl.WorkflowEventStreaming
}

struct NativeWorkflowUnavailableEventStreamFactory: NativeWorkflowEventStreamMaking {
    func makeEventStream(for state: NativeWorkspaceShellState) -> any WorkflowControl.WorkflowEventStreaming {
        NativeWorkflowUnavailableEventStream()
    }
}

struct NativeWorkflowUnavailableEventStream: WorkflowControl.WorkflowEventStreaming {
    func observeWorkflowEvents(filter: WorkflowControl.WorkflowEventStreamFilter) async -> AsyncThrowingStream<WorkflowControl.WorkflowEventStreamItem, Error> {
        AsyncThrowingStream { continuation in
            continuation.finish(throwing: WorkflowControl.WorkflowControlError.unavailable)
        }
    }
}

struct NativeWorkflowServerConnectionEventStreamFactory: NativeWorkflowEventStreamMaking {
    private let streamServerRequest: @Sendable (NativeRuntime.ServerRPCRequest) -> AsyncThrowingStream<Data, Error>

    init(streamServerRequest: @escaping @Sendable (NativeRuntime.ServerRPCRequest) -> AsyncThrowingStream<Data, Error>) {
        self.streamServerRequest = streamServerRequest
    }

    func makeEventStream(for state: NativeWorkspaceShellState) -> any WorkflowControl.WorkflowEventStreaming {
        NativeWorkflowServerConnectionEventStream(streamServerRequest: streamServerRequest)
    }
}

struct NativeWorkflowServerConnectionEventStream: WorkflowControl.WorkflowEventStreaming {
    private let streamServerRequest: @Sendable (NativeRuntime.ServerRPCRequest) -> AsyncThrowingStream<Data, Error>

    init(streamServerRequest: @escaping @Sendable (NativeRuntime.ServerRPCRequest) -> AsyncThrowingStream<Data, Error>) {
        self.streamServerRequest = streamServerRequest
    }

    func observeWorkflowEvents(filter: WorkflowControl.WorkflowEventStreamFilter) async -> AsyncThrowingStream<WorkflowControl.WorkflowEventStreamItem, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                let request = NativeRuntime.ServerRPCRequest(
                    requestID: RequestID(rawValue: "native-workflow-events-\(UUID().uuidString)"),
                    method: "subscribeWorkflowEvents",
                    payload: Data("{}".utf8)
                )
                let upstream = streamServerRequest(request)
                do {
                    for try await data in upstream {
                        guard let item = try NativeWorkflowEventStreamDecoder.decode(data) else {
                            continue
                        }
                        continuation.yield(item)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

private enum NativeWorkflowEventStreamDecoder {
    static func decode(_ data: Data) throws -> WorkflowControl.WorkflowEventStreamItem? {
        try JSONDecoder().decode(NativeWorkflowEventStreamPayload.self, from: data).item
    }
}

private struct NativeWorkflowEventStreamPayload: Decodable {
    let type: String
    let run: WorkflowControl.WorkflowRunSnapshot?
    let event: NativeWorkflowNullableRunEvent?

    var item: WorkflowControl.WorkflowEventStreamItem? {
        switch type {
        case "workflow.run.changed":
            guard let run else { return nil }
            return WorkflowControl.WorkflowEventStreamItem(kind: .runChanged, run: run)
        case "workflow.event.appended":
            guard let event = event?.timelineEvent() else { return nil }
            return WorkflowControl.WorkflowEventStreamItem(kind: .eventAppended, event: event)
        default:
            return nil
        }
    }
}

private struct NativeWorkflowNullableRunEvent: Decodable {
    let eventID: WorkflowControl.WorkflowEventID
    let workflowID: WorkflowControl.WorkflowID
    let runID: WorkflowControl.WorkflowRunID?
    let rawKind: String
    let title: String
    let body: String?
    let payload: WorkflowControl.WorkflowJSONValue
    let sequence: Int
    let createdAt: FenrirTimestamp

    enum CodingKeys: String, CodingKey {
        case eventID = "eventId"
        case workflowID = "workflowId"
        case runID = "runId"
        case rawKind = "kind"
        case title
        case body
        case payload
        case sequence
        case createdAt
    }

    func timelineEvent() -> WorkflowControl.WorkflowTimelineEvent? {
        guard let runID, let kind = WorkflowControl.WorkflowEventKind(rawValue: rawKind) else {
            return nil
        }
        return WorkflowControl.WorkflowTimelineEvent(
            eventID: eventID,
            workflowID: workflowID,
            runID: runID,
            kind: kind,
            title: title,
            body: body,
            payload: payload,
            sequence: sequence,
            createdAt: createdAt
        )
    }
}

// MARK: - D-045 workspace row metadata sources (ports + branch)

/// One server discovered by the server-side localServers contract
/// (`subscribeLocalServers`). Mirrors `DiscoveredLocalServer` from
/// `packages/contracts` — the client never probes ports itself.
struct NativeDiscoveredLocalServer: Decodable, Equatable, Sendable {
    let host: String
    let port: Int
    let url: String
    let processName: String?
    let pid: Int?
}

struct NativeLocalServersSnapshot: Decodable, Equatable, Sendable {
    let servers: [NativeDiscoveredLocalServer]
    let scannedAt: String
}

protocol NativeLocalServersEventStreaming: Sendable {
    func observeLocalServers() async -> AsyncThrowingStream<NativeLocalServersSnapshot, Error>
}

struct NativeLocalServersServerConnectionEventStream: NativeLocalServersEventStreaming {
    private let streamServerRequest: @Sendable (NativeRuntime.ServerRPCRequest) -> AsyncThrowingStream<Data, Error>

    init(streamServerRequest: @escaping @Sendable (NativeRuntime.ServerRPCRequest) -> AsyncThrowingStream<Data, Error>) {
        self.streamServerRequest = streamServerRequest
    }

    func observeLocalServers() async -> AsyncThrowingStream<NativeLocalServersSnapshot, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                let request = NativeRuntime.ServerRPCRequest(
                    requestID: RequestID(rawValue: "native-local-servers-\(UUID().uuidString)"),
                    method: "subscribeLocalServers",
                    payload: Data("{}".utf8)
                )
                let upstream = streamServerRequest(request)
                do {
                    for try await data in upstream {
                        guard let snapshot = try? JSONDecoder().decode(NativeLocalServersSnapshot.self, from: data) else {
                            continue
                        }
                        continuation.yield(snapshot)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// Resolves the current branch of a workspace path through the existing
/// server vcs contract (`vcs.refreshStatus`); the client never shells out to
/// git (D-045 row-metadata rule).
protocol NativeWorkspaceVcsStatusProviding: Sendable {
    func currentRefName(workspacePath: String) async throws -> String?
}

struct NativeVcsServerConnectionStatusClient: NativeWorkspaceVcsStatusProviding {
    private let sessionID: ServerConnection.SessionID
    private let sendServerRequest: ServerConnection.SendServerRequest

    init(
        sessionID: ServerConnection.SessionID,
        sendServerRequest: ServerConnection.SendServerRequest
    ) {
        self.sessionID = sessionID
        self.sendServerRequest = sendServerRequest
    }

    func currentRefName(workspacePath: String) async throws -> String? {
        let payloadData = try JSONEncoder().encode(NativeVcsStatusRequest(cwd: workspacePath))
        let result = try await sendServerRequest.run(ServerConnection.SendServerRequestInput(
            requestID: .generated(),
            sessionID: sessionID,
            request: ServerConnection.RequestEnvelope(
                method: "vcs.refreshStatus",
                payload: String(decoding: payloadData, as: UTF8.self),
                retryPolicy: .retryOnceAfterReconnect
            )
        )).get()
        let response = try JSONDecoder().decode(
            NativeVcsStatusResponse.self,
            from: Data(result.response.payload.utf8)
        )
        return response.refName
    }
}

private struct NativeVcsStatusRequest: Encodable {
    let cwd: String
}

private struct NativeVcsStatusResponse: Decodable {
    let refName: String?
}

/// Resolves the workspace git/PR probe snapshot through the server-side
/// `workspace.gitProbe` contract (D-045): branch, ahead/behind and PR
/// number/state/checks. The client never shells out to `gh` or scrapes
/// panes; the server owns probing and caches per workspace.
protocol NativeWorkspaceGitProbeProviding: Sendable {
    func probe(workspacePath: String) async throws -> WorkspaceIndex.WorkspaceGitProbeSnapshot
}

struct NativeGitProbeServerConnectionClient: NativeWorkspaceGitProbeProviding {
    private let sessionID: ServerConnection.SessionID
    private let sendServerRequest: ServerConnection.SendServerRequest

    init(
        sessionID: ServerConnection.SessionID,
        sendServerRequest: ServerConnection.SendServerRequest
    ) {
        self.sessionID = sessionID
        self.sendServerRequest = sendServerRequest
    }

    func probe(workspacePath: String) async throws -> WorkspaceIndex.WorkspaceGitProbeSnapshot {
        let payloadData = try JSONEncoder().encode(NativeWorkspaceGitProbeRequest(cwd: workspacePath))
        let result = try await sendServerRequest.run(ServerConnection.SendServerRequestInput(
            requestID: .generated(),
            sessionID: sessionID,
            request: ServerConnection.RequestEnvelope(
                method: "workspace.gitProbe",
                payload: String(decoding: payloadData, as: UTF8.self),
                retryPolicy: .retryOnceAfterReconnect
            )
        )).get()
        return try WorkspaceIndex.decodeWorkspaceGitProbeSnapshot(
            from: Data(result.response.payload.utf8)
        )
    }
}

private struct NativeWorkspaceGitProbeRequest: Encodable {
    let cwd: String
}

struct NativeAgentComposerTarget: Equatable, Sendable {
    let workspaceID: WorkspaceID
    let windowID: FenrirWindowID
    let paneID: PaneID
    let viewportID: ViewportID
}

@MainActor
final class NativeAgentComposerActionController {
    private let store: any AgentInteraction.AgentComposerStore
    private let submitter: any AgentInteraction.AgentPromptSubmitting
    private let clock = NativeAgentComposerClock()

    init(
        store: any AgentInteraction.AgentComposerStore = NativeAgentComposerStore(),
        submitter: any AgentInteraction.AgentPromptSubmitting
    ) {
        self.store = store
        self.submitter = submitter
    }

    func openComposer(
        contextSource: Keybinding.AgentComposerContextSource,
        shellState: NativeWorkspaceShellState,
        terminalHost: NativeTerminalPaneHostView
    ) async throws -> AgentInteraction.ComposerState {
        guard let target = terminalHost.focusedAgentContextTarget() else {
            throw AgentInteraction.AgentInteractionError.contextCaptureFailed
        }
        let requestID = RequestID.generated()
        let context = NativeAgentComposerContext(source: contextSource)
        let action = AgentInteraction.OpenAgentComposerFromContext(
            capturer: NativeAgentTerminalContextCapturer(
                terminalView: terminalHost.terminalView,
                target: target,
                context: context
            ),
            redactor: NativeAgentTerminalContextRedactor(),
            store: store,
            clock: clock
        )

        return try await action.run(.init(
            requestID: requestID,
            contextRequest: AgentInteraction.TerminalContextRequest(
                requestID: RequestID(rawValue: "\(requestID.rawValue).context"),
                workspaceID: target.workspaceID,
                viewportID: target.viewportID,
                tabID: target.windowID,
                paneID: target.paneID,
                kind: context.kind,
                limit: context.limit,
                source: .workspaceShell
            ),
            composerID: AgentInteraction.AgentComposerID(rawValue: "agent-composer-\(requestID.rawValue)"),
            target: AgentInteraction.TargetWorkspace(
                workspaceID: target.workspaceID,
                originatingPaneID: target.paneID,
                originatingViewportID: target.viewportID
            ),
            source: .workspaceShell
        )).get().composer
    }

    func submitComposer(_ command: AgentInteraction.SubmitComposerDraftCommand) async -> (composer: AgentInteraction.ComposerState, error: AgentInteraction.AgentInteractionError?) {
        let edit = AgentInteraction.EditAgentPromptDraft(store: store, clock: clock)
        let edited = await edit.run(command.edit)
        let current = (try? edited.get().composer)

        let submit = AgentInteraction.SubmitAgentPrompt(store: store, submitter: submitter, clock: clock)
        switch await submit.run(command.submit) {
        case let .success(result):
            return (result.composer, nil)
        case let .failure(error):
            guard let current else {
                return (AgentInteraction.ComposerState(
                    composerID: command.submit.composerID,
                    target: AgentInteraction.TargetWorkspace(workspaceID: "unknown"),
                    draft: command.edit.draft,
                    status: .open,
                    updatedAt: clock.now()
                ), error)
            }
            return (current, error)
        }
    }

    func cancelComposer(_ input: AgentInteraction.CancelAgentComposerInput) async -> AgentInteraction.ComposerState? {
        try? await AgentInteraction.CancelAgentPrompt(store: store, clock: clock).run(input).get().composer
    }
}

private struct NativeAgentComposerClock: AgentInteraction.AgentInteractionClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date())
    }
}

private struct NativeAgentComposerContext: Sendable {
    let source: Keybinding.AgentComposerContextSource

    var kind: AgentInteraction.ContextKind {
        switch source {
        case .selection:
            return .selection
        case .viewport:
            return .viewport
        case .lastLines:
            return .lastLines
        }
    }

    var limit: AgentInteraction.ContextLimit {
        switch source {
        case .selection:
            return AgentInteraction.ContextLimit(maxCharacters: 12_000)
        case .viewport:
            return AgentInteraction.ContextLimit(maxCharacters: 12_000)
        case .lastLines(let maxLines):
            return AgentInteraction.ContextLimit(maxLines: maxLines, maxCharacters: 12_000)
        }
    }
}

private final class NativeAgentTerminalContextCapturer: AgentInteraction.TerminalContextCapturing, @unchecked Sendable {
    private let terminalView: FenrirTerminalView
    private let target: NativeAgentComposerTarget
    private let context: NativeAgentComposerContext

    init(
        terminalView: FenrirTerminalView,
        target: NativeAgentComposerTarget,
        context: NativeAgentComposerContext
    ) {
        self.terminalView = terminalView
        self.target = target
        self.context = context
    }

    func captureTerminalContext(_ request: AgentInteraction.TerminalContextRequest) async throws -> AgentInteraction.CapturedTerminalContext {
        let text = await MainActor.run {
            switch context.source {
            case .selection:
                return terminalView.captureSelection().text
            case .viewport:
                return terminalView.captureViewport().text
            case .lastLines(let maxLines):
                return terminalView.captureLastLines(maxLines: maxLines).text
            }
        }
        return AgentInteraction.CapturedTerminalContext(
            workspaceID: target.workspaceID,
            viewportID: target.viewportID,
            tabID: target.windowID,
            paneID: target.paneID,
            kind: request.kind,
            text: text
        )
    }
}

private struct NativeAgentTerminalContextRedactor: AgentInteraction.TerminalContextRedacting {
    func redactTerminalContext(_ context: AgentInteraction.CapturedTerminalContext) async throws -> AgentInteraction.RedactedTerminalContext {
        AgentInteraction.RedactedTerminalContext(text: context.text)
    }
}

private actor NativeAgentComposerStore: AgentInteraction.AgentComposerStore {
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
        let next = composer.updated(draft: draft, updatedAt: updatedAt)
        composers[composerID] = next
        return .mutated(next)
    }

    func cancelComposer(composerID: AgentInteraction.AgentComposerID, updatedAt: FenrirTimestamp) async throws -> AgentInteraction.ComposerMutationResult {
        guard let composer = composers[composerID] else {
            return .notFound
        }
        guard composer.status == .open || composer.status == .submitting else {
            return .unavailableStatus(composer.status)
        }
        let next = composer.updated(status: .cancelled, updatedAt: updatedAt)
        composers[composerID] = next
        return .mutated(next)
    }

    func claimComposerForSubmit(composerID: AgentInteraction.AgentComposerID, updatedAt: FenrirTimestamp) async throws -> AgentInteraction.ComposerSubmitClaim {
        guard let composer = composers[composerID] else {
            return .notFound
        }
        guard composer.status == .open else {
            return .unavailableStatus(composer.status)
        }
        let next = composer.updated(status: .submitting, updatedAt: updatedAt)
        composers[composerID] = next
        return .claimed(next)
    }

    func finalizeComposerSubmit(
        composerID: AgentInteraction.AgentComposerID,
        outcome: AgentInteraction.ComposerSubmitOutcome,
        updatedAt: FenrirTimestamp
    ) async throws -> AgentInteraction.ComposerSubmitFinalization {
        guard let composer = composers[composerID] else {
            return .notFound
        }
        guard composer.status != .cancelled else {
            return .cancelled(composer)
        }
        guard composer.status == .submitting else {
            return .unavailableStatus(composer.status)
        }

        let next: AgentInteraction.ComposerState
        switch outcome {
        case .failed:
            next = composer.updated(status: .open, updatedAt: updatedAt)
        case .submitted(let promptID):
            next = composer.updated(status: .submitted, submittedPromptID: promptID, updatedAt: updatedAt)
        }
        composers[composerID] = next
        return .finalized(next)
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

struct NativeAppServerConnectionContext: Sendable {
    let sessionID: ServerConnection.SessionID
    let store: any ServerConnection.ServerConnectionStore & ServerConnection.LocalServerSupervisorStateStore
    let sendServerRequest: ServerConnection.SendServerRequest
    let streamServerRequest: @Sendable (NativeRuntime.ServerRPCRequest) -> AsyncThrowingStream<Data, Error>
    let serverEventSource: NativeAppServerEventSource
    let notificationStore: any Notifications.NotificationStore
    private let rpcTransport: any ServerConnection.NativeServerRPCTransporting
    private let bootstrapCredential: String?
    private let localServerProcessManager: (any ServerConnection.LocalServerProcessManaging)?

    var agentPromptSubmitterFactory: any NativeAgentPromptSubmitterMaking {
        NativeAgentServerConnectionPromptSubmitterFactory(
            sessionID: sessionID,
            sendServerRequest: sendServerRequest
        )
    }

    var paneGridRuntimeFactory: any NativePaneGridRuntimeMaking {
        NativePaneGridServerConnectionRuntimeFactory(
            actor: NativeAppServerConnectionContext.runtimeActor(sessionID: sessionID),
            sessionID: sessionID,
            sendServerRequest: sendServerRequest
        )
    }

    var scriptPaneRunner: any NativeWorkspaceScriptPaneRunning {
        NativeServerScriptPaneRunner(
            actor: NativeAppServerConnectionContext.runtimeActor(sessionID: sessionID),
            paneRuntime: NativeRuntime.ServerTmuxRuntimeAdapter(transport: NativeServerConnectionRuntimeRPCTransport(
                sessionID: sessionID,
                sendServerRequest: sendServerRequest,
                streamServerRequest: streamServerRequest
            ))
        )
    }

    /// D-044: resume launcher for dead agent sessions — a fresh tmux pane
    /// running the validated per-adapter resume command with agent metadata.
    var agentSessionResumer: any NativeAgentSessionResuming {
        NativeServerAgentSessionResumer(
            actor: NativeAppServerConnectionContext.runtimeActor(sessionID: sessionID),
            paneRuntime: NativeRuntime.ServerTmuxRuntimeAdapter(transport: NativeServerConnectionRuntimeRPCTransport(
                sessionID: sessionID,
                sendServerRequest: sendServerRequest,
                streamServerRequest: streamServerRequest
            ))
        )
    }

    /// D-044: attaches {agentID, sessionID} to pane records when session-start
    /// presence arrives, so resumability survives client restarts server-side.
    var agentPaneMetadataAttacher: any NativeAgentPaneMetadataAttaching {
        NativeServerAgentPaneMetadataAttacher(
            actor: NativeAppServerConnectionContext.runtimeActor(sessionID: sessionID),
            paneRuntime: NativeRuntime.ServerTmuxRuntimeAdapter(transport: NativeServerConnectionRuntimeRPCTransport(
                sessionID: sessionID,
                sendServerRequest: sendServerRequest,
                streamServerRequest: streamServerRequest
            ))
        )
    }

    var paneStreamSubscriber: NativePaneStreamSubscriber {
        let runtime = NativeRuntime.ServerTmuxRuntimeAdapter(transport: NativeServerConnectionRuntimeRPCTransport(
            sessionID: sessionID,
            sendServerRequest: sendServerRequest,
            streamServerRequest: streamServerRequest
        ))
        let actor = NativeAppServerConnectionContext.runtimeActor(sessionID: sessionID)
        return { workspaceID, pane, backfill in
            await runtime.reconnectPaneStream(
                NativeRuntime.ReconnectPaneStreamInput(
                    requestID: RequestID(rawValue: "native-pane-stream-\(pane.paneID.rawValue)"),
                    workspaceID: workspaceID,
                    paneID: pane.paneID,
                    actor: actor,
                    source: .nativeHost
                ),
                stream: NativeRuntime.PaneStreamState(
                    paneID: pane.paneID,
                    streamID: pane.streamID,
                    status: .subscribing
                ),
                backfill: backfill
            )
        }
    }

    var neovimBridgeControllerFactory: any NativeNeovimBridgeControllerMaking {
        NativeNeovimServerConnectionControllerFactory(
            actor: NativeAppServerConnectionContext.runtimeActor(sessionID: sessionID),
            sessionID: sessionID,
            sendServerRequest: sendServerRequest
        )
    }

    var workflowServerClientFactory: any NativeWorkflowServerClientMaking {
        NativeWorkflowServerConnectionClientFactory(
            sessionID: sessionID,
            sendServerRequest: sendServerRequest
        )
    }

    var workflowEventStreamFactory: any NativeWorkflowEventStreamMaking {
        NativeWorkflowServerConnectionEventStreamFactory(streamServerRequest: streamServerRequest)
    }

    var localServersEventStream: any NativeLocalServersEventStreaming {
        NativeLocalServersServerConnectionEventStream(streamServerRequest: streamServerRequest)
    }

    /// D-042 approval feed relay stream (`subscribeApprovalFeed`).
    var approvalFeedEventStream: any NativeApprovalFeedEventStreaming {
        NativeApprovalFeedServerConnectionEventStream(streamServerRequest: streamServerRequest)
    }

    /// D-042 decide RPC (`agentFeed.decide`).
    var approvalFeedDecider: any NativeApprovalFeedDeciding {
        NativeApprovalFeedServerConnectionDecider(
            sessionID: sessionID,
            sendServerRequest: sendServerRequest
        )
    }

    var workspaceVcsStatusProvider: any NativeWorkspaceVcsStatusProviding {
        NativeVcsServerConnectionStatusClient(
            sessionID: sessionID,
            sendServerRequest: sendServerRequest
        )
    }

    var workspaceGitProbeProvider: any NativeWorkspaceGitProbeProviding {
        NativeGitProbeServerConnectionClient(
            sessionID: sessionID,
            sendServerRequest: sendServerRequest
        )
    }

    static func localDefault(
        transport: any ServerConnection.NativeServerRPCTransporting = ServerConnection.NativeURLSessionServerRPCTransport(),
        bootstrapCredential: String? = NativeAppServerConnectionContext.localBootstrapCredential()
    ) -> NativeAppServerConnectionContext {
        let sessionID = ServerConnection.SessionID(rawValue: "native-app-local")
        return NativeAppServerConnectionContext.connectedLocalDefault(
            sessionID: sessionID,
            endpoint: NativeAppServerConnectionContext.localDefaultSpec().endpoint,
            supervisorState: nil,
            transport: transport,
            bootstrapCredential: bootstrapCredential
        )
    }

    static func preparedLocalDefault(
        spec: ServerConnection.LocalServerSpec = NativeAppServerConnectionContext.localDefaultSpec(),
        supervisor: NativeLocalServerSupervisor = NativeLocalServerSupervisor.localDefault(),
        transport: any ServerConnection.NativeServerRPCTransporting = ServerConnection.NativeURLSessionServerRPCTransport(),
        bootstrapCredential: String? = NativeAppServerConnectionContext.localBootstrapCredential(),
        restartPolicy: ServerConnection.LocalServerRestartPolicy = ServerConnection.LocalServerRestartPolicy(),
        attachPolicy: ServerConnection.LocalServerAttachPolicy = NativeAppServerConnectionContext.defaultLocalAttachPolicy(),
        requestID: RequestID = "native-local-default-prepare"
    ) async -> Result<NativeAppServerConnectionContext, ServerConnection.ServerConnectionError> {
        let sessionID = ServerConnection.SessionID(rawValue: "native-app-local")
        let store = ServerConnection.InMemoryServerConnectionStore()
        let prepareResult = await ServerConnection.PrepareLocalServerConnection(
            discovery: supervisor,
            spawner: supervisor,
            readiness: supervisor,
            processManager: supervisor,
            foreignTerminator: supervisor,
            stateStore: store,
            clock: NativeAppServerConnectionClock()
        ).run(ServerConnection.PrepareLocalServerConnectionInput(
            requestID: requestID,
            mode: .localDefault(spec),
            restartPolicy: restartPolicy,
            attachPolicy: attachPolicy
        ))

        switch prepareResult {
        case .success(let prepared):
            return .success(NativeAppServerConnectionContext.connectedLocalDefault(
                sessionID: sessionID,
                endpoint: prepared.endpoint,
                supervisorState: prepared.supervisorState,
                localServerProcessManager: supervisor,
                transport: transport,
                bootstrapCredential: bootstrapCredential
            ))
        case .failure(let error):
            return .failure(error)
        }
    }

    private static func connectedLocalDefault(
        sessionID: ServerConnection.SessionID,
        endpoint: ServerConnection.Endpoint,
        supervisorState: ServerConnection.LocalServerSupervisorState?,
        localServerProcessManager: (any ServerConnection.LocalServerProcessManaging)? = nil,
        transport: any ServerConnection.NativeServerRPCTransporting,
        bootstrapCredential: String?
    ) -> NativeAppServerConnectionContext {
        let session = NativeAppServerConnectionContext.connectedSession(
            sessionID: sessionID,
            endpoint: endpoint
        )
        let store = ServerConnection.InMemoryServerConnectionStore(session: session, supervisorState: supervisorState)
        let serverEventSource = NativeAppServerEventSource(sessionID: sessionID)
        let notificationStore = Notifications.inMemoryNotificationStore()
        return NativeAppServerConnectionContext(
            sessionID: sessionID,
            store: store,
            sendServerRequest: ServerConnection.SendServerRequest(
                sender: ServerConnection.NativeServerRequestSender(
                    transport: transport,
                    bootstrapCredential: bootstrapCredential,
                    onTransportFailure: { session, requestID, request, error in
                        await serverEventSource.recordTransportFailure(
                            session: session,
                            requestID: requestID,
                            request: request,
                            error: error
                        )
                    }
                ),
                store: store,
                clock: NativeAppServerConnectionClock()
            ),
            streamServerRequest: NativeAppServerConnectionContext.makeStreamServerRequest(
                store: store,
                transport: transport,
                bootstrapCredential: bootstrapCredential
            ),
            serverEventSource: serverEventSource,
            notificationStore: notificationStore,
            rpcTransport: transport,
            bootstrapCredential: bootstrapCredential,
            localServerProcessManager: localServerProcessManager
        )
    }

    func shutdownPreparedLocalServer(
        requestID: RequestID = "native-local-default-shutdown"
    ) async -> Result<ServerConnection.ShutdownLocalServerResult, ServerConnection.ServerConnectionError> {
        guard let localServerProcessManager else {
            return .failure(.invalidStateTransition)
        }

        return await ServerConnection.ShutdownLocalServer(
            processManager: localServerProcessManager,
            stateStore: store,
            clock: NativeAppServerConnectionClock()
        ).run(ServerConnection.ShutdownLocalServerInput(requestID: requestID))
    }

    private static func localDefaultSpec() -> ServerConnection.LocalServerSpec {
        ServerConnection.LocalServerSpec(
            httpBaseURL: "http://127.0.0.1:31337",
            webSocketURL: "ws://127.0.0.1:31337/ws",
            readinessTimeoutMilliseconds: 30_000
        )
    }

    private static func makeStreamServerRequest(
        store: any ServerConnection.ServerConnectionStore,
        transport: any ServerConnection.NativeServerRPCTransporting,
        bootstrapCredential: String?
    ) -> @Sendable (NativeRuntime.ServerRPCRequest) -> AsyncThrowingStream<Data, Error> {
        { request in
            AsyncThrowingStream { continuation in
                let task = Task {
                    do {
                        guard let session = try await store.loadSession(sessionID: nil) else {
                            throw ServerConnection.ServerConnectionError.sessionClosed
                        }
                        guard let httpBaseURL = session.endpoint.httpBaseURL.flatMap(URL.init(string:)) else {
                            throw ServerConnection.ServerConnectionError.endpointUnavailable
                        }
                        guard case .webSocketURL(let rawWebSocketURL) = session.endpoint.transport,
                              let webSocketURL = URL(string: rawWebSocketURL)
                        else {
                            throw ServerConnection.ServerConnectionError.endpointUnsupported
                        }
                        guard let bootstrapCredential, !bootstrapCredential.isEmpty else {
                            throw ServerConnection.ServerConnectionError.bootstrapRequired
                        }
                        let envelope = ServerConnection.RequestEnvelope(
                            method: request.method,
                            payload: String(decoding: request.payload, as: UTF8.self)
                        )
                        let responseStream = await transport.streamAuthenticatedRPC(
                            httpBaseURL: httpBaseURL,
                            webSocketURL: webSocketURL,
                            bootstrapCredential: bootstrapCredential,
                            session: session,
                            requestID: request.requestID,
                            request: envelope
                        )
                        for try await data in responseStream {
                            continuation.yield(data)
                        }
                        continuation.finish()
                    } catch {
                        continuation.finish(throwing: error)
                    }
                }
                continuation.onTermination = { _ in task.cancel() }
            }
        }
    }

    @MainActor
    func serverEventIntegrationGraph(workspaceWindows: NativeWorkspaceWindowRegistry) -> NativeServerEventIntegrationGraph {
        let clock = NativeAppServerConnectionClock()
        let runtimeStore = NativeAppRuntimeStore()
        let paneGridStore = NativeAppPaneGridStore()
        let runtime = NativeRuntime.ServerTmuxRuntimeAdapter(transport: NativeServerConnectionRuntimeRPCTransport(
            sessionID: sessionID,
            sendServerRequest: sendServerRequest,
            streamServerRequest: streamServerRequest
        ))
        let workflowClient = workflowServerClientFactory.makeClient(for: NativeWorkspaceShellState(
            workspaceID: "native-app",
            nativeWindowID: "native-app-window",
            paneGridState: NativeWorkspaceWindowRegistry.bootstrapPaneGridState(
                workspaceID: "native-app",
                nativeWindowID: "native-app-window"
            )
        ))
        return NativeServerEventIntegrationGraph(
            sessionHandler: NativeServerSessionReconnectActions(
                closeAction: ServerConnection.HandleServerTransportClose(
                    store: store,
                    clock: clock
                ),
                reconnectAction: ServerConnection.ReconnectServerSession(
                    authProvider: NativeAppServerAuthProvider(store: store),
                    transport: NativeAppReconnectTransportOpening(
                        sessionID: sessionID,
                        transport: rpcTransport,
                        bootstrapCredential: bootstrapCredential
                    ),
                    streams: NativeAppServerStreamOpening(bootstrapCredential: bootstrapCredential),
                    store: store,
                    clock: clock
                )
            ),
            workspaceHandler: NativeRuntimeWorkspaceExperienceReconnectHandler(
                workspaceWindows: workspaceWindows,
                actor: NativeAppServerConnectionContext.runtimeActor(sessionID: sessionID),
                enumerateRuntime: NativeRuntime.EnumerateWorkspaceRuntime(
                    enumerator: runtime,
                    store: runtimeStore,
                    clock: clock
                ),
                reconcileLayout: PaneGrid.ReconcileRuntimeLayout(
                    store: paneGridStore,
                    viewportHost: NativeAppPaneViewportHost(),
                    clock: clock
                )
            ),
            workflowRefresher: NativeWorkflowProjectionRefreshActions(
                listAction: WorkflowControl.ListWorkflowRuns(
                    clock: NativeWorkflowClock(),
                    serverClient: workflowClient
                ),
                observeAction: WorkflowControl.ObserveWorkflowRunTimeline(
                    clock: NativeWorkflowClock(),
                    serverClient: workflowClient
                )
            ),
            notificationRefresher: NativeNotificationProjectionRefreshAction(
                clock: NativeWorkflowNotificationClock(),
                store: notificationStore
            ),
            agentRefresher: NativeAppAgentInteractionRefresher()
        )
    }

    private static func connectedSession(
        sessionID: ServerConnection.SessionID,
        endpoint: ServerConnection.Endpoint
    ) -> ServerConnection.Session {
        let authSessionID = AuthSession.SessionID(rawValue: sessionID.rawValue)
        let actor = AuthSession.AuthenticatedActor(
            endpointScope: endpoint.authEndpointScope,
            sessionID: authSessionID,
            subject: "native-app",
            role: .owner
        )
        return ServerConnection.Session(
            sessionID: sessionID,
            endpoint: endpoint,
            actor: actor,
            authSessionID: authSessionID,
            capabilities: ServerConnection.Capabilities(
                protocolVersion: ServerConnection.ProtocolVersion("native-terminal/1"),
                supportsTmuxKernel: true,
                supportsPaneStreams: true,
                supportsAuthenticatedActors: true
            ),
            status: .connected,
            openedAt: FenrirTimestamp(Date()),
            lastHeartbeatAt: FenrirTimestamp(Date()),
            reconnectGeneration: 0
        )
    }

    private static func runtimeActor(sessionID: ServerConnection.SessionID) -> NativeRuntime.RuntimeActorIdentity {
        NativeRuntime.RuntimeActorIdentity(
            profileID: "local",
            authSessionID: sessionID.rawValue,
            subject: "native-app"
        )
    }

    private static func localBootstrapCredential(environment: [String: String] = ProcessInfo.processInfo.environment) -> String? {
        NativeDesktopBootstrapCredential.resolve(environment: environment)
    }

    /// A process-generated bootstrap credential can only ever authenticate
    /// against a server this process spawns, so an inherited server must be
    /// replaced. Environment-provided credentials are shared and may attach.
    ///
    /// `.replaceExisting` only ever replaces *orphaned* Fenrir servers: the
    /// supervisor verifies identity and ownership per pid at kill time and
    /// refuses (failing preparation with `.localServerForeignOwned`) when the
    /// port is held by a server owned by another live Fenrir instance or by
    /// any foreign process — see
    /// `NativeLocalServerSupervisor.terminateUnmanagedLocalServer`.
    static func defaultLocalAttachPolicy(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> ServerConnection.LocalServerAttachPolicy {
        NativeDesktopBootstrapCredential.resolve(environment: environment, generateIfMissing: false) != nil
            ? .attachIfHealthy
            : .replaceExisting
    }
}

struct NativeServerConnectionRuntimeRPCTransport: NativeRuntime.ServerRPCTransport {
    private let sessionID: ServerConnection.SessionID
    private let sendServerRequest: ServerConnection.SendServerRequest
    private let streamServerRequest: (@Sendable (NativeRuntime.ServerRPCRequest) -> AsyncThrowingStream<Data, Error>)?

    init(
        sessionID: ServerConnection.SessionID,
        sendServerRequest: ServerConnection.SendServerRequest,
        streamServerRequest: (@Sendable (NativeRuntime.ServerRPCRequest) -> AsyncThrowingStream<Data, Error>)? = nil
    ) {
        self.sessionID = sessionID
        self.sendServerRequest = sendServerRequest
        self.streamServerRequest = streamServerRequest
    }

    func request(_ request: NativeRuntime.ServerRPCRequest) async throws -> Data {
        let response = try await sendServerRequest.run(ServerConnection.SendServerRequestInput(
            requestID: request.requestID,
            sessionID: sessionID,
            request: ServerConnection.RequestEnvelope(
                method: request.method,
                payload: String(decoding: request.payload, as: UTF8.self)
            )
        )).get()
        return Data(response.response.payload.utf8)
    }

    func stream(_ request: NativeRuntime.ServerRPCRequest) async -> AsyncThrowingStream<Data, Error> {
        if let streamServerRequest {
            return streamServerRequest(request)
        }
        return AsyncThrowingStream { continuation in
            continuation.finish(throwing: ServerConnection.ServerConnectionError.endpointUnsupported)
        }
    }
}

private struct NativeAppServerAuthProvider: ServerConnection.ServerAuthSessionProviding {
    let store: any ServerConnection.ServerConnectionStore

    func authContext(endpoint: ServerConnection.Endpoint) async throws -> ServerConnection.AuthContext {
        guard let session = try await store.loadSession(sessionID: nil),
              session.endpoint.endpointID == endpoint.endpointID
        else {
            throw ServerConnection.ServerConnectionError.authUnavailable
        }
        return ServerConnection.AuthContext(authSessionID: session.authSessionID, actor: session.actor)
    }

    func refreshAuthContext(
        endpoint: ServerConnection.Endpoint,
        currentAuthSessionID: AuthSession.SessionID
    ) async throws -> ServerConnection.AuthContext {
        let context = try await authContext(endpoint: endpoint)
        guard context.authSessionID == currentAuthSessionID else {
            throw ServerConnection.ServerConnectionError.authRejected
        }
        return context
    }
}

private struct NativeAppReconnectTransportOpening: ServerConnection.ServerTransportOpening {
    let sessionID: ServerConnection.SessionID
    let transport: any ServerConnection.NativeServerRPCTransporting
    let bootstrapCredential: String?

    func openTransportSession(
        endpoint: ServerConnection.Endpoint,
        authContext: ServerConnection.AuthContext,
        clientProtocolVersion: ServerConnection.ProtocolVersion,
        generation: UInt64
    ) async throws -> ServerConnection.OpenedTransportSession {
        guard let httpBaseURL = endpoint.httpBaseURL.flatMap(URL.init(string:)) else {
            throw ServerConnection.ServerConnectionError.endpointUnavailable
        }
        guard case .webSocketURL(let rawWebSocketURL) = endpoint.transport,
              let webSocketURL = URL(string: rawWebSocketURL)
        else {
            throw ServerConnection.ServerConnectionError.endpointUnsupported
        }
        guard let bootstrapCredential, !bootstrapCredential.isEmpty else {
            throw ServerConnection.ServerConnectionError.bootstrapRequired
        }
        let probeSession = ServerConnection.Session(
            sessionID: sessionID,
            endpoint: endpoint,
            actor: authContext.actor,
            authSessionID: authContext.authSessionID,
            capabilities: ServerConnection.Capabilities(
                protocolVersion: clientProtocolVersion,
                supportsTmuxKernel: true,
                supportsPaneStreams: true,
                supportsAuthenticatedActors: true
            ),
            status: .reconnecting,
            openedAt: FenrirTimestamp(Date()),
            reconnectGeneration: generation
        )
        _ = try await transport.sendAuthenticatedRPC(
            httpBaseURL: httpBaseURL,
            webSocketURL: webSocketURL,
            bootstrapCredential: bootstrapCredential,
            session: probeSession,
            requestID: RequestID(rawValue: "native-reconnect-\(generation)"),
            request: ServerConnection.RequestEnvelope(
                method: "server.getConfig",
                payload: "{}"
            )
        )
        return ServerConnection.OpenedTransportSession(
            sessionID: sessionID,
            capabilities: ServerConnection.Capabilities(
                protocolVersion: clientProtocolVersion,
                supportsTmuxKernel: true,
                supportsPaneStreams: true,
                supportsAuthenticatedActors: true
            )
        )
    }

    func closeTransportSession(sessionID: ServerConnection.SessionID, generation: UInt64) async throws {}
}

private struct NativeAppServerStreamOpening: ServerConnection.ServerStreamOpening {
    let bootstrapCredential: String?

    func openServerStream(
        session: ServerConnection.Session,
        stream: ServerConnection.StreamHandle
    ) async throws -> ServerConnection.StreamHandle {
        guard session.capabilities.supportsPaneStreams else {
            throw ServerConnection.ServerConnectionError.capabilityMismatch
        }
        guard session.endpoint.httpBaseURL.flatMap(URL.init(string:)) != nil else {
            throw ServerConnection.ServerConnectionError.endpointUnavailable
        }
        guard case .webSocketURL(let rawWebSocketURL) = session.endpoint.transport,
              URL(string: rawWebSocketURL) != nil
        else {
            throw ServerConnection.ServerConnectionError.endpointUnsupported
        }
        guard let bootstrapCredential, !bootstrapCredential.isEmpty else {
            throw ServerConnection.ServerConnectionError.bootstrapRequired
        }
        return stream
    }

    func closeServerStream(session: ServerConnection.Session, streamID: ServerConnection.StreamID) async throws {}
}

protocol NativeVisibleWorkspaceProjecting: Sendable {
    func projectWorkspace(
        requestID: RequestID,
        workspaceID: WorkspaceID,
        identity: WorkspaceIndex.WorkspaceIdentity?,
        server: ServerConnection.Endpoint?
    ) async -> Result<WorkspaceIndex.WorkspaceSummary, WorkspaceCoordinator.WorkspaceCoordinatorError>
}

/// Projects an enumerated server tmux runtime into a PaneGrid session
/// snapshot. Shared by initial projection, reconnect restore, and the D-045
/// live layout refresh so every path renders the identical real-pane set
/// (D-019: only attached tmux panes appear).
func nativeTmuxLayoutSnapshot(
    from runtime: NativeRuntime.WorkspaceRuntimeState,
    panes runtimePanes: [NativeRuntime.PaneRuntimeState]
) -> PaneGrid.SessionSnapshot? {
    let panesByID = Dictionary(uniqueKeysWithValues: runtimePanes.map { ($0.paneID, $0) })
    guard let activeWindowID = runtime.activeWindowID ?? runtime.windows.first?.windowID,
          let tmuxSessionID = runtime.tmuxSessionID,
          !runtime.windows.isEmpty
    else {
        return nil
    }
    let windows = runtime.windows.compactMap { window -> PaneGrid.WindowSnapshot? in
        let panes = window.paneIDs.compactMap { paneID -> PaneGrid.PaneSnapshot? in
            guard let pane = panesByID[paneID],
                  pane.status == .attached,
                  let tmuxPaneID = pane.tmuxPaneID,
                  let x = pane.x,
                  let y = pane.y,
                  let size = pane.size
            else {
                return nil
            }
            return PaneGrid.PaneSnapshot(
                paneID: paneID,
                tmuxPaneID: tmuxPaneID,
                streamID: pane.stream.streamID,
                title: pane.metadata?.title ?? paneID.rawValue,
                rect: PaneGrid.PaneRect(x: x, y: y, columns: size.columns, rows: size.rows)
            )
        }
        guard !panes.isEmpty else {
            return nil
        }
        return PaneGrid.WindowSnapshot(
            windowID: window.windowID,
            tmuxWindowID: window.tmuxWindowID.rawValue,
            index: window.index,
            title: window.title,
            activePaneID: window.activePaneID,
            panes: panes
        )
    }
    guard windows.contains(where: { $0.windowID == activeWindowID }) else {
        return nil
    }
    return PaneGrid.SessionSnapshot(
        workspaceID: runtime.workspaceID,
        tmuxSessionID: tmuxSessionID.rawValue,
        activeWindowID: activeWindowID,
        windows: windows
    )
}

private final class NativeServerTmuxVisibleWorkspaceProjector: NativeVisibleWorkspaceProjecting, @unchecked Sendable {
    private weak var workspaceWindows: NativeWorkspaceWindowRegistry?
    private let actor: NativeRuntime.RuntimeActorIdentity
    private let runtime: NativeRuntime.ServerTmuxRuntimeAdapter
    private let reconcileLayout: PaneGrid.ReconcileRuntimeLayout

    init(
        workspaceWindows: NativeWorkspaceWindowRegistry,
        actor: NativeRuntime.RuntimeActorIdentity,
        runtime: NativeRuntime.ServerTmuxRuntimeAdapter,
        reconcileLayout: PaneGrid.ReconcileRuntimeLayout
    ) {
        self.workspaceWindows = workspaceWindows
        self.actor = actor
        self.runtime = runtime
        self.reconcileLayout = reconcileLayout
    }

    func projectWorkspace(
        requestID: RequestID,
        workspaceID: WorkspaceID,
        identity: WorkspaceIndex.WorkspaceIdentity?,
        server: ServerConnection.Endpoint?
    ) async -> Result<WorkspaceIndex.WorkspaceSummary, WorkspaceCoordinator.WorkspaceCoordinatorError> {
        let opened = await MainActor.run {
            guard let workspaceWindows else {
                return nil as NativeWorkspaceOpenResult?
            }
            let targetIdentity = identity ?? WorkspaceIndex.WorkspaceIdentity(
                kind: server == nil ? .localPath : .remote,
                workspaceID: workspaceID,
                canonicalPath: server == nil ? FileManager.default.currentDirectoryPath : nil,
                serverID: server?.displayName
            )
            return workspaceWindows.openWorkspace(identity: targetIdentity)
        }
        guard let opened else {
            return .failure(.reconnectFailed)
        }

        do {
            NSLog("Fenrir Native tmux workspace projection: ensure")
            let openedRuntime = try await runtime.openWorkspaceRuntime(NativeRuntime.OpenWorkspaceRuntimeInput(
                requestID: requestID,
                workspaceID: opened.summary.workspaceID,
                projectID: opened.summary.identity.projectID ?? opened.summary.workspaceID.rawValue,
                workingDirectory: opened.summary.canonicalPath ?? FileManager.default.currentDirectoryPath,
                actor: actor,
                source: .nativeHost
            ))
            NSLog("Fenrir Native tmux workspace projection: reconnect \(openedRuntime.workspaceID.rawValue)")
            _ = try await runtime.reconnectWorkspaceRuntime(NativeRuntime.ReconnectWorkspaceRuntimeInput(
                requestID: RequestID(rawValue: "\(requestID.rawValue)-runtime-reconnect"),
                workspaceID: openedRuntime.workspaceID,
                actor: actor,
                source: .nativeHost
            ))
            NSLog("Fenrir Native tmux workspace projection: enumerate \(openedRuntime.workspaceID.rawValue)")
            let enumerated = try await runtime.enumerateWorkspaceRuntime(NativeRuntime.EnumerateWorkspaceRuntimeInput(
                requestID: RequestID(rawValue: "\(requestID.rawValue)-enumerate"),
                workspaceID: openedRuntime.workspaceID,
                actor: actor,
                source: .nativeHost
            ))
            guard let snapshot = nativeTmuxLayoutSnapshot(
                from: enumerated.workspace,
                panes: enumerated.panes
            ) else {
                return .failure(.restoreFailed)
            }
            let layout = await reconcileLayout.run(PaneGrid.ReconcileRuntimeLayoutInput(
                requestID: requestID,
                snapshot: snapshot,
                source: .nativeHost
            ))
            guard case .success(let reconciled) = layout else {
                return .failure(.restoreFailed)
            }
            await MainActor.run {
                workspaceWindows?.applyReconnectedLayout(workspaceID: opened.summary.workspaceID, layout: reconciled.state)
            }
            return .success(opened.summary)
        } catch {
            NSLog("Fenrir Native tmux workspace projection failed: \(String(describing: error))")
            return .failure(.reconnectFailed)
        }
    }

}

final class NativeVisibleReconnectProjectionApplier: NativeServerReconnectProjectionApplying, @unchecked Sendable {
    private weak var workspaceWindows: NativeWorkspaceWindowRegistry?

    init(workspaceWindows: NativeWorkspaceWindowRegistry) {
        self.workspaceWindows = workspaceWindows
    }

    func applyServerReconnectProjection(_ projection: NativeServerReconnectProjection) async {
        let notifications = projection.notifications
        guard !notifications.isEmpty else {
            return
        }
        await MainActor.run {
            guard let workspaceWindows else {
                return
            }
            for projection in notifications {
                workspaceWindows.applyReconnectedNotifications(
                    workspaceID: projection.workspaceID,
                    notifications: WorkspaceIndex.WorkspaceNotificationState(
                        unreadCount: projection.unacknowledgedCount,
                        level: NativeVisibleReconnectProjectionApplier.workspaceLevel(for: projection.highestSeverity)
                    )
                )
            }
        }
    }

    private static func workspaceLevel(for severity: Notifications.NotificationSeverity?) -> WorkspaceIndex.WorkspaceNotificationLevel {
        switch severity {
        case .critical, .warning:
            return .attention
        case .info:
            return .badge
        case nil:
            return .none
        }
    }
}

private final class NativeRuntimeWorkspaceExperienceReconnectHandler: NativeWorkspaceExperienceReconnectHandling, @unchecked Sendable {
    private weak var workspaceWindows: NativeWorkspaceWindowRegistry?
    private let actor: NativeRuntime.RuntimeActorIdentity
    private let enumerateRuntime: NativeRuntime.EnumerateWorkspaceRuntime
    private let reconcileLayout: PaneGrid.ReconcileRuntimeLayout

    init(
        workspaceWindows: NativeWorkspaceWindowRegistry,
        actor: NativeRuntime.RuntimeActorIdentity,
        enumerateRuntime: NativeRuntime.EnumerateWorkspaceRuntime,
        reconcileLayout: PaneGrid.ReconcileRuntimeLayout
    ) {
        self.workspaceWindows = workspaceWindows
        self.actor = actor
        self.enumerateRuntime = enumerateRuntime
        self.reconcileLayout = reconcileLayout
    }

    func reconnectWorkspaceExperience(
        _ input: WorkspaceCoordinator.ReconnectWorkspaceExperienceInput
    ) async -> Result<WorkspaceCoordinator.ReconnectWorkspaceExperienceResult, WorkspaceCoordinator.WorkspaceCoordinatorError> {
        let opened = await MainActor.run {
            guard let workspaceWindows else {
                return nil as NativeWorkspaceOpenResult?
            }
            return workspaceWindows.openWorkspace(identity: input.identity)
        }
        guard let opened else {
            return .failure(.reconnectFailed)
        }

        let runtimeResult = await enumerateRuntime.run(NativeRuntime.EnumerateWorkspaceRuntimeInput(
            requestID: input.requestID,
            workspaceID: opened.summary.workspaceID,
            actor: actor,
            source: input.source
        ))
        guard case .success(let runtime) = runtimeResult,
              let snapshot = nativeTmuxLayoutSnapshot(
                from: runtime.workspace,
                panes: runtime.panes
              )
        else {
            return .failure(.restoreFailed)
        }

        let layoutResult = await reconcileLayout.run(PaneGrid.ReconcileRuntimeLayoutInput(
            requestID: input.requestID,
            snapshot: snapshot,
            source: input.source
        ))
        guard case .success(let layout) = layoutResult else {
            return .failure(.restoreFailed)
        }

        await MainActor.run {
            workspaceWindows?.applyReconnectedLayout(workspaceID: opened.summary.workspaceID, layout: layout.state)
        }

        let streamIDsByPane = Dictionary(uniqueKeysWithValues: runtime.panes.map { pane in
            (pane.paneID, pane.stream.streamID)
        })
        let restoredPanes = layout.state.windows.flatMap(\.panes).compactMap { pane -> WorkspaceCoordinator.VisiblePaneRestore? in
            guard let streamID = streamIDsByPane[pane.paneID] ?? nil else {
                return nil
            }
            return WorkspaceCoordinator.VisiblePaneRestore(
                paneID: pane.paneID,
                viewportID: pane.viewportID,
                streamID: streamID
            )
        }
        let experience = WorkspaceCoordinator.WorkspaceExperience(
            workspace: opened.summary,
            serverSelection: input.serverSelection,
            windowID: opened.windowID,
            runtime: runtime.workspace,
            layout: layout.state,
            restoredPanes: restoredPanes
        )
        return .success(WorkspaceCoordinator.ReconnectWorkspaceExperienceResult(
            requestID: input.requestID,
            experience: experience,
            timestamp: layout.timestamp
        ))
    }
}

private actor NativeAppRuntimeStore: NativeRuntime.NativeRuntimeStore {
    private var capabilities: NativeRuntime.RuntimeCapabilities?
    private var workspaces: [WorkspaceID: NativeRuntime.WorkspaceRuntimeState] = [:]
    private var panes: [PaneID: NativeRuntime.PaneRuntimeState] = [:]

    func loadCapabilities() async throws -> NativeRuntime.RuntimeCapabilities? {
        capabilities
    }

    func saveCapabilities(_ capabilities: NativeRuntime.RuntimeCapabilities) async throws {
        self.capabilities = capabilities
    }

    func loadWorkspace(workspaceID: WorkspaceID) async throws -> NativeRuntime.WorkspaceRuntimeState? {
        workspaces[workspaceID]
    }

    func saveWorkspace(_ workspace: NativeRuntime.WorkspaceRuntimeState) async throws {
        workspaces[workspace.workspaceID] = workspace
    }

    func deleteWorkspace(workspaceID: WorkspaceID) async throws {
        workspaces[workspaceID] = nil
    }

    func loadPane(paneID: PaneID) async throws -> NativeRuntime.PaneRuntimeState? {
        panes[paneID]
    }

    func savePane(_ pane: NativeRuntime.PaneRuntimeState) async throws {
        panes[pane.paneID] = pane
    }

    func deletePane(paneID: PaneID) async throws {
        panes[paneID] = nil
    }
}

private actor NativeAppPaneGridStore: PaneGrid.PaneGridStore {
    private var grids: [WorkspaceID: PaneGrid.State] = [:]

    func loadGrid(workspaceID: WorkspaceID) async throws -> PaneGrid.State? {
        grids[workspaceID]
    }

    func saveGrid(_ state: PaneGrid.State) async throws {
        grids[state.workspaceID] = state
    }

    func deleteGrid(workspaceID: WorkspaceID) async throws {
        grids[workspaceID] = nil
    }
}

private struct NativeAppPaneViewportHost: PaneGrid.PaneViewportHosting {
    func createViewport(workspaceID: WorkspaceID, windowID: FenrirWindowID, paneID: PaneID) async throws -> ViewportID {
        ViewportID(rawValue: "viewport-\(workspaceID.rawValue)-\(windowID.rawValue)-\(paneID.rawValue)")
    }

    func disposeViewport(viewportID: ViewportID) async throws {}
}

private struct NativeAppAgentInteractionRefresher: NativeAgentInteractionRefreshing {
    func refreshAgentInteractions(
        _ input: NativeAgentInteractionRefreshInput
    ) async -> Result<NativeAgentInteractionRefreshResult, AgentInteraction.AgentInteractionError> {
        .success(NativeAgentInteractionRefreshResult(
            requestID: input.requestID,
            workspaceID: input.workspaceID,
            activeComposerIDs: input.activeComposerIDs
        ))
    }
}

private struct NativeAppServerConnectionClock: ServerConnection.ServerConnectionClock, NativeRuntime.NativeRuntimeClock, PaneGrid.PaneGridClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date())
    }
}

actor NativeAppServerEventSource {
    private let sessionID: ServerConnection.SessionID
    private var controller: NativeHostServerEventController?
    private var emittedReconnectKeys: Set<String> = []

    init(sessionID: ServerConnection.SessionID) {
        self.sessionID = sessionID
    }

    func setController(_ controller: NativeHostServerEventController?) {
        self.controller = controller
    }

    func recordTransportFailure(
        session: ServerConnection.Session,
        requestID: RequestID,
        request: ServerConnection.RequestEnvelope,
        error: Error
    ) async {
        guard !NativeAppServerEventSource.isNativeHostProjectionRequest(requestID),
              NativeAppServerEventSource.shouldDispatchReconnect(for: error),
              let controller,
              let workspaceID = NativeAppServerEventSource.workspaceID(from: request.payload),
              case .webSocketURL(let serverURL) = session.endpoint.transport
        else {
            return
        }
        let key = "\(session.sessionID.rawValue):\(session.reconnectGeneration):\(workspaceID.rawValue)"
        guard !emittedReconnectKeys.contains(key) else {
            return
        }
        emittedReconnectKeys.insert(key)
        _ = error
        _ = await controller.dispatch(.reconnectWorkspace(
            requestID: RequestID(rawValue: "\(requestID.rawValue)-server-reconnect"),
            workspaceID: workspaceID,
            serverID: session.endpoint.displayName,
            serverURL: serverURL,
            sessionID: sessionID,
            generation: session.reconnectGeneration
        ))
    }

    private static func shouldDispatchReconnect(for error: Error) -> Bool {
        guard let connectionError = error as? ServerConnection.ServerConnectionError else {
            return true
        }
        switch connectionError {
        case .transportUnavailable, .localServerUnavailable, .sessionClosed, .authRejected:
            return true
        default:
            return false
        }
    }

    private static func isNativeHostProjectionRequest(_ requestID: RequestID) -> Bool {
        requestID.rawValue.hasPrefix("native-reconnect-") ||
            requestID.rawValue.hasPrefix("native-smoke-") ||
            requestID.rawValue.hasPrefix("native-workflow-") ||
            requestID.rawValue.contains("-runtime-reconnect") ||
            requestID.rawValue.contains("-enumerate")
    }

    private static func workspaceID(from payload: String) -> WorkspaceID? {
        guard let data = payload.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data, options: [])
        else {
            return nil
        }
        if let value = findString(in: json, keys: ["workspaceId", "workspaceID", "projectId"]) {
            return WorkspaceID(rawValue: value)
        }
        return nil
    }

    private static func findString(in value: Any, keys: Set<String>) -> String? {
        if let dictionary = value as? [String: Any] {
            for key in keys {
                if let string = dictionary[key] as? String, !string.isEmpty {
                    return string
                }
            }
            for child in dictionary.values {
                if let string = findString(in: child, keys: keys) {
                    return string
                }
            }
        }
        if let array = value as? [Any] {
            for child in array {
                if let string = findString(in: child, keys: keys) {
                    return string
                }
            }
        }
        return nil
    }
}

protocol NativeAgentPromptSubmitterMaking: Sendable {
    func makeSubmitter(for state: NativeWorkspaceShellState) -> any AgentInteraction.AgentPromptSubmitting
}

struct NativeAgentServerConnectionPromptSubmitterFactory: NativeAgentPromptSubmitterMaking {
    private let sessionID: ServerConnection.SessionID
    private let sendServerRequest: ServerConnection.SendServerRequest

    init(
        sessionID: ServerConnection.SessionID,
        sendServerRequest: ServerConnection.SendServerRequest
    ) {
        self.sessionID = sessionID
        self.sendServerRequest = sendServerRequest
    }

    func makeSubmitter(for state: NativeWorkspaceShellState) -> any AgentInteraction.AgentPromptSubmitting {
        NativeAgentServerPromptSubmitter(
            workspaceID: state.workspaceID,
            sessionID: sessionID,
            sendServerRequest: sendServerRequest
        )
    }
}

struct NativeAgentServerPromptSubmitter: AgentInteraction.AgentPromptSubmitting {
    private let workspaceID: WorkspaceID
    private let sessionID: ServerConnection.SessionID
    private let sendServerRequest: ServerConnection.SendServerRequest

    init(
        workspaceID: WorkspaceID,
        sessionID: ServerConnection.SessionID,
        sendServerRequest: ServerConnection.SendServerRequest
    ) {
        self.workspaceID = workspaceID
        self.sessionID = sessionID
        self.sendServerRequest = sendServerRequest
    }

    func submitAgentPrompt(_ request: AgentInteraction.ServerPromptRequest) async throws -> AgentInteraction.ServerPromptAccepted {
        let createdAt = ISO8601DateFormatter().string(from: Date())
        let command = NativeAgentOrchestrationTurnStartCommand(
            request: request,
            workspaceID: workspaceID,
            createdAt: createdAt
        )
        let payload = try String(decoding: JSONEncoder().encode(command), as: UTF8.self)
        let envelope = ServerConnection.RequestEnvelope(
            method: "orchestration.dispatchCommand",
            payload: payload
        )
        _ = try await sendServerRequest.run(ServerConnection.SendServerRequestInput(
            requestID: request.requestID,
            sessionID: sessionID,
            request: envelope
        )).get()
        return AgentInteraction.ServerPromptAccepted(
            promptID: request.requestID,
            acceptedAt: FenrirTimestamp(Date())
        )
    }
}

struct NativeWorkflowServerConnectionClientFactory: NativeWorkflowServerClientMaking {
    private let sessionID: ServerConnection.SessionID
    private let sendServerRequest: ServerConnection.SendServerRequest

    init(
        sessionID: ServerConnection.SessionID,
        sendServerRequest: ServerConnection.SendServerRequest
    ) {
        self.sessionID = sessionID
        self.sendServerRequest = sendServerRequest
    }

    func makeClient(for state: NativeWorkspaceShellState) -> any WorkflowControl.WorkflowServerClient {
        NativeWorkflowServerConnectionClient(
            workspaceID: state.workspaceID,
            sessionID: sessionID,
            sendServerRequest: sendServerRequest
        )
    }
}

struct NativeWorkflowServerConnectionClient: WorkflowControl.WorkflowServerClient {
    private let workspaceID: WorkspaceID
    private let sessionID: ServerConnection.SessionID
    private let sendServerRequest: ServerConnection.SendServerRequest

    init(
        workspaceID: WorkspaceID,
        sessionID: ServerConnection.SessionID,
        sendServerRequest: ServerConnection.SendServerRequest
    ) {
        self.workspaceID = workspaceID
        self.sessionID = sessionID
        self.sendServerRequest = sendServerRequest
    }

    func listWorkflowRuns(filter: WorkflowControl.WorkflowRunListFilter) async throws -> [WorkflowControl.WorkflowRunSnapshot] {
        let projectID = filter.projectID ?? workspaceID.rawValue
        let result: NativeWorkflowListProjectResponse = try await call(
            method: "workflows.listProjectWorkflows",
            payload: NativeWorkflowListProjectRequest(projectId: projectID, includeArchived: false)
        )
        return result.runs
    }

    func getWorkflowRun(runID: WorkflowControl.WorkflowRunID) async throws -> WorkflowControl.WorkflowRunSnapshot {
        try await call(method: "workflows.getRun", payload: NativeWorkflowRunIDRequest(runId: runID.rawValue))
    }

    func getWorkflowTimeline(runID: WorkflowControl.WorkflowRunID) async throws -> [WorkflowControl.WorkflowTimelineEvent] {
        let result: NativeWorkflowTimelineResponse = try await call(
            method: "workflows.getTimeline",
            payload: NativeWorkflowRunIDRequest(runId: runID.rawValue)
        )
        return result.events
    }

    func pauseWorkflowRun(runID: WorkflowControl.WorkflowRunID) async throws -> WorkflowControl.WorkflowRunSnapshot {
        throw WorkflowControl.WorkflowControlError.commandRejected("workflow pause is not exposed by the current server contract")
    }

    func stopWorkflowRun(runID: WorkflowControl.WorkflowRunID) async throws -> WorkflowControl.WorkflowRunSnapshot {
        let _: NativeWorkflowEmptyResponse = try await call(
            method: "workflows.stop",
            payload: NativeWorkflowRunIDRequest(runId: runID.rawValue)
        )
        return try await getWorkflowRun(runID: runID)
    }

    func rerunWorkflowRun(runID: WorkflowControl.WorkflowRunID) async throws -> WorkflowControl.WorkflowRunSnapshot {
        let original = try await getWorkflowRun(runID: runID)
        let result: NativeWorkflowRunResponse = try await call(
            method: "workflows.run",
            payload: NativeWorkflowRunRequest(
                projectId: original.projectID,
                originThreadId: original.originThreadID,
                workflowId: original.workflowID.rawValue,
                args: original.args
            )
        )
        return result.run
    }

    func respondToWorkflowInput(
        runID: WorkflowControl.WorkflowRunID,
        inputRequestID: WorkflowControl.WorkflowInputRequestID,
        response: WorkflowControl.WorkflowJSONValue
    ) async throws -> WorkflowControl.WorkflowRunSnapshot {
        let _: NativeWorkflowEmptyResponse = try await call(
            method: "workflows.respondToInput",
            payload: NativeWorkflowInputResponseRequest(
                runId: runID.rawValue,
                requestId: inputRequestID.rawValue,
                response: response
            )
        )
        return try await getWorkflowRun(runID: runID)
    }

    private func call<Payload: Encodable, Response: Decodable>(
        method: String,
        payload: Payload
    ) async throws -> Response {
        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
        let payloadData = try encoder.encode(payload)
        let envelope = ServerConnection.RequestEnvelope(
            method: method,
            payload: String(decoding: payloadData, as: UTF8.self),
            retryPolicy: .retryOnceAfterReconnect
        )
        let result = try await sendServerRequest.run(ServerConnection.SendServerRequestInput(
            requestID: .generated(),
            sessionID: sessionID,
            request: envelope
        )).get()
        let response = result.response
        let responseData = Data(response.payload.utf8)
        if responseData.isEmpty || response.payload == "{}" {
            return try decoder.decode(Response.self, from: Data("{}".utf8))
        }
        return try decoder.decode(Response.self, from: responseData)
    }
}

private struct NativeWorkflowListProjectRequest: Encodable {
    let projectId: String
    let includeArchived: Bool
}

private struct NativeWorkflowRunIDRequest: Encodable {
    let runId: String
}

private struct NativeWorkflowRunRequest: Encodable {
    let projectId: String
    let originThreadId: String
    let workflowId: String
    let args: WorkflowControl.WorkflowJSONValue
}

private struct NativeWorkflowInputResponseRequest: Encodable {
    let runId: String
    let requestId: String
    let response: WorkflowControl.WorkflowJSONValue
}

private struct NativeWorkflowListProjectResponse: Decodable {
    let runs: [WorkflowControl.WorkflowRunSnapshot]
}

private struct NativeWorkflowTimelineResponse: Decodable {
    let events: [WorkflowControl.WorkflowTimelineEvent]
}

private struct NativeWorkflowRunResponse: Decodable {
    let run: WorkflowControl.WorkflowRunSnapshot
}

private struct NativeWorkflowEmptyResponse: Decodable {}

private struct NativeAgentOrchestrationTurnStartCommand: Codable, Equatable, Sendable {
    let type: String
    let commandId: String
    let threadId: String
    let message: NativeAgentOrchestrationMessage
    let modelSelection: NativeAgentOrchestrationModelSelection
    let titleSeed: String
    let runtimeMode: String
    let interactionMode: String
    let mcpServerIds: [String]
    let bootstrap: NativeAgentOrchestrationBootstrap
    let createdAt: String

    init(
        request: AgentInteraction.ServerPromptRequest,
        workspaceID: WorkspaceID,
        createdAt: String
    ) {
        let promptID = request.requestID.rawValue
        let modelSelection = NativeAgentOrchestrationModelSelection(provider: "codex", model: "gpt-5.4")
        let title = NativeAgentOrchestrationTurnStartCommand.title(for: request.prompt)
        type = "thread.turn.start"
        commandId = "native-agent-command-\(promptID)"
        threadId = "native-agent-thread-\(promptID)"
        message = NativeAgentOrchestrationMessage(
            messageId: "native-agent-message-\(promptID)",
            role: "user",
            text: NativeAgentOrchestrationTurnStartCommand.messageText(for: request),
            attachments: []
        )
        self.modelSelection = modelSelection
        titleSeed = title
        runtimeMode = "full-access"
        interactionMode = "default"
        mcpServerIds = []
        bootstrap = NativeAgentOrchestrationBootstrap(createThread: NativeAgentOrchestrationCreateThread(
            projectId: workspaceID.rawValue,
            title: title,
            modelSelection: modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            mcpServerIds: [],
            branch: nil,
            worktreePath: nil,
            visibility: "editorTransient",
            deleteOnSettled: true,
            createdAt: createdAt
        ))
        self.createdAt = createdAt
    }

    private static func title(for prompt: String) -> String {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallback = "Native terminal prompt"
        let source = trimmed.isEmpty ? fallback : trimmed
        return String(source.prefix(80))
    }

    private static func messageText(for request: AgentInteraction.ServerPromptRequest) -> String {
        guard !request.attachments.isEmpty else {
            return request.prompt
        }
        let context = request.attachments.map { attachment in
            """
            Context: \(attachment.kind.rawValue)
            Workspace: \(attachment.workspaceID.rawValue)
            Pane: \(attachment.paneID.rawValue)
            Truncated: \(attachment.isTruncated)

            \(attachment.text)
            """
        }.joined(separator: "\n\n")
        return "\(request.prompt)\n\n---\nTerminal context:\n\(context)"
    }
}

private struct NativeAgentOrchestrationMessage: Codable, Equatable, Sendable {
    let messageId: String
    let role: String
    let text: String
    let attachments: [String]
}

private struct NativeAgentOrchestrationModelSelection: Codable, Equatable, Sendable {
    let provider: String
    let model: String
}

private struct NativeAgentOrchestrationBootstrap: Codable, Equatable, Sendable {
    let createThread: NativeAgentOrchestrationCreateThread
}

private struct NativeAgentOrchestrationCreateThread: Codable, Equatable, Sendable {
    let projectId: String
    let title: String
    let modelSelection: NativeAgentOrchestrationModelSelection
    let runtimeMode: String
    let interactionMode: String
    let mcpServerIds: [String]
    let branch: String?
    let worktreePath: String?
    let visibility: String
    let deleteOnSettled: Bool
    let createdAt: String
}

private final class NativePaneGridActionQueue: @unchecked Sendable {
    private let lock = NSLock()
    private var tail = Task<Void, Never> {}

    func enqueue(_ operation: @escaping @Sendable () async -> Void) {
        lock.lock()
        let previous = tail
        tail = Task.detached {
            await previous.value
            await operation()
        }
        lock.unlock()
    }

    func waitForIdle() async {
        await currentTail().value
    }

    private func currentTail() -> Task<Void, Never> {
        lock.lock()
        defer { lock.unlock() }
        return tail
    }
}

protocol NativePaneGridActionDispatching: Sendable {
    func applyPaneGridState(_ state: PaneGrid.State)
    func markServerBackedPaneGridState(_ state: PaneGrid.State)
    func focusPane(_ target: PaneGrid.PaneKernelTarget) async -> PaneGrid.State?
    func selectWindow(_ command: PaneGrid.SelectTabWindowCommand) async -> PaneGrid.State?
    func writeInput(_ bytes: Data, to target: PaneGrid.PaneKernelTarget) async
    func resizePane(_ allocation: PaneGrid.PaneResizeAllocation, in state: PaneGrid.State) async
    func resizePane(_ target: PaneGrid.PaneKernelTarget, size: TerminalViewport.Size, in state: PaneGrid.State) async
}

struct NativePaneGridActionController: NativePaneGridActionDispatching {
    private let store: NativePaneGridStore
    private let kernel: any PaneGrid.PaneKernelControlling
    private let runtime: (any NativePaneGridRuntimeControlling)?
    private let clock = NativePaneGridClock()

    init(
        initialState: PaneGrid.State,
        runtime: any NativePaneGridRuntimeControlling
    ) {
        store = NativePaneGridStore(initialState: initialState)
        self.runtime = runtime
        runtime.applyPaneGridState(initialState)
        kernel = NativePaneGridKernelBridge(runtime: runtime)
    }

    init(initialState: PaneGrid.State, kernel: any PaneGrid.PaneKernelControlling) {
        store = NativePaneGridStore(initialState: initialState)
        self.kernel = kernel
        runtime = nil
    }

    func applyPaneGridState(_ state: PaneGrid.State) {
        store.saveGridSynchronously(state)
        runtime?.applyPaneGridState(state)
    }

    func markServerBackedPaneGridState(_ state: PaneGrid.State) {
        applyPaneGridState(state)
        runtime?.markServerBackedPaneGridState(state)
    }

    func focusPane(_ target: PaneGrid.PaneKernelTarget) async -> PaneGrid.State? {
        try? await PaneGrid.FocusPane(store: store, kernel: kernel, clock: clock).run(.init(
            requestID: RequestID(rawValue: "appkit-pane-focus-\(target.paneID.rawValue)"),
            workspaceID: target.workspaceID,
            windowID: target.windowID,
            paneID: target.paneID,
            source: .nativeHost
        )).get().state
    }

    func selectWindow(_ command: PaneGrid.SelectTabWindowCommand) async -> PaneGrid.State? {
        try? await PaneGrid.SelectTabWindow(store: store, kernel: kernel, clock: clock).run(.init(
            requestID: command.requestID,
            workspaceID: command.workspaceID,
            windowID: command.windowID,
            source: command.source
        )).get().state
    }

    func writeInput(_ bytes: Data, to target: PaneGrid.PaneKernelTarget) async {
        try? await runtime?.writeInput(bytes, to: target)
    }

    func resizePane(_ allocation: PaneGrid.PaneResizeAllocation, in state: PaneGrid.State) async {
        guard let window = state.windows.first(where: { $0.panes.contains { $0.paneID == allocation.paneID } }) else {
            return
        }
        _ = try? await PaneGrid.ResizePaneAllocation(store: store, kernel: kernel, clock: clock).run(.init(
            requestID: RequestID(rawValue: "appkit-pane-resize-\(allocation.paneID.rawValue)"),
            workspaceID: state.workspaceID,
            windowID: window.windowID,
            allocation: allocation,
            source: .nativeHost
        )).get()
    }

    func resizePane(_ target: PaneGrid.PaneKernelTarget, size: TerminalViewport.Size, in state: PaneGrid.State) async {
        let clampedSize = NativePaneGridPaneSizeBounds.clamp(columns: size.columns, rows: size.rows)
        applyPaneGridState(state.resizing(paneID: target.paneID, size: clampedSize))
        do {
            try await runtime?.resizePane(target, size: clampedSize)
        } catch {
            NSLog(
                "Fenrir Native pane resize failed pane=%@ cols=%d rows=%d error=%@",
                target.tmuxPaneID.rawValue,
                clampedSize.columns,
                clampedSize.rows,
                String(describing: error)
            )
        }
    }
}

private final class NativePaneGridStore: PaneGrid.PaneGridStore, @unchecked Sendable {
    private let lock = NSLock()
    private var states: [WorkspaceID: PaneGrid.State]

    init(initialState: PaneGrid.State) {
        states = [initialState.workspaceID: initialState]
    }

    func loadGrid(workspaceID: WorkspaceID) async throws -> PaneGrid.State? {
        withLock {
            states[workspaceID]
        }
    }

    func saveGrid(_ state: PaneGrid.State) async throws {
        saveGridSynchronously(state)
    }

    func saveGridSynchronously(_ state: PaneGrid.State) {
        withLock {
            states[state.workspaceID] = state
        }
    }

    func deleteGrid(workspaceID: WorkspaceID) async throws {
        withLock {
            states[workspaceID] = nil
        }
    }

    private func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }
}

protocol NativePaneGridRuntimeControlling: Sendable {
    func applyPaneGridState(_ state: PaneGrid.State)
    func markServerBackedPaneGridState(_ state: PaneGrid.State)
    func focusPane(_ command: PaneGrid.FocusPaneCommand) async throws
    func writeInput(_ bytes: Data, to target: PaneGrid.PaneKernelTarget) async throws
    func resizePaneAllocation(_ command: PaneGrid.ResizePaneAllocationCommand) async throws
    func resizePane(_ target: PaneGrid.PaneKernelTarget, size: NativeRuntime.PaneSize) async throws
    func selectWindow(_ command: PaneGrid.SelectTabWindowCommand) async throws
}

protocol NativePaneGridRuntimeMaking: Sendable {
    func makeRuntime(for state: NativeWorkspaceShellState) -> any NativePaneGridRuntimeControlling
}

struct NativePaneGridUnavailableRuntimeFactory: NativePaneGridRuntimeMaking {
    func makeRuntime(for state: NativeWorkspaceShellState) -> any NativePaneGridRuntimeControlling {
        NativePaneGridUnavailableRuntimeController()
    }
}

struct NativePaneGridUnavailableRuntimeController: NativePaneGridRuntimeControlling {
    func applyPaneGridState(_ state: PaneGrid.State) {}

    func markServerBackedPaneGridState(_ state: PaneGrid.State) {}

    func focusPane(_ command: PaneGrid.FocusPaneCommand) async throws {
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }

    func writeInput(_ bytes: Data, to target: PaneGrid.PaneKernelTarget) async throws {
        _ = bytes
        _ = target
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }

    func resizePaneAllocation(_ command: PaneGrid.ResizePaneAllocationCommand) async throws {
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }

    func resizePane(_ target: PaneGrid.PaneKernelTarget, size: NativeRuntime.PaneSize) async throws {
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }

    func selectWindow(_ command: PaneGrid.SelectTabWindowCommand) async throws {
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }
}

struct NativePaneGridAppRuntimeController: NativePaneGridRuntimeControlling {
    private let stateStore = NativePaneGridRuntimeStateStore()
    private let commandPort: any NativePaneGridRuntimeCommandSending

    init(
        actor: NativeRuntime.RuntimeActorIdentity = NativePaneGridAppRuntimeController.defaultActor,
        sessionID: ServerConnection.SessionID,
        sendServerRequest: ServerConnection.SendServerRequest
    ) {
        self.init(commandPort: NativePaneGridServerRuntimeCommandPort(
            actor: actor,
            sessionID: sessionID,
            sendServerRequest: sendServerRequest
        ))
    }

    init(commandPort: any NativePaneGridRuntimeCommandSending) {
        self.commandPort = commandPort
    }

    func applyPaneGridState(_ state: PaneGrid.State) {
        stateStore.save(state)
    }

    func markServerBackedPaneGridState(_ state: PaneGrid.State) {
        stateStore.markServerBacked(state)
    }

    func focusPane(_ command: PaneGrid.FocusPaneCommand) async throws {
        try await commandPort.send(.focusPane(command))
    }

    func writeInput(_ bytes: Data, to target: PaneGrid.PaneKernelTarget) async throws {
        guard stateStore.isServerBacked(target) else {
            return
        }
        try await commandPort.send(.writePaneInput(
            RequestID(rawValue: "appkit-pane-input-\(target.paneID.rawValue)-\(UUID().uuidString)"),
            target,
            bytes
        ))
    }

    func resizePaneAllocation(_ command: PaneGrid.ResizePaneAllocationCommand) async throws {
        guard stateStore.isServerBacked(command.target) else {
            return
        }
        let size = stateStore.size(
            for: command.target.paneID,
            delta: command.delta,
            unit: command.unit,
            direction: command.direction
        )
        try await commandPort.send(.resizePane(command, size))
    }

    func resizePane(_ target: PaneGrid.PaneKernelTarget, size: NativeRuntime.PaneSize) async throws {
        guard stateStore.isServerBacked(target) else {
            return
        }
        try await commandPort.send(.resizePaneToSize(
            RequestID(rawValue: "appkit-pane-layout-resize-\(target.paneID.rawValue)"),
            target,
            size
        ))
    }

    func selectWindow(_ command: PaneGrid.SelectTabWindowCommand) async throws {
        try await commandPort.send(.selectWindow(command))
    }

    private static let defaultActor = NativeRuntime.RuntimeActorIdentity(
        profileID: ProfileID(rawValue: "local"),
        authSessionID: "native-app",
        subject: "native-app"
    )
}

struct NativePaneGridServerConnectionRuntimeFactory: NativePaneGridRuntimeMaking {
    private let actor: NativeRuntime.RuntimeActorIdentity
    private let sessionID: ServerConnection.SessionID
    private let sendServerRequest: ServerConnection.SendServerRequest

    init(
        actor: NativeRuntime.RuntimeActorIdentity,
        sessionID: ServerConnection.SessionID,
        sendServerRequest: ServerConnection.SendServerRequest
    ) {
        self.actor = actor
        self.sessionID = sessionID
        self.sendServerRequest = sendServerRequest
    }

    func makeRuntime(for state: NativeWorkspaceShellState) -> any NativePaneGridRuntimeControlling {
        NativePaneGridAppRuntimeController(
            actor: actor,
            sessionID: sessionID,
            sendServerRequest: sendServerRequest
        )
    }
}

enum NativePaneGridRuntimeCommand: Sendable, Equatable {
    case focusPane(PaneGrid.FocusPaneCommand)
    case writePaneInput(RequestID, PaneGrid.PaneKernelTarget, Data)
    case resizePane(PaneGrid.ResizePaneAllocationCommand, NativeRuntime.PaneSize)
    case resizePaneToSize(RequestID, PaneGrid.PaneKernelTarget, NativeRuntime.PaneSize)
    case selectWindow(PaneGrid.SelectTabWindowCommand)
}

protocol NativePaneGridRuntimeCommandSending: Sendable {
    func send(_ command: NativePaneGridRuntimeCommand) async throws
}

private final class NativePaneGridRuntimeStateStore: @unchecked Sendable {
    private static let estimatedPixelsPerColumn = 8
    private static let estimatedPixelsPerRow = 18

    private let lock = NSLock()
    private var states: [WorkspaceID: PaneGrid.State] = [:]
    private var serverBackedTargets: Set<ServerBackedPaneTarget> = []

    func save(_ state: PaneGrid.State) {
        lock.lock()
        defer { lock.unlock() }
        states[state.workspaceID] = state
    }

    func markServerBacked(_ state: PaneGrid.State) {
        lock.lock()
        defer { lock.unlock() }
        states[state.workspaceID] = state
        serverBackedTargets = serverBackedTargets.filter { $0.workspaceID != state.workspaceID }
        for window in state.windows {
            for pane in window.panes {
                serverBackedTargets.insert(ServerBackedPaneTarget(
                    workspaceID: state.workspaceID,
                    windowID: window.windowID,
                    tmuxWindowID: window.tmuxWindowID,
                    paneID: pane.paneID,
                    tmuxPaneID: pane.tmuxPaneID
                ))
            }
        }
    }

    func isServerBacked(_ target: PaneGrid.PaneKernelTarget) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return serverBackedTargets.contains(ServerBackedPaneTarget(target))
    }

    func size(
        for paneID: PaneID,
        delta: Int,
        unit: PaneGrid.ResizeUnit,
        direction: PaneGrid.FocusDirection
    ) -> NativeRuntime.PaneSize {
        lock.lock()
        defer { lock.unlock() }
        for state in states.values {
            for pane in state.windows.flatMap(\.panes) where pane.paneID == paneID {
                let columnsDelta = direction == .left || direction == .right
                    ? cellDelta(delta, unit: unit, pixelsPerCell: Self.estimatedPixelsPerColumn)
                    : 0
                let rowsDelta = direction == .up || direction == .down
                    ? cellDelta(delta, unit: unit, pixelsPerCell: Self.estimatedPixelsPerRow)
                    : 0
                return NativePaneGridPaneSizeBounds.clamp(
                    columns: pane.rect.columns + columnsDelta,
                    rows: pane.rect.rows + rowsDelta
                )
            }
        }
        return NativePaneGridPaneSizeBounds.minimum
    }

    private func cellDelta(_ delta: Int, unit: PaneGrid.ResizeUnit, pixelsPerCell: Int) -> Int {
        switch unit {
        case .cells:
            return delta
        case .pixels:
            let magnitude = Int(ceil(Double(abs(delta)) / Double(max(1, pixelsPerCell))))
            return delta < 0 ? -magnitude : magnitude
        }
    }

}

private struct ServerBackedPaneTarget: Hashable {
    let workspaceID: WorkspaceID
    let windowID: FenrirWindowID
    let tmuxWindowID: String
    let paneID: PaneID
    let tmuxPaneID: NativeRuntime.TmuxPaneID

    init(
        workspaceID: WorkspaceID,
        windowID: FenrirWindowID,
        tmuxWindowID: String,
        paneID: PaneID,
        tmuxPaneID: NativeRuntime.TmuxPaneID
    ) {
        self.workspaceID = workspaceID
        self.windowID = windowID
        self.tmuxWindowID = tmuxWindowID
        self.paneID = paneID
        self.tmuxPaneID = tmuxPaneID
    }

    init(_ target: PaneGrid.PaneKernelTarget) {
        self.init(
            workspaceID: target.workspaceID,
            windowID: target.windowID,
            tmuxWindowID: target.tmuxWindowID,
            paneID: target.paneID,
            tmuxPaneID: target.tmuxPaneID
        )
    }
}

private enum NativePaneGridPaneSizeBounds {
    static let minimum = NativeRuntime.PaneSize(columns: 20, rows: 5)
    private static let maximum = NativeRuntime.PaneSize(columns: 1000, rows: 500)

    static func clamp(columns: Int, rows: Int) -> NativeRuntime.PaneSize {
        NativeRuntime.PaneSize(
            columns: min(max(columns, minimum.columns), maximum.columns),
            rows: min(max(rows, minimum.rows), maximum.rows)
        )
    }
}

struct NativePaneGridServerRuntimeCommandPort: NativePaneGridRuntimeCommandSending {
    private let actor: NativeRuntime.RuntimeActorIdentity
    private let sessionID: ServerConnection.SessionID
    private let sendServerRequest: ServerConnection.SendServerRequest

    init(
        actor: NativeRuntime.RuntimeActorIdentity,
        sessionID: ServerConnection.SessionID,
        sendServerRequest: ServerConnection.SendServerRequest
    ) {
        self.actor = actor
        self.sessionID = sessionID
        self.sendServerRequest = sendServerRequest
    }

    func send(_ command: NativePaneGridRuntimeCommand) async throws {
        let request = try request(for: command)
        let envelope = ServerConnection.RequestEnvelope(
            method: request.method,
            payload: String(decoding: request.payload, as: UTF8.self)
        )
        _ = try await sendServerRequest.run(ServerConnection.SendServerRequestInput(
            requestID: request.requestID,
            sessionID: sessionID,
            request: envelope
        )).get()
    }

    private func request(for command: NativePaneGridRuntimeCommand) throws -> NativeRuntime.ServerRPCRequest {
        switch command {
        case .focusPane(let command):
            try encode(
                requestID: command.requestID,
                method: "tmux.pane.focus",
                payload: NativePaneGridPaneFocusRPCInput(
                    actor: actor.rpcActor,
                    workspaceId: command.target.workspaceID.rawValue,
                    paneId: command.target.paneID.rawValue
                )
            )
        case .writePaneInput(let requestID, let target, let bytes):
            try encode(
                requestID: requestID,
                method: "tmux.pane.write",
                payload: NativePaneGridPaneWriteRPCInput(
                    actor: actor.rpcActor,
                    workspaceId: target.workspaceID.rawValue,
                    paneId: target.paneID.rawValue,
                    requestId: requestID.rawValue,
                    data: String(decoding: bytes, as: UTF8.self)
                )
            )
        case .resizePane(let command, let size):
            try encode(
                requestID: command.requestID,
                method: "tmux.pane.resize",
                payload: NativePaneGridPaneResizeRPCInput(
                    actor: actor.rpcActor,
                    workspaceId: command.target.workspaceID.rawValue,
                    paneId: command.target.paneID.rawValue,
                    cols: size.columns,
                    rows: size.rows
                )
            )
        case .resizePaneToSize(let requestID, let target, let size):
            try encode(
                requestID: requestID,
                method: "tmux.pane.resize",
                payload: NativePaneGridPaneResizeRPCInput(
                    actor: actor.rpcActor,
                    workspaceId: target.workspaceID.rawValue,
                    paneId: target.paneID.rawValue,
                    cols: size.columns,
                    rows: size.rows
                )
            )
        case .selectWindow(let command):
            try encode(
                requestID: command.requestID,
                method: "tmux.window.focus",
                payload: NativePaneGridWindowSelectRPCInput(
                    actor: actor.rpcActor,
                    workspaceId: command.workspaceID.rawValue,
                    windowId: command.windowID.rawValue
                )
            )
        }
    }

    private func encode<Payload: Encodable>(
        requestID: RequestID,
        method: String,
        payload: Payload
    ) throws -> NativeRuntime.ServerRPCRequest {
        try NativeRuntime.ServerRPCRequest(
            requestID: requestID,
            method: method,
            payload: JSONEncoder().encode(payload)
        )
    }
}

private struct NativePaneGridRPCActor: Codable, Equatable, Sendable {
    let sessionId: String
    let subject: String
}

private struct NativePaneGridPaneFocusRPCInput: Codable, Equatable, Sendable {
    let actor: NativePaneGridRPCActor
    let workspaceId: String
    let paneId: String
}

private struct NativePaneGridPaneWriteRPCInput: Codable, Equatable, Sendable {
    let actor: NativePaneGridRPCActor
    let workspaceId: String
    let paneId: String
    let requestId: String
    let data: String
}

private struct NativePaneGridPaneResizeRPCInput: Codable, Equatable, Sendable {
    let actor: NativePaneGridRPCActor
    let workspaceId: String
    let paneId: String
    let cols: Int
    let rows: Int
}

private struct NativePaneGridWindowSelectRPCInput: Codable, Equatable, Sendable {
    let actor: NativePaneGridRPCActor
    let workspaceId: String
    let windowId: String
}

private extension NativeRuntime.RuntimeActorIdentity {
    var rpcActor: NativePaneGridRPCActor {
        NativePaneGridRPCActor(sessionId: authSessionID, subject: subject)
    }
}

private actor NativePaneGridKernelBridge: PaneGrid.PaneKernelControlling {
    private let runtime: any NativePaneGridRuntimeControlling

    init(runtime: any NativePaneGridRuntimeControlling) {
        self.runtime = runtime
    }

    func focusPane(_ command: PaneGrid.FocusPaneCommand) async throws {
        try await runtime.focusPane(command)
    }

    func splitPane(_ command: PaneGrid.SplitPaneCommand) async throws -> PaneID {
        throw PaneGrid.PaneGridError.splitFailed
    }

    func closePane(_ command: PaneGrid.ClosePaneCommand) async throws {
        throw PaneGrid.PaneGridError.closeFailed
    }

    func movePane(_ command: PaneGrid.MovePaneCommand) async throws {
        throw PaneGrid.PaneGridError.moveFailed
    }

    func resizePaneAllocation(_ command: PaneGrid.ResizePaneAllocationCommand) async throws {
        try await runtime.resizePaneAllocation(command)
    }

    func resizePane(_ target: PaneGrid.PaneKernelTarget, size: NativeRuntime.PaneSize) async throws {
        try await runtime.resizePane(target, size: size)
    }

    func selectWindow(_ command: PaneGrid.SelectTabWindowCommand) async throws {
        try await runtime.selectWindow(command)
    }
}

private extension PaneGrid.State {
    func resizing(paneID: PaneID, size: NativeRuntime.PaneSize) -> PaneGrid.State {
        PaneGrid.State(
            workspaceID: workspaceID,
            tmuxSessionID: tmuxSessionID,
            activeWindowID: activeWindowID,
            windows: windows.map { window in
                let panes = window.panes.map { pane in
                    guard pane.paneID == paneID else {
                        return pane
                    }
                    return PaneGrid.PanePresentation(
                        paneID: pane.paneID,
                        tmuxPaneID: pane.tmuxPaneID,
                        streamID: pane.streamID,
                        viewportID: pane.viewportID,
                        title: pane.title,
                        rect: PaneGrid.PaneRect(
                            x: pane.rect.x,
                            y: pane.rect.y,
                            columns: size.columns,
                            rows: size.rows
                        ),
                        isFocused: pane.isFocused
                    )
                }
                return PaneGrid.WindowPresentation(
                    windowID: window.windowID,
                    tmuxWindowID: window.tmuxWindowID,
                    index: window.index,
                    title: window.title,
                    root: window.root,
                    activePaneID: window.activePaneID,
                    panes: panes
                )
            },
            generation: generation
        )
    }
}

private struct NativePaneGridClock: PaneGrid.PaneGridClock {
    func now() -> FenrirTimestamp {
        FenrirTimestamp(Date())
    }
}

@MainActor
private final class NativeBootstrapTerminalBackend: FenrirTerminalBackend {
    nonisolated static let allowFallbackEnvironmentVariable = "FENRIR_NATIVE_ALLOW_BOOTSTRAP_TERMINAL"
    nonisolated static var isExplicitlyAllowed: Bool {
        ProcessInfo.processInfo.environment[allowFallbackEnvironmentVariable] == "1"
    }

    let descriptor = TerminalViewport.RendererDescriptor(rendererID: "native-bootstrap-terminal", status: .degraded)
    private let workspaceID: WorkspaceID
    private let themeTokens: NativeShellThemeTokens
    private weak var mountedSurface: NSTextView?

    init(
        workspaceID: WorkspaceID,
        themeTokens: NativeShellThemeTokens = .resolve(Settings.NativeSettingsConfiguration.defaults.appearance.themeID)
    ) {
        self.workspaceID = workspaceID
        self.themeTokens = themeTokens
    }

    func mount(in hostView: NSView) {
        let surface = NSTextView(frame: .zero)
        surface.isEditable = false
        surface.isSelectable = true
        surface.backgroundColor = themeTokens.terminalBackground
        surface.textColor = themeTokens.secondaryText
        surface.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        surface.textContainerInset = NSSize(width: 16, height: 14)
        surface.wantsLayer = true
        surface.string = ""
        surface.translatesAutoresizingMaskIntoConstraints = false
        hostView.addSubview(surface)
        NSLayoutConstraint.activate([
            surface.leadingAnchor.constraint(equalTo: hostView.leadingAnchor),
            surface.trailingAnchor.constraint(equalTo: hostView.trailingAnchor),
            surface.topAnchor.constraint(equalTo: hostView.topAnchor),
            surface.bottomAnchor.constraint(equalTo: hostView.bottomAnchor)
        ])
        mountedSurface = surface
    }

    func unmount() {
        mountedSurface?.removeFromSuperview()
        mountedSurface = nil
    }

    func attach(streamID: StreamID) {
        _ = streamID
    }

    func detach(streamID: StreamID) {
        _ = streamID
    }

    func applyOutput(_ bytes: Data) {
        append(String(decoding: bytes, as: UTF8.self))
    }

    func sendUserInput(_ bytes: Data) {
        append(String(decoding: bytes, as: UTF8.self))
    }

    func resize(_ size: TerminalViewport.Size) {
        _ = size
    }

    func setFocused(_ focused: Bool) {
        mountedSurface?.layer?.borderWidth = focused ? 1 : 0
        mountedSurface?.layer?.borderColor = NSColor.keyboardFocusIndicatorColor.cgColor
    }

    func captureSelection() -> TerminalViewport.CapturedTextBuffer {
        guard let mountedSurface else {
            return TerminalViewport.CapturedTextBuffer(text: "")
        }
        let selectedRange = mountedSurface.selectedRange()
        guard selectedRange.length > 0,
              NSMaxRange(selectedRange) <= (mountedSurface.string as NSString).length
        else {
            return TerminalViewport.CapturedTextBuffer(text: "")
        }
        return TerminalViewport.CapturedTextBuffer(text: (mountedSurface.string as NSString).substring(with: selectedRange))
    }

    func captureViewport() -> TerminalViewport.CapturedTextBuffer {
        TerminalViewport.CapturedTextBuffer(text: mountedSurface?.string ?? "")
    }

    func captureLastLines(maxLines: Int?) -> TerminalViewport.CapturedTextBuffer {
        let lines = (mountedSurface?.string ?? "").split(separator: "\n", omittingEmptySubsequences: false)
        let selected = maxLines.map { lines.suffix(max(0, $0)) } ?? lines[...]
        return TerminalViewport.CapturedTextBuffer(text: selected.joined(separator: "\n"))
    }

    private func append(_ text: String) {
        guard let mountedSurface else {
            return
        }
        mountedSurface.string += text
        mountedSurface.scrollToEndOfDocument(nil)
    }
}

final class NativeTerminalViewRendererWriter: TerminalViewport.TerminalRendererWriting, @unchecked Sendable {
    private let terminalView: FenrirTerminalView

    @MainActor
    init(terminalView: FenrirTerminalView) {
        self.terminalView = terminalView
    }

    func ingestOutput(viewportID: ViewportID, bytes: Data) async throws {
        _ = viewportID
        await MainActor.run {
            terminalView.applyRuntimeOutput(bytes)
        }
    }
}

enum NativeOverlayKeyboardInput: Equatable, Sendable {
    case escape
    case moveUp
    case moveDown
    case controlP
    case controlN
    case submit
    case deleteBackward
    case insertText(String)
}

@MainActor
final class NativeOverlayHostView: NSView {
    let themeTokens: NativeShellThemeTokens
    var onDismissCommandPalette: (() -> Void)?
    var onCloseOverlay: ((WorkspaceOverlays.OverlayID) -> Void)?
    var onExecutePaletteItem: ((WorkspaceOverlays.PaletteItem) -> Void)?
    var onSubmitAgentComposer: ((AgentInteraction.SubmitComposerDraftCommand) -> Void)?
    var onCancelAgentComposer: ((AgentInteraction.CancelAgentComposerInput) -> Void)?
    var onWorkflowCommand: ((WorkflowControl.WorkflowViewCommand) -> Void)?
    var onAgentIntegrationCommand: ((AgentIntegration.AgentIntegrationViewCommand) -> Void)?
    var onSelectNotification: ((Notifications.NotificationID, PaneID?) -> Void)?
    var onMarkAllNotificationsRead: (() -> Void)?
    var onJumpToLatestUnread: (() -> Void)?
    /// D-042: option button on an approval card (requestID, optionID).
    var onDecideApproval: ((String, String) -> Void)?
    var onAddScript: ((String, String) -> Void)?
    var onRemoveScript: ((Settings.ScriptID) -> Void)?

    private let dimmingView = NSView()
    private let contentContainer = NSView()
    private let palettePanel = NSView()
    private let paletteTitle = NSTextField(labelWithString: "Command Palette")
    private let paletteQuery = NSTextField(labelWithString: "")
    private let paletteHint = NSTextField(labelWithString: "")
    private let paletteRows = NSStackView()
    private let overlayPanel = NSView()
    private let overlayTitle = NSTextField(labelWithString: "")
    private let overlaySubtitle = NSTextField(labelWithString: "")
    private let overlayRows = NSStackView()

    private var focusedSurface: NativeWorkspaceFocusSurface = .terminal(nil)
    private var activeOverlayIDs: [WorkspaceOverlays.OverlayID] = []
    private var allPaletteItems: [WorkspaceOverlays.PaletteItem] = []
    private var filteredPaletteItems: [WorkspaceOverlays.PaletteItem] = []
    private var agentComposer: AgentInteraction.ComposerState?
    private var agentComposerError: AgentInteraction.AgentInteractionError?
    private var agentComposerView: AgentInteraction.AgentComposerModalView?
    private var workflowRuns: [WorkflowControl.WorkflowRunSnapshot] = []
    private var workflowTimeline: WorkflowControl.WorkflowRunTimeline?
    private var workflowError: WorkflowControl.WorkflowControlError?
    private var workflowView: WorkflowControl.WorkflowControlView?
    private var agentIntegrationState: AgentIntegration.AgentIntegrationPanelState?
    private var agentIntegrationView: AgentIntegration.AgentIntegrationPanelView?
    private var notificationsFeed: [Notifications.WorkspaceNotification] = []
    private var notificationsUnreadCount = 0
    private var notificationsPanelView: NativeNotificationsPanelView?
    private var approvalFeedCards: [Notifications.ApprovalFeedCard] = []
    private var approvalsPanelView: NativeApprovalFeedPanelView?
    private var manageableScripts: [Settings.ScriptDefinition] = []
    private var manageScriptsView: NativeManageScriptsPanelView?
    private var diagnosticsViewModel = Diagnostics.DiagnosticsOverlayViewModel(report: Diagnostics.DiagnosticsReport(
        generatedAt: FenrirTimestamp(Date(timeIntervalSince1970: 0)),
        policy: .defaults,
        events: [],
        categoryCounts: [:],
        redactionNotice: "Sensitive metadata and terminal content are redacted."
    ))
    private var selectedPaletteIndex = 0
    private var queryText = ""

    static let notificationsOverlayID: WorkspaceOverlays.OverlayID = "notifications"
    static let approvalsOverlayID: WorkspaceOverlays.OverlayID = "approvals"
    static let manageScriptsOverlayID: WorkspaceOverlays.OverlayID = "manage-scripts"

    init(
        themeTokens: NativeShellThemeTokens = .resolve(Settings.NativeSettingsConfiguration.defaults.appearance.themeID),
        frame frameRect: NSRect = .zero
    ) {
        self.themeTokens = themeTokens
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = themeTokens.transparent.cgColor
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override var acceptsFirstResponder: Bool { true }

    var isCapturingKeyboard: Bool {
        guard !isHidden else {
            return false
        }
        switch focusedSurface {
        case .commandPalette, .overlay:
            return true
        case .terminal, .sidebar:
            return false
        }
    }

    func apply(
        focusedSurface: NativeWorkspaceFocusSurface,
        activeOverlayIDs: [WorkspaceOverlays.OverlayID],
        paletteItems: [WorkspaceOverlays.PaletteItem],
        agentComposer: AgentInteraction.ComposerState? = nil,
        workflowRuns: [WorkflowControl.WorkflowRunSnapshot] = [],
        workflowTimeline: WorkflowControl.WorkflowRunTimeline? = nil,
        workflowError: WorkflowControl.WorkflowControlError? = nil,
        diagnosticsViewModel: Diagnostics.DiagnosticsOverlayViewModel? = nil,
        agentIntegrationState: AgentIntegration.AgentIntegrationPanelState? = nil
    ) {
        self.focusedSurface = focusedSurface
        self.activeOverlayIDs = activeOverlayIDs
        if let agentComposer {
            self.agentComposer = agentComposer
        }
        self.workflowRuns = workflowRuns
        self.workflowTimeline = workflowTimeline
        self.workflowError = workflowError
        if let diagnosticsViewModel {
            self.diagnosticsViewModel = diagnosticsViewModel
        }
        if let agentIntegrationState {
            self.agentIntegrationState = agentIntegrationState
        }
        allPaletteItems = paletteItems.sorted { lhs, rhs in
            if lhs.baseScore == rhs.baseScore {
                return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
            }
            return lhs.baseScore > rhs.baseScore
        }
        isHidden = activeOverlayIDs.isEmpty && focusedSurface != .commandPalette
        updateFilteredPaletteItems()
        render()
    }

    func updateDiagnostics(_ viewModel: Diagnostics.DiagnosticsOverlayViewModel) {
        diagnosticsViewModel = viewModel
        render()
    }

    func updateAgentComposer(_ composer: AgentInteraction.ComposerState, error: AgentInteraction.AgentInteractionError? = nil) {
        agentComposer = composer
        agentComposerError = error
        agentComposerView?.updateComposer(composer, error: error)
        render()
    }

    func updateWorkflow(
        runs: [WorkflowControl.WorkflowRunSnapshot],
        timeline: WorkflowControl.WorkflowRunTimeline?,
        error: WorkflowControl.WorkflowControlError?
    ) {
        workflowRuns = runs
        workflowTimeline = timeline
        workflowError = error
        if let workflowView {
            workflowView.applyRuns(runs)
            if let timeline {
                workflowView.applyTimeline(timeline)
            }
            if let error {
                workflowView.applyError(error)
            }
        }
        render()
    }

    func updateAgentIntegration(_ state: AgentIntegration.AgentIntegrationPanelState) {
        agentIntegrationState = state
        agentIntegrationView?.apply(state)
        render()
    }

    func updateNotificationsPanel(feed: [Notifications.WorkspaceNotification], unreadCount: Int) {
        notificationsFeed = feed
        notificationsUnreadCount = unreadCount
        notificationsPanelView?.apply(feed: feed, unreadCount: unreadCount)
        render()
    }

    func updateApprovalsPanel(cards: [Notifications.ApprovalFeedCard]) {
        approvalFeedCards = cards
        approvalsPanelView?.apply(cards: cards)
        render()
    }

    func updateManageScripts(_ scripts: [Settings.ScriptDefinition]) {
        manageableScripts = scripts
        manageScriptsView?.apply(scripts: scripts)
        render()
    }

    func setPaletteQuery(_ query: String) {
        queryText = query
        selectedPaletteIndex = 0
        updateFilteredPaletteItems()
        render()
    }

    @discardableResult
    func handleKeyboard(_ input: NativeOverlayKeyboardInput) -> Bool {
        guard isCapturingKeyboard else {
            return false
        }

        switch input {
        case .escape:
            dismissFocusedOverlay()
            return true
        case .moveUp, .controlP:
            moveSelection(delta: -1)
            return true
        case .moveDown, .controlN:
            moveSelection(delta: 1)
            return true
        case .submit:
            submitSelection()
            return true
        case .deleteBackward:
            guard !queryText.isEmpty, focusedSurface == .commandPalette else {
                return true
            }
            queryText.removeLast()
            updateFilteredPaletteItems()
            renderPalette()
            return true
        case .insertText(let text):
            guard focusedSurface == .commandPalette else {
                return true
            }
            queryText += text
            updateFilteredPaletteItems()
            renderPalette()
            return true
        }
    }

    override func keyDown(with event: NSEvent) {
        if let input = NativeOverlayKeyboardInput(event: event), handleKeyboard(input) {
            return
        }
        super.keyDown(with: event)
    }

    func visibleOverlayTitles() -> [String] {
        if focusedSurface == .commandPalette {
            return ["Command Palette"]
        }
        return activeOverlayIDs.map { title(for: $0) }
    }

    func selectedPaletteItemID() -> String? {
        guard filteredPaletteItems.indices.contains(selectedPaletteIndex) else {
            return nil
        }
        return filteredPaletteItems[selectedPaletteIndex].id
    }

    func visibleAgentComposerView() -> AgentInteraction.AgentComposerModalView? {
        agentComposerView
    }

    func visibleWorkflowView() -> WorkflowControl.WorkflowControlView? {
        workflowView
    }

    private func build() {
        [dimmingView, contentContainer].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }
        dimmingView.wantsLayer = true
        dimmingView.layer?.backgroundColor = themeTokens.overlayScrim.cgColor

        [palettePanel, overlayPanel].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            contentContainer.addSubview($0)
            $0.wantsLayer = true
            $0.layer?.cornerRadius = 10
            $0.layer?.backgroundColor = themeTokens.overlayBackground.cgColor
            $0.layer?.borderColor = themeTokens.overlayBorder.cgColor
            $0.layer?.borderWidth = 1
            $0.shadow = NSShadow()
            $0.layer?.shadowColor = NSColor.black.cgColor
            $0.layer?.shadowOpacity = 0.6
            $0.layer?.shadowRadius = 30
            $0.layer?.shadowOffset = CGSize(width: 0, height: -12)
        }

        buildPalettePanel()
        buildOverlayPanel()

        let paletteMinimumWidth = palettePanel.widthAnchor.constraint(greaterThanOrEqualToConstant: 300)
        paletteMinimumWidth.priority = .defaultHigh
        let overlayMinimumWidth = overlayPanel.widthAnchor.constraint(greaterThanOrEqualToConstant: 300)
        overlayMinimumWidth.priority = .defaultHigh

        NSLayoutConstraint.activate([
            dimmingView.leadingAnchor.constraint(equalTo: leadingAnchor),
            dimmingView.trailingAnchor.constraint(equalTo: trailingAnchor),
            dimmingView.topAnchor.constraint(equalTo: topAnchor),
            dimmingView.bottomAnchor.constraint(equalTo: bottomAnchor),

            contentContainer.leadingAnchor.constraint(equalTo: leadingAnchor),
            contentContainer.trailingAnchor.constraint(equalTo: trailingAnchor),
            contentContainer.topAnchor.constraint(equalTo: topAnchor),
            contentContainer.bottomAnchor.constraint(equalTo: bottomAnchor),

            palettePanel.topAnchor.constraint(equalTo: contentContainer.topAnchor, constant: 48),
            palettePanel.centerXAnchor.constraint(equalTo: contentContainer.centerXAnchor),
            palettePanel.widthAnchor.constraint(lessThanOrEqualToConstant: 620),
            palettePanel.widthAnchor.constraint(lessThanOrEqualTo: contentContainer.widthAnchor, constant: -32),
            paletteMinimumWidth,

            overlayPanel.centerXAnchor.constraint(equalTo: contentContainer.centerXAnchor),
            overlayPanel.centerYAnchor.constraint(equalTo: contentContainer.centerYAnchor, constant: -24),
            overlayPanel.widthAnchor.constraint(lessThanOrEqualToConstant: 620),
            overlayPanel.widthAnchor.constraint(lessThanOrEqualTo: contentContainer.widthAnchor, constant: -32),
            overlayMinimumWidth
        ])
    }

    private func buildPalettePanel() {
        paletteTitle.isHidden = true
        paletteQuery.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        paletteQuery.textColor = themeTokens.secondaryText
        paletteQuery.lineBreakMode = .byTruncatingTail

        paletteHint.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
        paletteHint.lineBreakMode = .byTruncatingTail
        paletteHint.attributedStringValue = Self.domainHint(themeTokens: themeTokens)

        let queryDivider = NSView()
        queryDivider.wantsLayer = true
        queryDivider.layer?.backgroundColor = themeTokens.hairline.cgColor

        let hintDivider = NSView()
        hintDivider.wantsLayer = true
        hintDivider.layer?.backgroundColor = themeTokens.hairline.cgColor

        paletteRows.orientation = .vertical
        paletteRows.spacing = 2
        paletteRows.alignment = .leading

        [paletteTitle, paletteQuery, queryDivider, paletteHint, hintDivider, paletteRows].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            palettePanel.addSubview($0)
        }

        NSLayoutConstraint.activate([
            paletteQuery.leadingAnchor.constraint(equalTo: palettePanel.leadingAnchor, constant: 18),
            paletteQuery.trailingAnchor.constraint(equalTo: palettePanel.trailingAnchor, constant: -18),
            paletteQuery.topAnchor.constraint(equalTo: palettePanel.topAnchor, constant: 12),
            paletteQuery.heightAnchor.constraint(equalToConstant: 24),

            queryDivider.leadingAnchor.constraint(equalTo: palettePanel.leadingAnchor),
            queryDivider.trailingAnchor.constraint(equalTo: palettePanel.trailingAnchor),
            queryDivider.topAnchor.constraint(equalTo: paletteQuery.bottomAnchor, constant: 10),
            queryDivider.heightAnchor.constraint(equalToConstant: 1),

            paletteHint.leadingAnchor.constraint(equalTo: palettePanel.leadingAnchor, constant: 18),
            paletteHint.trailingAnchor.constraint(lessThanOrEqualTo: palettePanel.trailingAnchor, constant: -18),
            paletteHint.topAnchor.constraint(equalTo: queryDivider.bottomAnchor, constant: 7),

            hintDivider.leadingAnchor.constraint(equalTo: palettePanel.leadingAnchor),
            hintDivider.trailingAnchor.constraint(equalTo: palettePanel.trailingAnchor),
            hintDivider.topAnchor.constraint(equalTo: paletteHint.bottomAnchor, constant: 7),
            hintDivider.heightAnchor.constraint(equalToConstant: 1),

            paletteRows.leadingAnchor.constraint(equalTo: palettePanel.leadingAnchor, constant: 8),
            paletteRows.trailingAnchor.constraint(equalTo: palettePanel.trailingAnchor, constant: -8),
            paletteRows.topAnchor.constraint(equalTo: hintDivider.bottomAnchor, constant: 8),
            paletteRows.bottomAnchor.constraint(equalTo: palettePanel.bottomAnchor, constant: -8)
        ])
    }

    private static func domainHint(themeTokens: NativeShellThemeTokens) -> NSAttributedString {
        let dim: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular),
            .foregroundColor: themeTokens.tertiaryText
        ]
        let accent: [NSAttributedString.Key: Any] = [
            .font: NSFont.monospacedSystemFont(ofSize: 10.5, weight: .medium),
            .foregroundColor: themeTokens.accent
        ]
        let hint = NSMutableAttributedString(string: "workspaces · ", attributes: dim)
        for (prefix, label) in [("@", " actions · "), ("$", " files · "), ("%", " panes · "), ("!", " attention · "), ("?", " help")] {
            hint.append(NSAttributedString(string: prefix, attributes: accent))
            hint.append(NSAttributedString(string: label, attributes: dim))
        }
        return hint
    }

    private func buildOverlayPanel() {
        overlayTitle.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .semibold)
        overlayTitle.textColor = themeTokens.primaryText
        overlaySubtitle.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        overlaySubtitle.textColor = themeTokens.secondaryText
        overlaySubtitle.lineBreakMode = .byTruncatingTail
        overlayRows.orientation = .vertical
        overlayRows.spacing = 6
        overlayRows.alignment = .leading

        [overlayTitle, overlaySubtitle, overlayRows].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            overlayPanel.addSubview($0)
        }

        NSLayoutConstraint.activate([
            overlayTitle.leadingAnchor.constraint(equalTo: overlayPanel.leadingAnchor, constant: 14),
            overlayTitle.trailingAnchor.constraint(equalTo: overlayPanel.trailingAnchor, constant: -14),
            overlayTitle.topAnchor.constraint(equalTo: overlayPanel.topAnchor, constant: 14),

            overlaySubtitle.leadingAnchor.constraint(equalTo: overlayTitle.leadingAnchor),
            overlaySubtitle.trailingAnchor.constraint(equalTo: overlayTitle.trailingAnchor),
            overlaySubtitle.topAnchor.constraint(equalTo: overlayTitle.bottomAnchor, constant: 4),

            overlayRows.leadingAnchor.constraint(equalTo: overlayPanel.leadingAnchor, constant: 14),
            overlayRows.trailingAnchor.constraint(equalTo: overlayPanel.trailingAnchor, constant: -14),
            overlayRows.topAnchor.constraint(equalTo: overlaySubtitle.bottomAnchor, constant: 14),
            overlayRows.bottomAnchor.constraint(equalTo: overlayPanel.bottomAnchor, constant: -14)
        ])
    }

    private func render() {
        palettePanel.isHidden = focusedSurface != .commandPalette
        overlayPanel.isHidden = activeOverlayIDs.isEmpty || focusedSurface == .commandPalette
        if focusedSurface == .commandPalette {
            renderPalette()
        } else {
            renderOverlayPanel()
        }
    }

    private func renderPalette() {
        let prompt = NSMutableAttributedString(
            string: "❯ ",
            attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 13, weight: .regular),
                .foregroundColor: themeTokens.accent
            ]
        )
        prompt.append(NSAttributedString(
            string: queryText.isEmpty ? "Type command, workspace, or prefix" : queryText,
            attributes: [
                .font: NSFont.monospacedSystemFont(ofSize: 13, weight: .regular),
                .foregroundColor: queryText.isEmpty ? themeTokens.tertiaryText : themeTokens.primaryText
            ]
        ))
        paletteQuery.attributedStringValue = prompt
        clearArrangedSubviews(from: paletteRows)

        let visibleItems = Array(filteredPaletteItems.prefix(7))
        if visibleItems.isEmpty {
            paletteRows.addArrangedSubview(NativeOverlayStatusRowView(text: "No matching commands", themeTokens: themeTokens))
            return
        }

        for (index, item) in visibleItems.enumerated() {
            let row = NativeOverlayPaletteRowView(item: item, isSelected: index == selectedPaletteIndex, themeTokens: themeTokens)
            paletteRows.addArrangedSubview(row)
            row.widthAnchor.constraint(equalTo: paletteRows.widthAnchor).isActive = true
        }
    }

    private func renderOverlayPanel() {
        guard let overlayID = focusedOverlayID() ?? activeOverlayIDs.last else {
            return
        }
        if overlayID == NativeAgentComposerOverlay.overlayID {
            renderAgentComposerPanel()
            return
        }
        if overlayID == NativeWorkflowOverlay.overlayID {
            renderWorkflowPanel()
            return
        }
        if overlayID == NativeAgentIntegrationOverlay.overlayID {
            renderAgentIntegrationPanel()
            return
        }
        if overlayID == Self.notificationsOverlayID {
            renderNotificationsPanel()
            return
        }
        if overlayID == Self.approvalsOverlayID {
            renderApprovalsPanel()
            return
        }
        if overlayID == Self.manageScriptsOverlayID {
            renderManageScriptsPanel()
            return
        }
        agentComposerView = nil
        workflowView = nil
        agentIntegrationView = nil
        notificationsPanelView = nil
        approvalsPanelView = nil
        manageScriptsView = nil
        if isDiagnosticsOverlay(overlayID) {
            overlayTitle.stringValue = diagnosticsViewModel.title
            overlaySubtitle.stringValue = diagnosticsViewModel.subtitle
        } else {
            overlayTitle.stringValue = title(for: overlayID)
            overlaySubtitle.stringValue = subtitle(for: overlayID)
        }
        clearArrangedSubviews(from: overlayRows)
        for text in rows(for: overlayID) {
            let row = NativeOverlayStatusRowView(text: text, themeTokens: themeTokens)
            overlayRows.addArrangedSubview(row)
            row.widthAnchor.constraint(equalTo: overlayRows.widthAnchor).isActive = true
        }
    }

    private func renderAgentComposerPanel() {
        overlayTitle.stringValue = "Agent Composer"
        overlaySubtitle.stringValue = "Context summary only; terminal content is kept out of overlay diagnostics"
        clearArrangedSubviews(from: overlayRows)
        workflowView = nil
        agentIntegrationView = nil

        guard let agentComposer else {
            let row = NativeOverlayStatusRowView(text: "Preparing terminal context", themeTokens: themeTokens)
            overlayRows.addArrangedSubview(row)
            row.widthAnchor.constraint(equalTo: overlayRows.widthAnchor).isActive = true
            agentComposerView = nil
            return
        }

        let composerView = AgentInteraction.AgentComposerModalView(composer: agentComposer)
        composerView.updateComposer(agentComposer, error: agentComposerError)
        composerView.onSubmitDraft = { [weak self] command in self?.onSubmitAgentComposer?(command) }
        composerView.onCancel = { [weak self] input in self?.onCancelAgentComposer?(input) }
        agentComposerView = composerView
        overlayRows.addArrangedSubview(composerView)
        composerView.widthAnchor.constraint(equalTo: overlayRows.widthAnchor).isActive = true
        composerView.heightAnchor.constraint(greaterThanOrEqualToConstant: 240).isActive = true
    }

    private func renderWorkflowPanel() {
        overlayTitle.stringValue = "Workflows"
        overlaySubtitle.stringValue = "Server-owned runs, timeline replay, agents, tasks, and input"
        clearArrangedSubviews(from: overlayRows)
        agentComposerView = nil
        agentIntegrationView = nil

        let view = WorkflowControl.WorkflowControlView(
            runs: workflowRuns,
            selectedRunID: workflowTimeline?.runID,
            timeline: workflowTimeline
        )
        if let workflowError {
            view.applyError(workflowError)
        }
        view.onCommand = { [weak self] command in self?.onWorkflowCommand?(command) }
        workflowView = view
        overlayRows.addArrangedSubview(view)
        view.widthAnchor.constraint(equalTo: overlayRows.widthAnchor).isActive = true
        view.heightAnchor.constraint(greaterThanOrEqualToConstant: 420).isActive = true
    }

    private func renderAgentIntegrationPanel() {
        overlayTitle.stringValue = "Agent Integrations"
        overlaySubtitle.stringValue = "Repair or remove detected agent CLI integrations"
        clearArrangedSubviews(from: overlayRows)
        agentComposerView = nil
        workflowView = nil

        guard let agentIntegrationState else {
            let row = NativeOverlayStatusRowView(text: "Checking agent integrations", themeTokens: themeTokens)
            overlayRows.addArrangedSubview(row)
            row.widthAnchor.constraint(equalTo: overlayRows.widthAnchor).isActive = true
            agentIntegrationView = nil
            return
        }

        let view = AgentIntegration.AgentIntegrationPanelView(state: agentIntegrationState)
        view.onCommand = { [weak self] command in self?.onAgentIntegrationCommand?(command) }
        agentIntegrationView = view
        overlayRows.addArrangedSubview(view)
        view.widthAnchor.constraint(equalTo: overlayRows.widthAnchor).isActive = true
        view.heightAnchor.constraint(greaterThanOrEqualToConstant: 240).isActive = true
    }

    private func renderNotificationsPanel() {
        overlayTitle.stringValue = "Notifications"
        overlaySubtitle.stringValue = "Workspace attention feed · row click focuses the pane"
        clearArrangedSubviews(from: overlayRows)
        agentComposerView = nil
        workflowView = nil
        agentIntegrationView = nil
        approvalsPanelView = nil
        manageScriptsView = nil

        let view = NativeNotificationsPanelView(
            feed: notificationsFeed,
            unreadCount: notificationsUnreadCount,
            themeTokens: themeTokens
        )
        view.onSelectNotification = { [weak self] notificationID, paneID in
            self?.onSelectNotification?(notificationID, paneID)
        }
        view.onMarkAllRead = { [weak self] in self?.onMarkAllNotificationsRead?() }
        view.onJumpToLatestUnread = { [weak self] in self?.onJumpToLatestUnread?() }
        notificationsPanelView = view
        overlayRows.addArrangedSubview(view)
        view.widthAnchor.constraint(equalTo: overlayRows.widthAnchor).isActive = true
    }

    private func renderApprovalsPanel() {
        overlayTitle.stringValue = "Approvals"
        overlaySubtitle.stringValue = "Pending agent requests · buttons decide via the server relay"
        clearArrangedSubviews(from: overlayRows)
        agentComposerView = nil
        workflowView = nil
        agentIntegrationView = nil
        notificationsPanelView = nil
        manageScriptsView = nil

        let view = NativeApprovalFeedPanelView(cards: approvalFeedCards, themeTokens: themeTokens)
        view.onDecideApproval = { [weak self] requestID, optionID in
            self?.onDecideApproval?(requestID, optionID)
        }
        approvalsPanelView = view
        overlayRows.addArrangedSubview(view)
        view.widthAnchor.constraint(equalTo: overlayRows.widthAnchor).isActive = true
    }

    private func renderManageScriptsPanel() {
        overlayTitle.stringValue = "Manage Scripts"
        overlaySubtitle.stringValue = "Scripts run as server-owned tmux panes (repository scope)"
        clearArrangedSubviews(from: overlayRows)
        agentComposerView = nil
        workflowView = nil
        agentIntegrationView = nil
        notificationsPanelView = nil
        approvalsPanelView = nil

        let view = NativeManageScriptsPanelView(scripts: manageableScripts, themeTokens: themeTokens)
        view.onAddScript = { [weak self] name, command in self?.onAddScript?(name, command) }
        view.onRemoveScript = { [weak self] scriptID in self?.onRemoveScript?(scriptID) }
        manageScriptsView = view
        overlayRows.addArrangedSubview(view)
        view.widthAnchor.constraint(equalTo: overlayRows.widthAnchor).isActive = true
    }

    private func updateFilteredPaletteItems() {
        let trimmed = queryText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            filteredPaletteItems = allPaletteItems
        } else {
            let needle = trimmed.lowercased()
            filteredPaletteItems = allPaletteItems.filter { item in
                ([item.title, item.subtitle ?? ""] + item.keywords)
                    .contains { $0.lowercased().contains(needle) }
            }
        }
        selectedPaletteIndex = min(selectedPaletteIndex, max(0, filteredPaletteItems.prefix(7).count - 1))
    }

    private func moveSelection(delta: Int) {
        guard focusedSurface == .commandPalette else {
            return
        }
        let count = filteredPaletteItems.prefix(7).count
        guard count > 0 else {
            selectedPaletteIndex = 0
            return
        }
        selectedPaletteIndex = (selectedPaletteIndex + delta + count) % count
        renderPalette()
    }

    private func submitSelection() {
        guard focusedSurface == .commandPalette,
              filteredPaletteItems.indices.contains(selectedPaletteIndex)
        else {
            return
        }
        onExecutePaletteItem?(filteredPaletteItems[selectedPaletteIndex])
    }

    private func dismissFocusedOverlay() {
        switch focusedSurface {
        case .commandPalette:
            onDismissCommandPalette?()
        case .overlay(let overlayID):
            onCloseOverlay?(overlayID)
        case .terminal, .sidebar:
            break
        }
    }

    private func focusedOverlayID() -> WorkspaceOverlays.OverlayID? {
        if case let .overlay(overlayID) = focusedSurface {
            return overlayID
        }
        return nil
    }

    private func title(for overlayID: WorkspaceOverlays.OverlayID) -> String {
        let raw = overlayID.rawValue.lowercased()
        if overlayID == NativeAgentComposerOverlay.overlayID {
            return "Agent Composer"
        }
        if overlayID == NativeWorkflowOverlay.overlayID {
            return "Workflows"
        }
        if overlayID == NativeAgentIntegrationOverlay.overlayID {
            return "Agent Integrations"
        }
        if overlayID == Self.notificationsOverlayID {
            return "Notifications"
        }
        if overlayID == Self.approvalsOverlayID {
            return "Approvals"
        }
        if overlayID == Self.manageScriptsOverlayID {
            return "Manage Scripts"
        }
        if raw.contains("diagnostic") {
            return "Diagnostics"
        }
        if raw.contains("help") {
            return "Keyboard Help"
        }
        if raw.contains("modal") {
            return "Modal"
        }
        return overlayID.rawValue
    }

    private func subtitle(for overlayID: WorkspaceOverlays.OverlayID) -> String {
        let raw = overlayID.rawValue.lowercased()
        if overlayID == NativeAgentComposerOverlay.overlayID {
            return "Context summary only; terminal content is kept out of overlay diagnostics"
        }
        if overlayID == NativeWorkflowOverlay.overlayID {
            return "Server-owned workflow visualization and control"
        }
        if overlayID == NativeAgentIntegrationOverlay.overlayID {
            return "Settings, repair, and removal for provider CLI integrations"
        }
        if raw.contains("diagnostic") {
            return "Native client health and tmux integration"
        }
        if raw.contains("help") {
            return "tmux-style navigation for native overlays"
        }
        return "Press Escape to close"
    }

    private func rows(for overlayID: WorkspaceOverlays.OverlayID) -> [String] {
        let raw = overlayID.rawValue.lowercased()
        if isDiagnosticsOverlay(overlayID) {
            return diagnosticsViewModel.rows
        }
        if raw.contains("help") {
            return [
                "Up/Down or Ctrl-P/Ctrl-N moves selection",
                "Return executes the selected command",
                "Escape closes the active overlay"
            ]
        }
        return ["Overlay \(overlayID.rawValue)", "Press Escape to return to the previous focus surface"]
    }

    private func isDiagnosticsOverlay(_ overlayID: WorkspaceOverlays.OverlayID) -> Bool {
        overlayID.rawValue.lowercased().contains("diagnostic")
    }

    private func clearArrangedSubviews(from stack: NSStackView) {
        stack.arrangedSubviews.forEach {
            stack.removeArrangedSubview($0)
            $0.removeFromSuperview()
        }
    }
}

private extension NativeOverlayKeyboardInput {
    init?(event: NSEvent) {
        if event.modifierFlags.contains(.control) {
            switch event.charactersIgnoringModifiers?.lowercased() {
            case "p":
                self = .controlP
                return
            case "n":
                self = .controlN
                return
            default:
                break
            }
        }

        switch event.keyCode {
        case 53:
            self = .escape
        case 126:
            self = .moveUp
        case 125:
            self = .moveDown
        case 36, 76:
            self = .submit
        case 51:
            self = .deleteBackward
        default:
            guard let characters = event.characters, !characters.isEmpty else {
                return nil
            }
            self = .insertText(characters)
        }
    }
}

@MainActor
private final class NativeOverlayPaletteRowView: NSView {
    private let themeTokens: NativeShellThemeTokens

    init(item: WorkspaceOverlays.PaletteItem, isSelected: Bool, themeTokens: NativeShellThemeTokens) {
        self.themeTokens = themeTokens
        super.init(frame: .zero)
        build(item: item, isSelected: isSelected)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    private func build(item: WorkspaceOverlays.PaletteItem, isSelected: Bool) {
        wantsLayer = true
        layer?.cornerRadius = 6
        layer?.backgroundColor = isSelected
            ? themeTokens.selectedRowBackground.cgColor
            : themeTokens.transparent.cgColor

        let title = NSTextField(labelWithString: item.title)
        title.font = NSFont.monospacedSystemFont(ofSize: 12.5, weight: .medium)
        title.textColor = isSelected ? themeTokens.selectedRowText : themeTokens.primaryText
        title.lineBreakMode = .byTruncatingTail

        let subtitle = NSTextField(labelWithString: item.subtitle ?? item.domain.rawValue)
        subtitle.font = NSFont.monospacedSystemFont(ofSize: 10.5, weight: .regular)
        subtitle.textColor = isSelected ? themeTokens.secondaryText : themeTokens.tertiaryText
        subtitle.lineBreakMode = .byTruncatingTail

        let domain = NSTextField(labelWithString: item.domain.rawValue)
        domain.font = NSFont.monospacedSystemFont(ofSize: 10, weight: .semibold)
        domain.textColor = isSelected ? themeTokens.accent : themeTokens.tertiaryText
        domain.alignment = .right
        domain.lineBreakMode = .byTruncatingTail

        [title, subtitle, domain].forEach {
            $0.translatesAutoresizingMaskIntoConstraints = false
            addSubview($0)
        }

        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 44),
            title.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            title.trailingAnchor.constraint(lessThanOrEqualTo: domain.leadingAnchor, constant: -12),
            title.topAnchor.constraint(equalTo: topAnchor, constant: 7),

            subtitle.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            subtitle.trailingAnchor.constraint(lessThanOrEqualTo: domain.leadingAnchor, constant: -12),
            subtitle.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 2),

            domain.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -10),
            domain.centerYAnchor.constraint(equalTo: centerYAnchor),
            domain.widthAnchor.constraint(lessThanOrEqualToConstant: 96)
        ])
    }
}

@MainActor
private final class NativeOverlayStatusRowView: NSView {
    private let themeTokens: NativeShellThemeTokens

    init(text: String, themeTokens: NativeShellThemeTokens) {
        self.themeTokens = themeTokens
        super.init(frame: .zero)
        build(text: text)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    private func build(text: String) {
        let label = NSTextField(labelWithString: text)
        label.font = NSFont.systemFont(ofSize: 12, weight: .regular)
        label.textColor = themeTokens.primaryText
        label.lineBreakMode = .byTruncatingTail
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)

        NSLayoutConstraint.activate([
            heightAnchor.constraint(equalToConstant: 24),
            label.leadingAnchor.constraint(equalTo: leadingAnchor),
            label.trailingAnchor.constraint(equalTo: trailingAnchor),
            label.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
    }
}
