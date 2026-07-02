import Foundation
import Testing
import FenrirNativeShared
import Keybinding
import WorkspaceOverlays

@Suite("WorkspaceOverlays module registration")
struct WorkspaceOverlaysTests {
    @Test("DescribeWorkspaceOverlaysModule exposes the WorkspaceOverlays target")
    func describeModule() async throws {
        let action = WorkspaceOverlays.DescribeWorkspaceOverlaysModule(clock: FixedClock())

        let result = try await action.run(.init(requestID: "workspace-overlays", source: .test)).get()

        #expect(result.summary.moduleName == "WorkspaceOverlays")
        #expect(result.requestID == "workspace-overlays")
    }

    @Test("OpenOverlay stacks overlays deterministically by workspace")
    func openOverlayStacksByWorkspace() async throws {
        let store = WorkspaceOverlays.inMemoryOverlayStore()
        let action = WorkspaceOverlays.OpenOverlay(clock: FixedClock(), store: store)

        let composer = try await action.run(.init(
            requestID: "open-composer",
            workspaceID: "workspace-a",
            descriptor: .init(kind: .agentComposer, title: "Agent"),
            source: .test
        )).get()
        let workflow = try await action.run(.init(
            requestID: "open-workflow",
            workspaceID: "workspace-a",
            descriptor: .init(kind: .workflowPanel, title: "Workflow"),
            source: .test
        )).get()

        #expect(workflow.stack.overlays.map(\.descriptor.kind) == [.agentComposer, .workflowPanel])
        #expect(workflow.stack.focusedOverlayID == workflow.overlay.id)
        #expect(composer.overlay.workspaceID == "workspace-a")
    }

    @Test("Modal overlays are exclusive and preserve stackable overlays")
    func modalOverlaysAreExclusive() async throws {
        let store = WorkspaceOverlays.inMemoryOverlayStore()
        let open = WorkspaceOverlays.OpenOverlay(clock: FixedClock(), store: store)

        _ = try await open.run(.init(
            requestID: "open-diagnostics",
            workspaceID: "workspace-a",
            descriptor: .init(kind: .diagnostics, title: "Diagnostics"),
            source: .test
        )).get()
        let palette = try await open.run(.init(
            requestID: "open-palette",
            workspaceID: "workspace-a",
            descriptor: .init(kind: .commandPalette, title: "Command Palette"),
            source: .test
        )).get()
        let modal = try await open.run(.init(
            requestID: "open-modal",
            workspaceID: "workspace-a",
            descriptor: .init(kind: .transientModal, title: "Confirm"),
            source: .test
        )).get()

        #expect(palette.stack.overlays.map(\.descriptor.kind) == [.diagnostics, .commandPalette])
        #expect(modal.stack.overlays.map(\.descriptor.kind) == [.diagnostics, .transientModal])
        #expect(modal.stack.focusedOverlay?.descriptor.kind == .transientModal)
    }

    @Test("ToggleOverlay opens missing overlay and closes existing overlay")
    func toggleOverlayOpensAndCloses() async throws {
        let store = WorkspaceOverlays.inMemoryOverlayStore()
        let toggle = WorkspaceOverlays.ToggleOverlay(clock: FixedClock(), store: store)

        let opened = try await toggle.run(.init(
            requestID: "toggle-open",
            workspaceID: "workspace-a",
            descriptor: .init(kind: .commandPalette, title: "Command Palette"),
            source: .test
        )).get()
        let closed = try await toggle.run(.init(
            requestID: "toggle-close",
            workspaceID: "workspace-a",
            descriptor: .init(kind: .commandPalette, title: "Command Palette"),
            source: .test
        )).get()

        #expect(opened.openedOverlay?.descriptor.kind == .commandPalette)
        #expect(opened.closedOverlay == nil)
        #expect(closed.openedOverlay == nil)
        #expect(closed.closedOverlay?.id == opened.openedOverlay?.id)
        #expect(closed.stack.overlays.isEmpty)
    }

