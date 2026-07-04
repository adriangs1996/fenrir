import AgentInteraction
import AppKit
import FenrirNativeShared
import Foundation
import NativeRuntime
import Notifications
import PaneGrid
import Testing
import WorkspaceIndex
import WorkspaceOverlays
@testable import FenrirNativeApp

@Suite("NativeHost D-042 agent approval feed", .serialized)
struct NativeApprovalFeedTests {
    @Test("pending stream events project cards, badge, overlay, and smoke payload")
    @MainActor
    func pendingEventProjectsCardBadgeOverlayAndSmoke() async throws {
        let stream = ScriptedApprovalFeedEventStream()
        let decider = RecordingApprovalFeedDecider()
        let banners = RecordingApprovalBannerPresenter()
        let controller = makeApprovalFeedController(
            stream: stream,
            decider: decider,
            banners: banners,
            isAppActive: true
        )
        let rootView = controller.view as! NativeWorkspaceRootView
        controller.startApprovalFeedStreamIfNeeded()

        stream.push(.pending(approvalCard(requestID: "approval-1")))
        try await waitUntil { rootView.visibleApprovalsPendingCount() == 1 }

        // Bell badge counts unread notifications plus pending approvals.
        controller.refreshTitlebarControls()
        #expect(rootView.titlebarControlsState().notificationUnreadCount == 1)
        // App active: no macOS banner (mirrors the D-043 banner rule).
        #expect(banners.presentedRequestIDs.isEmpty)

        controller.presentApprovalsPanel()
        let smoke = await controller.runApprovalFeedSmoke(expectedMarker: "Permission request: Bash")
        #expect(smoke["pendingCount"] == "1")
        #expect(smoke["lastRequestID"] == "approval-1")
        #expect(smoke["lastKind"] == "permission")
        // D-031: summary content must never cross the diagnostics channel —
        // only its length and an expected-marker match are reported.
        #expect(smoke["lastSummary"] == nil)
        #expect(smoke.values.allSatisfy { !$0.contains("Permission request: Bash") })
        #expect(smoke["lastSummaryLength"] == String("Permission request: Bash".count))
        #expect(smoke["lastSummaryMatchesExpected"] == "true")
        #expect(smoke["lastOptionIDs"] == "allow,deny")
        #expect(smoke["panelVisible"] == "true")
        #expect(rootView.overlayHost.visibleOverlayTitles().contains("Approvals"))
    }

    @Test("option buttons dispatch exactly one decide RPC and settle on the stream event")
    @MainActor
    func decideDispatchesOnceAndSettlesFromStream() async throws {
        let stream = ScriptedApprovalFeedEventStream()
        let decider = RecordingApprovalFeedDecider()
        let banners = RecordingApprovalBannerPresenter()
        let controller = makeApprovalFeedController(
            stream: stream,
            decider: decider,
            banners: banners,
            isAppActive: false
        )
        let rootView = controller.view as! NativeWorkspaceRootView
        controller.startApprovalFeedStreamIfNeeded()

        stream.push(.pending(approvalCard(requestID: "approval-2")))
        try await waitUntil { rootView.visibleApprovalsPendingCount() == 1 }
        // App inactive: an actionable banner presents for the new card.
        #expect(banners.presentedRequestIDs == ["approval-2"])

        // Double-click on the card option: exactly one decide RPC.
        rootView.onDecideApproval?("approval-2", "allow")
        rootView.onDecideApproval?("approval-2", "allow")
        try await waitUntil { decider.decisions.count == 1 }
        #expect(decider.decisions.first?.requestID == "approval-2")
        #expect(decider.decisions.first?.optionID == "allow")

        // The card only disappears when the stream settles the request.
        #expect(rootView.visibleApprovalsPendingCount() == 1)
        stream.push(.settled(requestID: "approval-2", reason: .decided, optionID: "allow"))
        try await waitUntil { rootView.visibleApprovalsPendingCount() == 0 }
        try await waitUntil { banners.withdrawnRequestIDs == ["approval-2"] }

        controller.refreshTitlebarControls()
        #expect(rootView.titlebarControlsState().notificationUnreadCount == 0)
    }

