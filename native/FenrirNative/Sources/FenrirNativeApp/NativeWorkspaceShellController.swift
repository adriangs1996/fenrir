import Foundation
import FenrirNativeShared
import PaneGrid
import WorkspaceIndex
import WorkspaceOverlays

enum NativeWorkspaceFocusSurface: Equatable, Sendable {
    case terminal(PaneID?)
    case sidebar
    case overlay(WorkspaceOverlays.OverlayID)
    case commandPalette
}

struct NativeReconnectBannerState: Equatable, Sendable {
    let message: String
    let isBlocking: Bool

    init(message: String, isBlocking: Bool = false) {
        self.message = message
        self.isBlocking = isBlocking
    }
}

struct NativeWorkspaceShellState: Equatable, Sendable {
    let workspaceID: WorkspaceID
    let nativeWindowID: FenrirWindowID
    var paneGridState: PaneGrid.State
    var isSidebarVisible: Bool
    var sidebarItems: [WorkspaceIndex.WorkspaceSidebarItem]
    var paletteFileItems: [WorkspaceOverlays.PaletteItem]
    var focusedSurface: NativeWorkspaceFocusSurface
    var activeOverlayIDs: [WorkspaceOverlays.OverlayID]
    var reconnectBanner: NativeReconnectBannerState?

    init(
        workspaceID: WorkspaceID,
        nativeWindowID: FenrirWindowID,
        paneGridState: PaneGrid.State,
        isSidebarVisible: Bool = true,
        sidebarItems: [WorkspaceIndex.WorkspaceSidebarItem] = [],
        paletteFileItems: [WorkspaceOverlays.PaletteItem] = [],
        focusedSurface: NativeWorkspaceFocusSurface = .terminal(nil),
        activeOverlayIDs: [WorkspaceOverlays.OverlayID] = [],
        reconnectBanner: NativeReconnectBannerState? = nil
    ) {
        self.workspaceID = workspaceID
        self.nativeWindowID = nativeWindowID
        self.paneGridState = paneGridState
        self.isSidebarVisible = isSidebarVisible
        self.sidebarItems = sidebarItems
        self.paletteFileItems = paletteFileItems
        self.focusedSurface = focusedSurface
        self.activeOverlayIDs = activeOverlayIDs
        self.reconnectBanner = reconnectBanner
    }
}

struct NativeWorkspaceShellController: Sendable {
    private(set) var state: NativeWorkspaceShellState
    private var focusReturnStack: [NativeWorkspaceFocusSurface]

    init(state: NativeWorkspaceShellState) {
        self.state = state
        focusReturnStack = []
    }

    mutating func updateSidebar(_ projection: WorkspaceIndex.WorkspaceSidebarProjection) {
        state.sidebarItems = projection.items
    }

    mutating func updateWorkspaceNotifications(_ notifications: WorkspaceIndex.WorkspaceNotificationState) {
        state.sidebarItems = state.sidebarItems.map { item in
            guard item.workspaceID == state.workspaceID else {
                return item
            }
            return WorkspaceIndex.WorkspaceSidebarItem(summary: WorkspaceIndex.WorkspaceSummary(
                workspaceID: item.workspaceID,
                displayName: item.displayName,
                canonicalPath: item.canonicalPath,
                isFavorite: item.isFavorite,
                isOpenLocally: item.isOpenLocally,
                visibility: item.visibility,
                notifications: notifications,
                lastFocusedAt: item.lastFocusedAt,
                status: item.status
            ))
        }
    }

    mutating func updatePaneGrid(_ paneGridState: PaneGrid.State) {
        state.paneGridState = paneGridState
        if case .terminal(let paneID) = state.focusedSurface,
           let paneID,
           !paneGridState.windows.flatMap(\.panes).map(\.paneID).contains(paneID)
        {
            let activePaneID = paneGridState.windows
                .first { $0.windowID == paneGridState.activeWindowID }?
                .activePaneID
            state.focusedSurface = .terminal(activePaneID)
        }
    }

    mutating func toggleSidebarVisibility() {
        state.isSidebarVisible.toggle()
        if !state.isSidebarVisible {
            focusReturnStack.removeAll { $0 == .sidebar }
            if state.focusedSurface == .sidebar {
                state.focusedSurface = .terminal(nil)
            }
        }
    }

    mutating func focusSidebar() {
        guard state.isSidebarVisible, !state.focusedSurface.isModalCapture else {
            return
        }
        state.focusedSurface = .sidebar
    }

    mutating func focusTerminal(paneID: PaneID? = nil) {
        focusReturnStack.removeAll()
        state.focusedSurface = .terminal(paneID)
    }

    mutating func presentOverlay(_ overlayID: WorkspaceOverlays.OverlayID) {
        captureCurrentFocusIfNeeded(excluding: .overlay(overlayID))
        if !state.activeOverlayIDs.contains(overlayID) {
            state.activeOverlayIDs.append(overlayID)
        }
        state.focusedSurface = .overlay(overlayID)
    }

    mutating func closeOverlay(_ overlayID: WorkspaceOverlays.OverlayID) {
        state.activeOverlayIDs.removeAll { $0 == overlayID }
        focusReturnStack.removeAll { $0 == .overlay(overlayID) }
        guard state.focusedSurface == .overlay(overlayID) else {
            return
        }
        restoreFocus()
    }

    mutating func presentCommandPalette() {
        captureCurrentFocusIfNeeded(excluding: .commandPalette)
        state.focusedSurface = .commandPalette
    }

    mutating func dismissCommandPalette() {
        guard state.focusedSurface == .commandPalette else {
            return
        }
        restoreFocus()
    }

    mutating func setReconnectBanner(_ banner: NativeReconnectBannerState?) {
        state.reconnectBanner = banner
    }

    private mutating func captureCurrentFocusIfNeeded(excluding excluded: NativeWorkspaceFocusSurface) {
        guard state.focusedSurface != excluded else {
            return
        }
        focusReturnStack.append(state.focusedSurface)
    }

    private mutating func restoreFocus() {
        while let candidate = focusReturnStack.popLast() {
            if candidate == .sidebar, !state.isSidebarVisible {
                continue
            }
            if case let .overlay(overlayID) = candidate, !state.activeOverlayIDs.contains(overlayID) {
                continue
            }
            state.focusedSurface = candidate
            return
        }
        state.focusedSurface = .terminal(nil)
    }
}

private extension NativeWorkspaceFocusSurface {
    var isModalCapture: Bool {
        switch self {
        case .overlay, .commandPalette:
            return true
        case .terminal, .sidebar:
            return false
        }
    }
}