    @Test("CloseOverlay reveals previous overlay focus")
    func closeOverlayRevealsPreviousFocus() async throws {
        let store = WorkspaceOverlays.inMemoryOverlayStore()
        let open = WorkspaceOverlays.OpenOverlay(clock: FixedClock(), store: store)
        let close = WorkspaceOverlays.CloseOverlay(clock: FixedClock(), store: store)

        let composer = try await open.run(.init(
            requestID: "open-composer",
            workspaceID: "workspace-a",
            descriptor: .init(kind: .agentComposer, title: "Agent"),
            source: .test
        )).get()
        let workflow = try await open.run(.init(
            requestID: "open-workflow",
            workspaceID: "workspace-a",
            descriptor: .init(kind: .workflowPanel, title: "Workflow"),
            source: .test
        )).get()
        let closed = try await close.run(.init(
            requestID: "close-top",
            workspaceID: "workspace-a",
            source: .test
        )).get()

        #expect(closed.closedOverlay?.id == workflow.overlay.id)
        #expect(closed.stack.focusedOverlayID == composer.overlay.id)
        #expect(closed.stack.overlays.map(\.descriptor.kind) == [.agentComposer])
    }

    @Test("Workspace overlay stacks are scoped and restored after workspace switch")
    func workspaceOverlayStacksRestoreAfterSwitch() async throws {
        let store = WorkspaceOverlays.inMemoryOverlayStore()
        let open = WorkspaceOverlays.OpenOverlay(clock: FixedClock(), store: store)
        let restore = WorkspaceOverlays.RestoreWorkspaceOverlays(clock: FixedClock(), store: store)

        let workspaceA = try await open.run(.init(
            requestID: "open-a",
            workspaceID: "workspace-a",
            descriptor: .init(kind: .agentComposer, title: "Agent"),
            source: .test
        )).get()
        let workspaceB = try await open.run(.init(
            requestID: "open-b",
            workspaceID: "workspace-b",
            descriptor: .init(kind: .diagnostics, title: "Diagnostics"),
            source: .test
        )).get()

        let restoredA = try await restore.run(.init(
            requestID: "restore-a",
            workspaceID: "workspace-a",
            source: .test
        )).get()
        let restoredB = try await restore.run(.init(
            requestID: "restore-b",
            workspaceID: "workspace-b",
            source: .test
        )).get()

        #expect(restoredA.stack.overlays.map(\.id) == [workspaceA.overlay.id])
        #expect(restoredA.stack.focusedOverlayID == workspaceA.overlay.id)
        #expect(restoredB.stack.overlays.map(\.id) == [workspaceB.overlay.id])
        #expect(restoredB.stack.focusedOverlayID == workspaceB.overlay.id)
    }