    @Test("rejected decide drops the local card and records diagnostics-only metadata")
    @MainActor
    func rejectedDecisionDropsCard() async throws {
        let stream = ScriptedApprovalFeedEventStream()
        let decider = RecordingApprovalFeedDecider()
        decider.failure = NSError(domain: "fenrir-test", code: 1)
        let banners = RecordingApprovalBannerPresenter()
        let controller = makeApprovalFeedController(
            stream: stream,
            decider: decider,
            banners: banners,
            isAppActive: true
        )
        let rootView = controller.view as! NativeWorkspaceRootView
        controller.startApprovalFeedStreamIfNeeded()

        stream.push(.pending(approvalCard(requestID: "approval-3")))
        try await waitUntil { rootView.visibleApprovalsPendingCount() == 1 }

        rootView.onDecideApproval?("approval-3", "deny")
        try await waitUntil { rootView.visibleApprovalsPendingCount() == 0 }
        #expect(decider.decisions.count == 1)
    }

    @Test("wire events decode into typed stream events and unknown kinds drop")
    func wireEventMapping() throws {
        let pendingJSON = """
        {"type":"pending","workspaceId":"workspace-a","request":{"id":"approval-9","workspaceId":"workspace-a","paneId":"%3","agentId":"claude-code","kind":"permission","summary":"Permission request: Bash","options":[{"id":"allow","label":"Allow"},{"id":"deny","label":"Deny"}],"createdAt":"2026-07-04T00:00:00.000Z","expiresAt":"2026-07-04T00:01:50.000Z"}}
        """
        let pending = try JSONDecoder().decode(NativeApprovalFeedWireEvent.self, from: Data(pendingJSON.utf8))
        guard case .pending(let card)? = pending.streamEvent() else {
            Issue.record("expected pending event")
            return
        }
        #expect(card.requestID == "approval-9")
        #expect(card.kind == .permission)
        #expect(card.options.map(\.id) == ["allow", "deny"])

        let settledJSON = """
        {"type":"settled","workspaceId":"workspace-a","requestId":"approval-9","reason":"decided","optionId":"allow","settledAt":"2026-07-04T00:00:10.000Z"}
        """
        let settled = try JSONDecoder().decode(NativeApprovalFeedWireEvent.self, from: Data(settledJSON.utf8))
        guard case .settled(let requestID, let reason, let optionID)? = settled.streamEvent() else {
            Issue.record("expected settled event")
            return
        }
        #expect(requestID == "approval-9")
        #expect(reason == .decided)
        #expect(optionID == "allow")

        // Unknown kinds (future contract additions) drop instead of crash.
        let unknownKindJSON = pendingJSON.replacingOccurrences(of: "\"kind\":\"permission\"", with: "\"kind\":\"exotic\"")
        let unknown = try JSONDecoder().decode(NativeApprovalFeedWireEvent.self, from: Data(unknownKindJSON.utf8))
        #expect(unknown.streamEvent() == nil)
    }
}

// MARK: - Fixtures

private func approvalCard(requestID: String) -> Notifications.ApprovalFeedCard {
    Notifications.ApprovalFeedCard(
        requestID: requestID,
        workspaceID: "workspace-a",
        paneID: "%1",
        agentID: "claude-code",
        kind: .permission,
        summary: "Permission request: Bash",
        options: [
            Notifications.ApprovalOption(id: "allow", label: "Allow"),
            Notifications.ApprovalOption(id: "deny", label: "Deny")
        ],
        createdAt: "2026-07-04T00:00:00.000Z",
        expiresAt: "2026-07-04T00:01:50.000Z"
    )
}

@MainActor
private func makeApprovalFeedController(
    stream: ScriptedApprovalFeedEventStream,
    decider: RecordingApprovalFeedDecider,
    banners: RecordingApprovalBannerPresenter,
    isAppActive: Bool
) -> NativeWorkspaceRootViewController {
    NativeWorkspaceRootViewController(
        controller: NativeWorkspaceShellController(state: approvalFeedShellState()),
        paneGridRuntime: NativePaneGridUnavailableRuntimeFactory().makeRuntime(for: approvalFeedShellState()),
        agentPromptSubmitter: ApprovalFeedNoopPromptSubmitter(),
        productivityPreferences: NativeShellProductivityPreferencesStore.ephemeral(),
        approvalFeedEventStream: stream,
        approvalFeedDecider: decider,
        approvalBannerPresenter: banners,
        isAppActive: { isAppActive }
    )
}

