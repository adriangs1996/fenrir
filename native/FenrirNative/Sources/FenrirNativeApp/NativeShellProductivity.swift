import AgentIntegration
import AppKit
import FenrirNativeShared
import NativeRuntime
import Notifications
import PaneGrid
import ServerConnection
import Settings
import UserNotifications
import WorkspaceIndex

// D-045 shell productivity wiring: run-script preferences persistence,
// server-owned script panes (D-019 — scripts are real tmux panes, never
// app-local child processes), open-in-editor composition over the
// WorkspaceIndex target catalogue, and the D-043 notification ingest hub.

// MARK: - Script/editor preferences persistence

/// Persisted D-045 productivity preferences. `Settings` owns the models
/// (`ScriptPreferences`, `EditorTargetPreference`); this store persists them
/// in the native app's Application Support domain files
/// (`LocalSettingsDomain.runScriptPreferences` / `.editorTargetPreferences`).
struct NativeShellProductivityPreferences: Codable, Equatable, Sendable {
    var scripts: Settings.ScriptPreferences
    var editorTargets: Settings.EditorTargetPreference

    init(
        scripts: Settings.ScriptPreferences = Settings.ScriptPreferences(),
        editorTargets: Settings.EditorTargetPreference = Settings.EditorTargetPreference()
    ) {
        self.scripts = scripts
        self.editorTargets = editorTargets
    }
}

final class NativeShellProductivityPreferencesStore: @unchecked Sendable {
    private let lock = NSLock()
    private let fileURL: URL
    /// Mirror of the last state known to be on disk (or defaults while the
    /// file is absent). Never advanced past a failed write: the cache must
    /// not claim preferences the disk does not have (D-045 persistence
    /// discipline).
    private var cached: NativeShellProductivityPreferences?
    /// Invoked outside the lock when persisting preferences fails. The shell
    /// wires this into the D-043 notifications hub so write failures surface
    /// to the user instead of dying in a silent `try?`.
    private var persistenceFailureHandler: (@Sendable (String) -> Void)?

    init(fileURL: URL) {
        self.fileURL = fileURL
    }

    func setPersistenceFailureHandler(_ handler: (@Sendable (String) -> Void)?) {
        lock.lock()
        defer { lock.unlock() }
        persistenceFailureHandler = handler
    }

