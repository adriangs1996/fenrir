import Foundation

public extension Diagnostics {
    struct DiagnosticsOverlayViewModel: Codable, Equatable, Sendable {
        public let title: String
        public let subtitle: String
        public let rows: [String]

        public init(report: DiagnosticsReport) {
            title = "Diagnostics"
            subtitle = report.redactionNotice
            rows = DiagnosticCategory.allCases.map { category in
                let count = report.categoryCounts[category, default: 0]
                return "\(category.displayName): \(count)"
            }
        }
    }
}

private extension Diagnostics.DiagnosticCategory {
    var displayName: String {
        switch self {
        case .serverConnection:
            "Server connection"
        case .tmuxKernel:
            "tmux kernel"
        case .workflow:
            "Workflow"
        case .keybinding:
            "Keybinding"
        case .nativeRuntime:
            "Native runtime"
        case .terminalViewport:
            "Terminal viewport"
        case .nativeShell:
            "Native shell"
        case .crashReport:
            "Crash report"
        }
    }
}
