// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "FenrirNative",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "FenrirNativeFoundation",
            targets: [
                "FenrirNativeShared",
                "AuthSession",
                "ServerConnection",
                "NativeRuntime",
                "TerminalViewport",
                "PaneGrid",
                "WorkspaceIndex",
                "WorkspaceShell",
                "WorkspaceCoordinator",
                "ClientControl",
                "Settings",
                "Keybinding",
                "Notifications",
                "WorkspaceOverlays",
                "AgentInteraction",
                "WorkflowControl",
                "Diagnostics",
                "NativeDistribution",
                "NeovimBridge"
            ]
        ),
        .executable(
            name: "FenrirNativeApp",
            targets: ["FenrirNativeApp"]
        )
    ],
    targets: [
        .target(
            name: "Settings",
            dependencies: ["FenrirNativeShared"],
            path: "Sources/FenrirNativeFoundation/Modules/Settings",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "Keybinding",
            dependencies: ["FenrirNativeShared", "Settings"],
            path: "Sources/FenrirNativeFoundation/Modules/Keybinding",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "Notifications",
            dependencies: ["FenrirNativeShared", "Settings"],
            path: "Sources/FenrirNativeFoundation/Modules/Notifications",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "WorkspaceOverlays",
            dependencies: ["FenrirNativeShared", "Keybinding", "Notifications"],
            path: "Sources/FenrirNativeFoundation/Modules/WorkspaceOverlays",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "AgentInteraction",
            dependencies: ["FenrirNativeShared", "WorkspaceOverlays", "Notifications"],
            path: "Sources/FenrirNativeFoundation/Modules/AgentInteraction",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "WorkflowControl",
            dependencies: ["FenrirNativeShared", "WorkspaceOverlays", "Notifications", "NativeRuntime"],
            path: "Sources/FenrirNativeFoundation/Modules/WorkflowControl",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "Diagnostics",
            dependencies: ["FenrirNativeShared", "Settings", "WorkspaceOverlays"],
            path: "Sources/FenrirNativeFoundation/Modules/Diagnostics",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "NativeDistribution",
            dependencies: ["FenrirNativeShared"],
            path: "Sources/FenrirNativeFoundation/Modules/NativeDistribution",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "NeovimBridge",
            dependencies: ["FenrirNativeShared", "NativeRuntime", "WorkspaceOverlays"],
            path: "Sources/FenrirNativeFoundation/Modules/NeovimBridge",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "FenrirNativeShared",
            path: "Sources/FenrirNativeFoundation/Shared"
        ),
        .target(
            name: "AuthSession",
            dependencies: ["FenrirNativeShared"],
            path: "Sources/FenrirNativeFoundation/Modules/AuthSession",
            exclude: [
                "MODULE.md",
                "__tests__"
            ]
        ),
        .target(
            name: "ServerConnection",
            dependencies: ["FenrirNativeShared", "AuthSession"],
            path: "Sources/FenrirNativeFoundation/Modules/ServerConnection",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "NativeRuntime",
            dependencies: ["FenrirNativeShared"],
            path: "Sources/FenrirNativeFoundation/Modules/NativeRuntime",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "TerminalViewport",
            dependencies: ["FenrirNativeShared", "NativeRuntime", "Keybinding"],
            path: "Sources/FenrirNativeFoundation/Modules/TerminalViewport",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "PaneGrid",
            dependencies: ["FenrirNativeShared", "NativeRuntime", "Keybinding", "TerminalViewport"],
            path: "Sources/FenrirNativeFoundation/Modules/PaneGrid",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "WorkspaceIndex",
            dependencies: ["FenrirNativeShared", "Settings", "ServerConnection"],
            path: "Sources/FenrirNativeFoundation/Modules/WorkspaceIndex",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "WorkspaceShell",
            dependencies: [
                "FenrirNativeShared",
                "PaneGrid",
                "WorkspaceIndex",
                "WorkspaceOverlays",
                "WorkflowControl",
                "AgentInteraction",
                "Keybinding",
                "Notifications"
            ],
            path: "Sources/FenrirNativeFoundation/Modules/WorkspaceShell",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "WorkspaceCoordinator",
            dependencies: ["FenrirNativeShared", "WorkspaceIndex", "ServerConnection", "NativeRuntime", "PaneGrid", "TerminalViewport"],
            path: "Sources/FenrirNativeFoundation/Modules/WorkspaceCoordinator",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "ClientControl",
            dependencies: ["FenrirNativeShared", "WorkspaceIndex", "WorkspaceCoordinator"],
            path: "Sources/FenrirNativeFoundation/Modules/ClientControl",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .executableTarget(
            name: "FenrirNativeApp",
            dependencies: [
                "FenrirNativeShared",
                "AuthSession",
                "ServerConnection",
                "NativeRuntime",
                "TerminalViewport",
                "PaneGrid",
                "WorkspaceIndex",
                "WorkspaceShell",
                "WorkspaceCoordinator",
                "ClientControl",
                "Settings",
                "Keybinding",
                "Notifications",
                "WorkspaceOverlays",
                "AgentInteraction",
                "WorkflowControl",
                "Diagnostics",
                "NativeDistribution",
                "NeovimBridge"
            ],
            path: "Sources/FenrirNativeApp"
        ),
        .testTarget(
            name: "FenrirNativeFoundationTests",
            dependencies: [
                "FenrirNativeShared",
                "AuthSession",
                "ServerConnection",
                "NativeRuntime",
                "TerminalViewport",
                "PaneGrid",
                "WorkspaceIndex",
                "WorkspaceShell",
                "WorkspaceCoordinator",
                "ClientControl",
                "Settings",
                "Keybinding",
                "Notifications",
                "WorkspaceOverlays",
                "AgentInteraction",
                "WorkflowControl",
                "Diagnostics",
                "NativeDistribution",
                "NeovimBridge",
                "FenrirNativeApp"
            ],
            path: "Tests/FenrirNativeFoundationTests"
        )
    ]
)