    static func applicationSupport(
        applicationSupportDirectoryName: String = "FenrirNative",
        fileManager: FileManager = .default
    ) -> NativeShellProductivityPreferencesStore? {
        guard let root = try? fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: false
        ) else {
            return nil
        }
        return NativeShellProductivityPreferencesStore(fileURL: root
            .appendingPathComponent(applicationSupportDirectoryName, isDirectory: true)
            .appendingPathComponent("productivity-preferences.json", isDirectory: false))
    }

    static func ephemeral() -> NativeShellProductivityPreferencesStore {
        NativeShellProductivityPreferencesStore(fileURL: FileManager.default.temporaryDirectory
            .appendingPathComponent("fenrir-productivity-\(UUID().uuidString)", isDirectory: true)
            .appendingPathComponent("productivity-preferences.json", isDirectory: false))
    }

    func load() -> NativeShellProductivityPreferences {
        lock.lock()
        defer { lock.unlock() }
        if let cached {
            return cached
        }
        guard let data = try? Data(contentsOf: fileURL) else {
            // Missing file (first run) — defaults, nothing worth preserving.
            let defaults = NativeShellProductivityPreferences()
            cached = defaults
            return defaults
        }
        guard let decoded = try? JSONDecoder().decode(NativeShellProductivityPreferences.self, from: data) else {
            // The file exists but does not decode. Back it up before any
            // later save overwrites it, so a transient decode failure (schema
            // drift, partial write) never clobbers the user's preferences.
            backUpCorruptPreferencesFile()
            let defaults = NativeShellProductivityPreferences()
            cached = defaults
            return defaults
        }
        let normalized = NativeShellProductivityPreferences(
            scripts: decoded.scripts.normalizedForPersistence(),
            editorTargets: decoded.editorTargets
        )
        cached = normalized
        return normalized
    }

    @discardableResult
    func save(_ preferences: NativeShellProductivityPreferences) -> Bool {
        lock.lock()
        let normalized = NativeShellProductivityPreferences(
            scripts: preferences.scripts.normalizedForPersistence(),
            editorTargets: preferences.editorTargets
        )
        var failureMessage: String?
        do {
            try FileManager.default.createDirectory(
                at: fileURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(normalized)
            try data.write(to: fileURL, options: [.atomic])
            // Only a successful write advances the cache — the in-memory
            // state must always match what a relaunch would load.
            cached = normalized
        } catch {
            failureMessage = String(describing: error)
        }
        let handler = persistenceFailureHandler
        lock.unlock()
        if let failureMessage {
            NSLog("Fenrir Native failed to persist productivity preferences at \(fileURL.path): \(failureMessage)")
            handler?(failureMessage)
            return false
        }
        return true
    }

    /// Moves an undecodable preferences file aside (`.corrupt` suffix) so its
    /// contents survive until a human can look at them. Called under `lock`.
    private func backUpCorruptPreferencesFile() {
        let backupURL = fileURL.appendingPathExtension("corrupt")
        do {
            if FileManager.default.fileExists(atPath: backupURL.path) {
                try FileManager.default.removeItem(at: backupURL)
            }
            try FileManager.default.moveItem(at: fileURL, to: backupURL)
            NSLog("Fenrir Native backed up undecodable productivity preferences to \(backupURL.path)")
        } catch {
            NSLog("Fenrir Native could not back up undecodable productivity preferences: \(String(describing: error))")
        }
    }

    func scripts(forRepositoryPath canonicalPath: String?) -> [Settings.ScriptDefinition] {
        let preferences = load()
        guard let canonicalPath else {
            return Settings.mergedScripts(repository: [], global: preferences.scripts.globalScripts)
        }
        return preferences.scripts.scripts(forRepositoryPath: canonicalPath)
    }

    func primaryRunScript(forRepositoryPath canonicalPath: String?) -> Settings.ScriptDefinition? {
        guard let canonicalPath else {
            return nil
        }
        return load().scripts.primaryRunScript(forRepositoryPath: canonicalPath)
    }

    func replaceRepositoryScripts(_ scripts: [Settings.ScriptDefinition], canonicalPath: String) {
        let preferences = load()
        save(NativeShellProductivityPreferences(
            scripts: preferences.scripts.replacingScripts(scripts, scope: .repository(canonicalPath: canonicalPath)),
            editorTargets: preferences.editorTargets
        ))
    }

    func editorTargetID(forRepositoryPath canonicalPath: String?) -> WorkspaceIndex.EditorTargetID? {
        load().editorTargets.editorID(forRepositoryPath: canonicalPath)
            .map(WorkspaceIndex.EditorTargetID.init(rawValue:))
    }

    /// Persists a picked editor target: per-repository override when the
    /// workspace has a canonical path, global default otherwise (D-045).
    func persistEditorTarget(_ targetID: WorkspaceIndex.EditorTargetID, canonicalPath: String?) {
        let preferences = load()
        let change: Settings.EditorTargetChange = if let canonicalPath {
            .setRepositoryOverride(canonicalPath: canonicalPath, editorID: targetID.rawValue)
        } else {
            .setDefaultEditor(editorID: targetID.rawValue)
        }
        var editorTargets = preferences.editorTargets.applying(change)
        if editorTargets.defaultEditorID == nil {
            editorTargets = editorTargets.applying(.setDefaultEditor(editorID: targetID.rawValue))
        }
        save(NativeShellProductivityPreferences(scripts: preferences.scripts, editorTargets: editorTargets))
    }
}

// MARK: - Server-owned script panes (D-019)

struct NativeScriptPaneRequest: Equatable, Sendable {
    let workspaceID: WorkspaceID
    let windowID: FenrirWindowID
    let workingDirectory: String?
    let command: String
    let title: String
    let processDefID: String

    init(
        workspaceID: WorkspaceID,
        windowID: FenrirWindowID,
        workingDirectory: String?,
        command: String,
        title: String,
        processDefID: String
    ) {
        self.workspaceID = workspaceID
        self.windowID = windowID
        self.workingDirectory = workingDirectory
        self.command = command
        self.title = title
        self.processDefID = processDefID
    }
}