    @Test("WorkspaceOverlays contracts and actions do not import UI frameworks")
    func contractsAndActionsDoNotImportUIFrameworks() throws {
        let root = URL(filePath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appending(path: "Sources/FenrirNativeFoundation/Modules/WorkspaceOverlays")
        let checkedFiles = [
            root.appending(path: "Contracts/WorkspaceOverlaysContracts.swift"),
            root.appending(path: "Actions/WorkspaceOverlaysActions.swift")
        ]

        for file in checkedFiles {
            let contents = try String(contentsOf: file)
            #expect(!contents.contains("import AppKit"))
            #expect(!contents.contains("import SwiftUI"))
        }
    }

    @Test("WorkspaceOverlays services do not expose model state")
    func servicesDoNotExposeModelState() throws {
        let services = URL(filePath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appending(path: "Sources/FenrirNativeFoundation/Modules/WorkspaceOverlays/Services/WorkspaceOverlaysServices.swift")

        let contents = try String(contentsOf: services)
        #expect(!contents.contains("WorkspaceOverlaysState"))
    }

    @Test("Command palette ranks workspace switcher results")
    func commandPaletteRanksWorkspaceSwitcherResults() async throws {
        let provider = WorkspaceOverlays.workspaceSwitcherProvider(workspaces: [
            .init(workspaceID: "app", title: "Fenrir App", subtitle: "/repo/app", keywords: ["native"], recencyRank: 3),
            .init(workspaceID: "server", title: "Fenrir Server", subtitle: "/repo/server", keywords: ["api"], isActive: true, recencyRank: 1),
            .init(workspaceID: "docs", title: "Docs", subtitle: "/repo/docs", keywords: ["fenrir"], recencyRank: 2)
        ])
        let search = WorkspaceOverlays.SearchCommandPalette(clock: FixedClock(), providers: [provider])

        let result = try await search.run(.init(
            requestID: "palette.search",
            workspaceID: "app",
            rawText: "fenrir",
            source: .test
        )).get()

        #expect(result.query.domain == .workspaces)
        #expect(result.items.map(\.item.id) == ["workspace:server", "workspace:app", "workspace:docs"])
        #expect(result.items.first?.item.action == .switchWorkspace("server"))
    }

    @Test("Palette prefixes route to provider sets")
    func palettePrefixesRouteToProviderSets() async throws {
        let provider = WorkspaceOverlays.staticPaletteProvider(
            providerID: "static",
            domains: [.actions, .files, .panes, .workflows, .help],
            items: [
                .init(id: "action:build", domain: .actions, title: "Build Project", action: .runAction("build")),
                .init(id: "file:main", domain: .files, title: "main.swift", action: .openFile("main.swift")),
                .init(id: "pane:logs", domain: .panes, title: "Logs Pane", action: .focusPane("pane-logs")),
                .init(id: "workflow:deploy", domain: .workflows, title: "Deploy Workflow", action: .openWorkflow("deploy")),
                .init(id: "help:keys", domain: .help, title: "Keybindings", action: .openHelp("keybindings"))
            ]
        )
        let search = WorkspaceOverlays.SearchCommandPalette(clock: FixedClock(), providers: [provider])

        let action = try await paletteIDs(search, rawText: "@ build")
        let file = try await paletteIDs(search, rawText: "$ main")
        let pane = try await paletteIDs(search, rawText: "% logs")
        let workflow = try await paletteIDs(search, rawText: "! deploy")
        let help = try await paletteIDs(search, rawText: "? key")

        #expect(action == ["action:build"])
        #expect(file == ["file:main"])
        #expect(pane == ["pane:logs"])
        #expect(workflow == ["workflow:deploy"])
        #expect(help == ["help:keys"])
    }

    @Test("Command palette returns empty results without fallback execution")
    func commandPaletteEmptyResults() async throws {
        let provider = WorkspaceOverlays.staticPaletteProvider(
            providerID: "actions",
            domains: [.actions],
            items: [.init(id: "action:build", domain: .actions, title: "Build Project", action: .runAction("build"))]
        )
        let search = WorkspaceOverlays.SearchCommandPalette(clock: FixedClock(), providers: [provider])

        let result = try await search.run(.init(
            requestID: "palette.search",
            workspaceID: "app",
            rawText: "@ missing",
            source: .test
        )).get()

        #expect(result.query.prefix == .agent)
        #expect(result.items.isEmpty)
    }

    @Test("Command palette caps high-volume provider results deterministically")
    func commandPaletteCapsHighVolumeProviderResults() async throws {
        let items = (0..<200).map { index in
            WorkspaceOverlays.PaletteItem(
                id: "action:\(index)",
                domain: .actions,
                title: "Build Target \(index)",
                keywords: ["build"],
                action: .runAction("build-\(index)"),
                baseScore: 200 - index
            )
        }
        let provider = WorkspaceOverlays.staticPaletteProvider(providerID: "actions", domains: [.actions], items: items)
        let search = WorkspaceOverlays.SearchCommandPalette(clock: FixedClock(), providers: [provider])

        let result = try await search.run(.init(
            requestID: "palette.search",
            workspaceID: "app",
            rawText: "@ build",
            maxResults: 20,
            source: .test
        )).get()

        #expect(result.items.count == 20)
        #expect(result.items.first?.item.id == "action:0")
        #expect(result.items.last?.item.id == "action:19")
    }

    @Test("Command palette uses bounded provider search path")
    func commandPaletteUsesBoundedProviderSearchPath() async throws {
        let provider = BoundedCountingPaletteProvider(totalItems: 500)
        let search = WorkspaceOverlays.SearchCommandPalette(clock: FixedClock(), providers: [provider])

        let result = try await search.run(.init(
            requestID: "palette.search",
            workspaceID: "app",
            rawText: "@ build",
            maxResults: 15,
            source: .test
        )).get()

        #expect(result.items.count == 15)
        #expect(await provider.boundedCalls == [15])
        #expect(await provider.unboundedCallCount == 0)
        #expect(await provider.materializedCount == 15)
    }

    @Test("Cmd+P opens the default workspace switcher")
    func commandPOpensDefaultWorkspaceSwitcher() async throws {
        let keymap = try await Keybinding.ImportTmuxKeymap(clock: FixedClock()).run(.init(
            requestID: "keybinding.import",
            source: .test,
            keymap: .init(bindings: [])
        )).get().importedMap
        let provider = WorkspaceOverlays.workspaceSwitcherProvider(workspaces: [
            .init(workspaceID: "app", title: "Fenrir App")
        ])
        let search = WorkspaceOverlays.SearchCommandPalette(clock: FixedClock(), providers: [provider])

        #expect(keymap.binding(for: .native(.command("p")))?.action == .openPalette(prefix: nil))

        let result = try await search.run(.init(
            requestID: "palette.search",
            workspaceID: "app",
            rawText: "",
            source: .test
        )).get()

        #expect(result.query.domain == .workspaces)
        #expect(result.items.map(\.item.action) == [.switchWorkspace("app")])
    }

    @Test("ExecutePaletteSelection dispatches the selected action")
    func executePaletteSelectionDispatchesAction() async throws {
        let executor = RecordingPaletteExecutor()
        let action = WorkspaceOverlays.ExecutePaletteSelection(clock: FixedClock(), executor: executor)
        let item = WorkspaceOverlays.PaletteItem(
            id: "workflow:deploy",
            domain: .workflows,
            title: "Deploy Workflow",
            action: .openWorkflow("deploy")
        )

        let result = try await action.run(.init(
            requestID: "palette.execute",
            workspaceID: "app",
            item: item,
            source: .test
        )).get()

        #expect(result.executedAction == .openWorkflow("deploy"))
        #expect(await executor.executedActions == [.openWorkflow("deploy")])
    }

    private func paletteIDs(
        _ search: WorkspaceOverlays.SearchCommandPalette,
        rawText: String
    ) async throws -> [String] {
        try await search.run(.init(
            requestID: "palette.search",
            workspaceID: "app",
            rawText: rawText,
            source: .test
        )).get().items.map(\.item.id)
    }
}

private actor RecordingPaletteExecutor: WorkspaceOverlays.PaletteActionExecutor {
    private var actions: [WorkspaceOverlays.PaletteAction] = []

    var executedActions: [WorkspaceOverlays.PaletteAction] {
        actions
    }

    func executePaletteAction(
        _ action: WorkspaceOverlays.PaletteAction,
        workspaceID _: WorkspaceID,
        source _: ActionSource
    ) async throws {
        actions.append(action)
    }
}

private actor BoundedCountingPaletteProvider: WorkspaceOverlays.BoundedPaletteSearchProvider {
    let providerID = "bounded-counting"
    let domains: Set<WorkspaceOverlays.PaletteDomain> = [.actions]
    private let totalItems: Int
    private(set) var boundedCalls: [Int] = []
    private(set) var unboundedCallCount = 0
    private(set) var materializedCount = 0

    init(totalItems: Int) {
        self.totalItems = totalItems
    }

    func searchPalette(
        query: WorkspaceOverlays.PaletteQuery,
        workspaceID: WorkspaceID
    ) async throws -> [WorkspaceOverlays.PaletteItem] {
        unboundedCallCount += 1
        return makeItems(count: totalItems)
    }

    func searchPalette(
        query: WorkspaceOverlays.PaletteQuery,
        workspaceID: WorkspaceID,
        maxResults: Int
    ) async throws -> [WorkspaceOverlays.PaletteItem] {
        boundedCalls.append(maxResults)
        let count = min(totalItems, maxResults)
        materializedCount += count
        return makeItems(count: count)
    }

    private func makeItems(count: Int) -> [WorkspaceOverlays.PaletteItem] {
        (0..<count).map { index in
            WorkspaceOverlays.PaletteItem(
                id: "action:\(index)",
                domain: .actions,
                title: "Build Target \(index)",
                keywords: ["build"],
                action: .runAction("build-\(index)"),
                baseScore: count - index
            )
        }
    }
}