private func approvalFeedShellState() -> NativeWorkspaceShellState {
    let pane = PaneGrid.PanePresentation(
        paneID: "pane-a",
        tmuxPaneID: NativeRuntime.TmuxPaneID(rawValue: "%1"),
        streamID: nil,
        viewportID: "viewport-pane-a",
        title: "shell",
        rect: PaneGrid.PaneRect(x: 0, y: 0, columns: 120, rows: 36),
        isFocused: true
    )
    let grid = PaneGrid.State(
        workspaceID: "workspace-a",
        tmuxSessionID: "tmux-session-a",
        activeWindowID: "window-a",
        windows: [
            PaneGrid.WindowPresentation(
                windowID: "window-a",
                tmuxWindowID: "tmux-window-a",
                index: 0,
                title: "main",
                root: .pane(pane),
                activePaneID: "pane-a",
                panes: [pane]
            )
        ]
    )
    return NativeWorkspaceShellState(
        workspaceID: "workspace-a",
        nativeWindowID: "window-a",
        paneGridState: grid,
        sidebarItems: [
            WorkspaceIndex.WorkspaceSidebarItem(summary: WorkspaceIndex.WorkspaceSummary(
                workspaceID: "workspace-a",
                displayName: "Fenrir",
                canonicalPath: "/repo/fenrir",
                isOpenLocally: true,
                status: .open
            ))
        ],
        focusedSurface: .terminal(nil)
    )
}

@MainActor
private func waitUntil(
    timeoutMilliseconds: Int = 2_000,
    _ predicate: @MainActor () -> Bool
) async throws {
    let deadline = Date().addingTimeInterval(Double(timeoutMilliseconds) / 1_000)
    while !predicate() {
        if Date() > deadline {
            Issue.record("waitUntil timed out")
            return
        }
        try await Task.sleep(nanoseconds: 10_000_000)
    }
}

// MARK: - Fakes

/// Push-driven fake of the approval-feed relay stream; the continuation is
/// retained so the stream stays live like a real WS subscription.
private final class ScriptedApprovalFeedEventStream: NativeApprovalFeedEventStreaming, @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: AsyncThrowingStream<Notifications.ApprovalFeedStreamEvent, Error>.Continuation?
    private var buffered: [Notifications.ApprovalFeedStreamEvent] = []

    func push(_ event: Notifications.ApprovalFeedStreamEvent) {
        lock.lock()
        defer { lock.unlock() }
        if let continuation {
            continuation.yield(event)
        } else {
            buffered.append(event)
        }
    }

    func observeApprovalFeed() async -> AsyncThrowingStream<Notifications.ApprovalFeedStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            lock.lock()
            defer { lock.unlock() }
            self.continuation = continuation
            for event in buffered {
                continuation.yield(event)
            }
            buffered.removeAll()
        }
    }
}

private final class RecordingApprovalFeedDecider: NativeApprovalFeedDeciding, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [(requestID: String, optionID: String)] = []
    var failure: Error?

    var decisions: [(requestID: String, optionID: String)] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func decide(requestID: String, optionID: String) async throws {
        let failure = lock.withLock {
            recorded.append((requestID, optionID))
            return self.failure
        }
        if let failure {
            throw failure
        }
    }
}

private final class RecordingApprovalBannerPresenter: Notifications.ApprovalBannerPresenting, @unchecked Sendable {
    private let lock = NSLock()
    private var presented: [String] = []
    private var withdrawn: [String] = []

    var presentedRequestIDs: [String] {
        lock.lock()
        defer { lock.unlock() }
        return presented
    }

    var withdrawnRequestIDs: [String] {
        lock.lock()
        defer { lock.unlock() }
        return withdrawn
    }

    func presentApprovalBanner(card: Notifications.ApprovalFeedCard) async {
        lock.withLock { presented.append(card.requestID) }
    }

    func withdrawApprovalBanner(requestID: String) async {
        lock.withLock { withdrawn.append(requestID) }
    }
}

private struct ApprovalFeedNoopPromptSubmitter: AgentInteraction.AgentPromptSubmitting {
    func submitAgentPrompt(_ request: AgentInteraction.ServerPromptRequest) async throws -> AgentInteraction.ServerPromptAccepted {
        throw AgentInteraction.AgentInteractionError.unavailable
    }
}