/// Creates and stops script panes through the server tmux kernel. Scripts are
/// managed-process panes (D-019/D-034) so output stays server-owned and
/// streamable, and the panes appear in the pane grid like any tmux pane.
protocol NativeWorkspaceScriptPaneRunning: Sendable {
    func createScriptPane(_ request: NativeScriptPaneRequest) async throws -> PaneID
    func closeScriptPane(workspaceID: WorkspaceID, paneID: PaneID) async throws
}

struct NativeUnavailableScriptPaneRunner: NativeWorkspaceScriptPaneRunning {
    func createScriptPane(_ request: NativeScriptPaneRequest) async throws -> PaneID {
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }

    func closeScriptPane(workspaceID: WorkspaceID, paneID: PaneID) async throws {
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }
}

/// Serializes script-pane creation per workspace: concurrent runs are chained
/// so their `tmux.pane.create` calls cannot interleave and cross-attach
/// managed-process metadata. Identification stays response-driven regardless
/// (the adapter resolves the created pane by its unique managed-process
/// `instanceId` from the RPC response, never by diffing pane sets), so
/// serialization is about metadata/ordering hygiene, not identity.
actor NativeScriptPaneCreateSerializer {
    private var tails: [WorkspaceID: Task<Void, Never>] = [:]

    func run<T: Sendable>(
        workspaceID: WorkspaceID,
        operation: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        let previous = tails[workspaceID]
        let task = Task<Result<T, Error>, Never> {
            if let previous {
                await previous.value
            }
            do {
                return .success(try await operation())
            } catch {
                return .failure(error)
            }
        }
        tails[workspaceID] = Task { _ = await task.value }
        return try await task.value.get()
    }
}

/// Script panes go through the NativeRuntime module port (D-026): the adapter
/// owns the `tmux.pane.create`/`tmux.pane.close` wire shapes and resolves the
/// created pane by its unique managed-process `instanceId` marker, which also
/// skips the server's permanently retained closed panes.
struct NativeServerScriptPaneRunner: NativeWorkspaceScriptPaneRunning {
    private let actor: NativeRuntime.RuntimeActorIdentity
    private let paneRuntime: any NativeRuntime.PaneRuntimeCreating & NativeRuntime.PaneRuntimeClosing
    private let createSerializer: NativeScriptPaneCreateSerializer

    init(
        actor: NativeRuntime.RuntimeActorIdentity,
        paneRuntime: any NativeRuntime.PaneRuntimeCreating & NativeRuntime.PaneRuntimeClosing,
        createSerializer: NativeScriptPaneCreateSerializer = NativeScriptPaneCreateSerializer()
    ) {
        self.actor = actor
        self.paneRuntime = paneRuntime
        self.createSerializer = createSerializer
    }

    func createScriptPane(_ request: NativeScriptPaneRequest) async throws -> PaneID {
        let actor = actor
        let paneRuntime = paneRuntime
        return try await createSerializer.run(workspaceID: request.workspaceID) {
            let instanceID = "script-\(UUID().uuidString.lowercased())"
            let pane = try await paneRuntime.createPaneRuntime(NativeRuntime.CreatePaneRuntimeInput(
                requestID: RequestID(rawValue: "native-script-pane-create-\(instanceID)"),
                workspaceID: request.workspaceID,
                windowID: request.windowID,
                actor: actor,
                managedProcess: NativeRuntime.ManagedProcessPaneSpec(
                    title: request.title,
                    command: request.command,
                    instanceID: instanceID,
                    processDefID: request.processDefID,
                    labels: ["fenrir.script": request.title]
                ),
                split: .horizontal,
                workingDirectory: request.workingDirectory,
                source: .workspaceShell
            ))
            return pane.paneID
        }
    }

    func closeScriptPane(workspaceID: WorkspaceID, paneID: PaneID) async throws {
        try await paneRuntime.closePaneRuntime(NativeRuntime.ClosePaneRuntimeInput(
            requestID: RequestID(rawValue: "native-script-pane-close-\(paneID.rawValue)"),
            workspaceID: workspaceID,
            paneID: paneID,
            actor: actor,
            source: .workspaceShell
        ))
    }
}

// MARK: - Agent session resume (D-044)

