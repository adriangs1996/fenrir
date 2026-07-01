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
                "ClientControl"
            ]
        ),
        .executable(
            name: "FenrirNativeApp",
            targets: ["FenrirNativeApp"]
        )
    ],
    targets: [
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
            dependencies: ["FenrirNativeShared", "NativeRuntime"],
            path: "Sources/FenrirNativeFoundation/Modules/TerminalViewport",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "PaneGrid",
            dependencies: ["FenrirNativeShared"],
            path: "Sources/FenrirNativeFoundation/Modules/PaneGrid",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "WorkspaceIndex",
            dependencies: ["FenrirNativeShared"],
            path: "Sources/FenrirNativeFoundation/Modules/WorkspaceIndex",
            exclude: ["MODULE.md", "__tests__"]
        ),
        .target(
            name: "WorkspaceShell",
            dependencies: ["FenrirNativeShared", "WorkspaceIndex"],
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
                "ClientControl"
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
                "FenrirNativeApp"
            ],
            path: "Tests/FenrirNativeFoundationTests"
        )
    ]
)