/// Resume request for a dead agent session: the command is NEVER carried in
/// this request — it is derived exclusively from the AgentIntegration resume
/// descriptor table after validating the session id.
struct NativeAgentResumeRequest: Equatable, Sendable {
    let workspaceID: WorkspaceID
    let windowID: FenrirWindowID
    let workingDirectory: String?
    let agentID: AgentIntegration.AgentCLIIdentifier
    let sessionID: String

    init(
        workspaceID: WorkspaceID,
        windowID: FenrirWindowID,
        workingDirectory: String?,
        agentID: AgentIntegration.AgentCLIIdentifier,
        sessionID: String
    ) {
        self.workspaceID = workspaceID
        self.windowID = windowID
        self.workingDirectory = workingDirectory
        self.agentID = agentID
        self.sessionID = sessionID
    }
}

/// Creates the resume pane through the server tmux kernel (D-044): a resumed
/// agent is a NEW tmux pane with fresh identity running the agent's validated
/// resume command, carrying agent pane metadata (not managed-process).
protocol NativeAgentSessionResuming: Sendable {
    func resumeAgentSession(_ request: NativeAgentResumeRequest) async throws -> PaneID
}

struct NativeUnavailableAgentSessionResumer: NativeAgentSessionResuming {
    func resumeAgentSession(_ request: NativeAgentResumeRequest) async throws -> PaneID {
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }
}

/// Resume panes go through the NativeRuntime module port (D-026): the adapter
/// owns the `tmux.pane.create` wire shape and resolves the created pane by
/// its unique `agent.providerInstanceId` marker. Creation is serialized per
/// workspace with the same discipline as script panes.
struct NativeServerAgentSessionResumer: NativeAgentSessionResuming {
    private let actor: NativeRuntime.RuntimeActorIdentity
    private let paneRuntime: any NativeRuntime.AgentPaneRuntimeCreating
    private let createSerializer: NativeScriptPaneCreateSerializer

    init(
        actor: NativeRuntime.RuntimeActorIdentity,
        paneRuntime: any NativeRuntime.AgentPaneRuntimeCreating,
        createSerializer: NativeScriptPaneCreateSerializer = NativeScriptPaneCreateSerializer()
    ) {
        self.actor = actor
        self.paneRuntime = paneRuntime
        self.createSerializer = createSerializer
    }

    func resumeAgentSession(_ request: NativeAgentResumeRequest) async throws -> PaneID {
        // The ONLY path from session id to command: descriptor table +
        // allowlist validation (D-044). Invalid ids never reach the shell.
        guard let command = AgentIntegration.resumeCommand(agentID: request.agentID, sessionID: request.sessionID) else {
            throw NativeRuntime.NativeRuntimeError.paneCreateFailed
        }
        let title = AgentIntegration.supportedAgentDescriptors
            .first { $0.id == request.agentID }?
            .displayName ?? request.agentID.rawValue
        let actor = actor
        let paneRuntime = paneRuntime
        return try await createSerializer.run(workspaceID: request.workspaceID) {
            let instanceID = "agent-resume-\(UUID().uuidString.lowercased())"
            let pane = try await paneRuntime.createAgentPaneRuntime(NativeRuntime.CreateAgentPaneRuntimeInput(
                requestID: RequestID(rawValue: "native-agent-resume-\(instanceID)"),
                workspaceID: request.workspaceID,
                windowID: request.windowID,
                actor: actor,
                agent: NativeRuntime.AgentPaneSpec(
                    title: title,
                    command: command,
                    providerID: request.agentID.rawValue,
                    instanceID: instanceID,
                    labels: ["fenrir.agent.resumedSessionID": request.sessionID]
                ),
                split: .horizontal,
                workingDirectory: request.workingDirectory,
                source: .workspaceShell
            ))
            return pane.paneID
        }
    }
}

/// Persists D-044 resumability server-side: session-start presence with a
/// session id attaches {agentID, sessionID} to the pane record through the
/// existing `tmux.pane.attachMetadata` contract, so resumable sessions
/// survive client restarts.
protocol NativeAgentPaneMetadataAttaching: Sendable {
    func attachResumableSessionMetadata(
        workspaceID: WorkspaceID,
        paneID: PaneID,
        agentID: AgentIntegration.AgentCLIIdentifier,
        sessionID: String
    ) async throws
}

struct NativeUnavailableAgentPaneMetadataAttacher: NativeAgentPaneMetadataAttaching {
    func attachResumableSessionMetadata(
        workspaceID: WorkspaceID,
        paneID: PaneID,
        agentID: AgentIntegration.AgentCLIIdentifier,
        sessionID: String
    ) async throws {
        throw NativeRuntime.NativeRuntimeError.serverUnavailable
    }
}

struct NativeServerAgentPaneMetadataAttacher: NativeAgentPaneMetadataAttaching {
    private let actor: NativeRuntime.RuntimeActorIdentity
    private let paneRuntime: any NativeRuntime.PaneAgentMetadataAttaching

    init(
        actor: NativeRuntime.RuntimeActorIdentity,
        paneRuntime: any NativeRuntime.PaneAgentMetadataAttaching
    ) {
        self.actor = actor
        self.paneRuntime = paneRuntime
    }

    func attachResumableSessionMetadata(
        workspaceID: WorkspaceID,
        paneID: PaneID,
        agentID: AgentIntegration.AgentCLIIdentifier,
        sessionID: String
    ) async throws {
        // Session ids originate in-band (D-044): re-validate at the trust
        // boundary even though the presence parser already did.
        guard AgentIntegration.isValidAgentSessionID(sessionID) else {
            throw NativeRuntime.NativeRuntimeError.paneMetadataAttachFailed
        }
        let title = AgentIntegration.supportedAgentDescriptors
            .first { $0.id == agentID }?
            .displayName ?? agentID.rawValue
        _ = try await paneRuntime.attachAgentPaneMetadata(NativeRuntime.AttachAgentPaneMetadataInput(
            requestID: RequestID(rawValue: "native-agent-session-metadata-\(paneID.rawValue)"),
            workspaceID: workspaceID,
            paneID: paneID,
            actor: actor,
            agentID: agentID.rawValue,
            sessionID: sessionID,
            title: title,
            labels: ["fenrir.agent.sessionID": sessionID],
            source: .terminalViewport
        ))
    }
}

// MARK: - Open in editor (D-045)

struct NativeWorkspaceIndexClock: WorkspaceIndex.WorkspaceIndexClock {
    func now() -> FenrirTimestamp { FenrirTimestamp(Date()) }
}

/// Shell-side composition of the WorkspaceIndex editor-target module: detected
/// catalogue, launch, and the `$EDITOR` route-to-terminal-pane disposition.
struct NativeWorkspaceEditorOpening: Sendable {
    let resolver: WorkspaceIndex.EditorTargetResolver
    private let launcher: any WorkspaceIndex.EditorTargetLaunching
    private let clock: any WorkspaceIndex.WorkspaceIndexClock

    init(
        resolver: WorkspaceIndex.EditorTargetResolver,
        launcher: any WorkspaceIndex.EditorTargetLaunching,
        clock: any WorkspaceIndex.WorkspaceIndexClock = NativeWorkspaceIndexClock()
    ) {
        self.resolver = resolver
        self.launcher = launcher
        self.clock = clock
    }

    static func system() -> NativeWorkspaceEditorOpening {
        NativeWorkspaceEditorOpening(
            resolver: WorkspaceIndex.systemEditorTargetResolver(),
            launcher: WorkspaceIndex.SystemEditorTargetLauncher()
        )
    }

    func installedTargets() -> [WorkspaceIndex.EditorTarget] {
        resolver.installedTargets()
    }

    func displayName(for targetID: WorkspaceIndex.EditorTargetID) -> String? {
        resolver.target(withID: targetID)?.displayName
    }

    func open(
        targetID: WorkspaceIndex.EditorTargetID,
        workspacePath: String
    ) async -> Result<WorkspaceIndex.EditorOpenDisposition, WorkspaceIndex.EditorTargetError> {
        let action = WorkspaceIndex.OpenWorkspaceInEditor(resolver: resolver, launcher: launcher, clock: clock)
        return await action.run(WorkspaceIndex.OpenWorkspaceInEditorInput(
            requestID: RequestID(rawValue: "native-open-in-editor-\(targetID.rawValue)"),
            targetID: targetID,
            workspacePath: workspacePath,
            source: .workspaceShell
        )).map(\.disposition)
    }
}

// MARK: - Workspace notification hub (D-043 routing)

struct NativeWorkspaceNotificationIngestOutcome: Sendable {
    let notification: Notifications.WorkspaceNotification
    let unreadCount: Int
    let bannerPresented: Bool
}

/// Routes workspace notifications into the attention store and, when the app
/// is inactive, to the macOS banner port (D-043). One hub is shared by every
/// workspace window so sidebar rows can show cross-workspace state.
struct NativeWorkspaceNotificationsHub: Sendable {
    let store: any Notifications.WorkspaceNotificationStoring
    private let bannerPresenter: any Notifications.NotificationBannerPresenting

    init(
        store: any Notifications.WorkspaceNotificationStoring =
            Notifications.inMemoryWorkspaceNotificationStore(clock: SystemFenrirClock()),
        bannerPresenter: any Notifications.NotificationBannerPresenting =
            Notifications.userNotificationCenterBannerPresenter()
    ) {
        self.store = store
        self.bannerPresenter = bannerPresenter
    }

    /// Returns nil when the draft was dropped by D-043 sanitization
    /// (empty payload after control characters were stripped).
    func ingest(
        _ draft: Notifications.WorkspaceNotificationDraft,
        isAppActive: Bool
    ) async -> NativeWorkspaceNotificationIngestOutcome? {
        guard let outcome = await store.append(draft) else {
            return nil
        }
        let unreadCount = await store.unreadCount(workspaceID: draft.workspaceID)
        // Coalesced repeats refresh the stored record but must not re-present
        // a macOS banner (D-043): only a genuinely new record reaches the
        // banner port.
        let bannerPresented = outcome.coalesced
            ? false
            : await Notifications.presentBannerIfNeeded(
                for: outcome.notification,
                isAppActive: isAppActive,
                using: bannerPresenter
            )
        return NativeWorkspaceNotificationIngestOutcome(
            notification: outcome.notification,
            unreadCount: unreadCount,
            bannerPresented: bannerPresented
        )
    }
}

/// Formats the sidebar latest-notification line (D-045 row metadata).
func nativeSidebarLatestNotificationLine(_ notification: Notifications.WorkspaceNotification) -> String {
    if let title = notification.title, !title.isEmpty {
        return "\(title) · \(notification.body)"
    }
    return notification.body
}

// MARK: - Agent approval feed (D-042)

/// Wire mirror of the server `ApprovalOption` contract
/// (`packages/contracts` agentFeed).
struct NativeApprovalFeedWireOption: Decodable, Equatable, Sendable {
    let id: String
    let label: String
}

/// Wire mirror of the server `ApprovalRequest` contract. Payloads carry the
/// structured request the hook provided — never terminal content (D-042).
struct NativeApprovalFeedWireRequest: Decodable, Equatable, Sendable {
    let id: String
    let workspaceId: String
    let paneId: String?
    let agentId: String
    let kind: String
    let summary: String
    let options: [NativeApprovalFeedWireOption]
    let createdAt: String
    let expiresAt: String
}

/// Wire mirror of the server `ApprovalFeedEvent` union
/// (`subscribeApprovalFeed` stream payloads).
struct NativeApprovalFeedWireEvent: Decodable, Equatable, Sendable {
    let type: String
    let workspaceId: String
    let request: NativeApprovalFeedWireRequest?
    let requestId: String?
    let reason: String?
    let optionId: String?

    /// Maps the wire event to the typed store event. Unknown kinds or
    /// reasons (future contract additions) are dropped, never crash.
    func streamEvent() -> Notifications.ApprovalFeedStreamEvent? {
        switch type {
        case "pending":
            guard let request,
                  let kind = Notifications.ApprovalRequestKind(rawValue: request.kind)
            else {
                return nil
            }
            return .pending(Notifications.ApprovalFeedCard(
                requestID: request.id,
                workspaceID: WorkspaceID(rawValue: request.workspaceId),
                paneID: request.paneId,
                agentID: request.agentId,
                kind: kind,
                summary: request.summary,
                options: request.options.map { Notifications.ApprovalOption(id: $0.id, label: $0.label) },
                createdAt: request.createdAt,
                expiresAt: request.expiresAt
            ))
        case "settled":
            guard let requestId,
                  let reason,
                  let settleReason = Notifications.ApprovalSettleReason(rawValue: reason)
            else {
                return nil
            }
            return .settled(requestID: requestId, reason: settleReason, optionID: optionId)
        default:
            return nil
        }
    }
}

/// Server stream port for the approval feed relay (D-042). The client
/// consumes pending/settled events; it never polls hooks or panes.
protocol NativeApprovalFeedEventStreaming: Sendable {
    func observeApprovalFeed() async -> AsyncThrowingStream<Notifications.ApprovalFeedStreamEvent, Error>
}

struct NativeApprovalFeedServerConnectionEventStream: NativeApprovalFeedEventStreaming {
    private let streamServerRequest: @Sendable (NativeRuntime.ServerRPCRequest) -> AsyncThrowingStream<Data, Error>

    init(streamServerRequest: @escaping @Sendable (NativeRuntime.ServerRPCRequest) -> AsyncThrowingStream<Data, Error>) {
        self.streamServerRequest = streamServerRequest
    }

    func observeApprovalFeed() async -> AsyncThrowingStream<Notifications.ApprovalFeedStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                let request = NativeRuntime.ServerRPCRequest(
                    requestID: RequestID(rawValue: "native-approval-feed-\(UUID().uuidString)"),
                    method: "subscribeApprovalFeed",
                    payload: Data("{}".utf8)
                )
                let upstream = streamServerRequest(request)
                do {
                    for try await data in upstream {
                        guard let wireEvent = try? JSONDecoder().decode(NativeApprovalFeedWireEvent.self, from: data),
                              let event = wireEvent.streamEvent()
                        else {
                            continue
                        }
                        continuation.yield(event)
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

/// Decide RPC port (D-042/D-040): decisions dispatch as typed server
/// actions; the hook applies the decision inside the agent's own process.
/// The client never writes decision keystrokes into panes.
protocol NativeApprovalFeedDeciding: Sendable {
    func decide(requestID: String, optionID: String) async throws
}

struct NativeApprovalFeedServerConnectionDecider: NativeApprovalFeedDeciding {
    private let sessionID: ServerConnection.SessionID
    private let sendServerRequest: ServerConnection.SendServerRequest

    init(
        sessionID: ServerConnection.SessionID,
        sendServerRequest: ServerConnection.SendServerRequest
    ) {
        self.sessionID = sessionID
        self.sendServerRequest = sendServerRequest
    }

    func decide(requestID: String, optionID: String) async throws {
        let payloadData = try JSONEncoder().encode(NativeApprovalFeedDecidePayload(
            requestId: requestID,
            optionId: optionID
        ))
        _ = try await sendServerRequest.run(ServerConnection.SendServerRequestInput(
            requestID: .generated(),
            sessionID: sessionID,
            request: ServerConnection.RequestEnvelope(
                method: "agentFeed.decide",
                payload: String(decoding: payloadData, as: UTF8.self)
            )
        )).get()
    }
}

private struct NativeApprovalFeedDecidePayload: Encodable {
    let requestId: String
    let optionId: String
}

/// Bridges macOS approval-banner action taps to the decide RPC (D-042:
/// banner buttons decide directly). The pure identifier mapping lives in
/// `Notifications.ApprovalBannerAction`; this class only adapts the
/// `UNUserNotificationCenter` delegate callback and is installed exclusively
/// when running from a real app bundle.
final class NativeApprovalBannerActionRouter: NSObject, UNUserNotificationCenterDelegate {
    private let onDecision: @Sendable (_ requestID: String, _ optionID: String) -> Void

    init(onDecision: @escaping @Sendable (_ requestID: String, _ optionID: String) -> Void) {
        self.onDecision = onDecision
    }

    /// Sets this router as the notification-center delegate. Bare
    /// executables and test runners cannot reach the center; callers keep a
    /// strong reference for the app lifetime.
    func installIfAvailable() {
        guard Bundle.main.bundleIdentifier != nil, Bundle.main.bundleURL.pathExtension == "app" else {
            return
        }
        UNUserNotificationCenter.current().delegate = self
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if let decision = Notifications.ApprovalBannerAction.decision(
            forActionIdentifier: response.actionIdentifier,
            userInfo: response.notification.request.content.userInfo
        ) {
            onDecision(decision.requestID, decision.optionID)
        }
        completionHandler()
    }
}
