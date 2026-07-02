import Foundation
import Testing
import FenrirNativeShared
import Settings
import WorkspaceOverlays
import Diagnostics

@Suite("Diagnostics module")
struct DiagnosticsTests {
    @Test("DescribeDiagnosticsModule exposes the Diagnostics target")
    func describeModule() async throws {
        let action = Diagnostics.DescribeDiagnosticsModule(clock: FixedClock())

        let result = try await action.run(.init(requestID: "diagnostics", source: .test)).get()

        #expect(result.summary.moduleName == "Diagnostics")
        #expect(result.requestID == "diagnostics")
    }

    @Test("Support bundle redaction removes secrets and terminal content by default")
    func supportBundleRedactionRemovesSecretsAndTerminalContentByDefault() async throws {
        let store = Diagnostics.inMemoryDiagnosticsStore()
        let record = Diagnostics.RecordDiagnosticEvent(
            clock: FixedClock(),
            store: store,
            redactor: Diagnostics.supportBundleRedactor()
        )
        let report = Diagnostics.BuildDiagnosticsReport(clock: FixedClock(), store: store)

        let event = diagnosticEvent(
            category: .serverConnection,
            severity: .error,
            message: "Reconnect failed with bearer abc.def.ghi and token=plain-secret",
            metadata: [
                "url": "wss://user:pass@example.test/ws",
                "httpURL": "https://user:pass@example.test/api",
                "authToken": "plain-secret",
                "request": "apiKey=abc123"
            ],
            terminalContent: "user shell output password=from-terminal"
        )

        let recorded = try await record.run(.init(requestID: "record", event: event, source: .test)).get()
        let result = try await report.run(.init(requestID: "report", source: .test)).get()

        #expect(recorded.recorded)
        #expect(result.report.events.count == 1)
        #expect(result.report.events[0].message == "Reconnect failed with bearer [redacted] and token=[redacted]")
        #expect(result.report.events[0].metadata["url"] == "wss://[redacted]@example.test/ws")
        #expect(result.report.events[0].metadata["httpURL"] == "https://[redacted]@example.test/api")
        #expect(result.report.events[0].metadata["authToken"] == "[redacted]")
        #expect(result.report.events[0].metadata["request"] == "apiKey=[redacted]")
        #expect(result.report.events[0].terminalContentSummary == "[redacted terminal content]")
        #expect(!String(describing: result.report).contains("from-terminal"))
    }

    @Test("Default report policy redacts terminal content recorded under prior opt-in")
    func defaultReportPolicyRedactsPreviouslyOptedInTerminalContent() async throws {
        let store = Diagnostics.inMemoryDiagnosticsStore()
        let record = Diagnostics.RecordDiagnosticEvent(
            clock: FixedClock(),
            store: store,
            redactor: Diagnostics.supportBundleRedactor()
        )
        let report = Diagnostics.BuildDiagnosticsReport(clock: FixedClock(), store: store)
        let optInPolicy = Diagnostics.DiagnosticsPolicy(
            detailLevel: .verboseLocal,
            includeTerminalContent: true
        )

        let event = diagnosticEvent(
            category: .terminalViewport,
            severity: .error,
            terminalContent: "terminal output that should not appear by default"
        )

        let recorded = try await record.run(.init(
            requestID: "record",
            event: event,
            policy: optInPolicy,
            source: .test
        )).get()
        let defaultReport = try await report.run(.init(requestID: "report", source: .test)).get()

        #expect(recorded.event?.terminalContentSummary == "terminal output that should not appear by default")
        #expect(defaultReport.report.events.count == 1)
        #expect(defaultReport.report.events[0].terminalContentSummary == "[redacted terminal content]")
        #expect(!String(describing: defaultReport.report).contains("should not appear"))
    }

    @Test("Diagnostics categorizes server, tmux, workflow, and keybinding events")
    func diagnosticsCategorizesOperationalEvents() async throws {
        let store = Diagnostics.inMemoryDiagnosticsStore()
        let record = Diagnostics.RecordDiagnosticEvent(
            clock: FixedClock(),
            store: store,
            redactor: Diagnostics.supportBundleRedactor()
        )
        let report = Diagnostics.BuildDiagnosticsReport(clock: FixedClock(), store: store)

        for category in [
            Diagnostics.DiagnosticCategory.serverConnection,
            .tmuxKernel,
            .workflow,
            .keybinding
        ] {
            _ = try await record.run(.init(
                requestID: RequestID(rawValue: "record-\(category.rawValue)"),
                event: diagnosticEvent(category: category, severity: .warning),
                source: .test
            )).get()
        }

        let result = try await report.run(.init(requestID: "report", source: .test)).get()

        #expect(result.report.categoryCounts[.serverConnection] == 1)
        #expect(result.report.categoryCounts[.tmuxKernel] == 1)
        #expect(result.report.categoryCounts[.workflow] == 1)
        #expect(result.report.categoryCounts[.keybinding] == 1)
    }

    @Test("Disabled diagnostics do not record events or expose report contents")
    func disabledDiagnosticsDoNotRecordEventsOrExposeReportContents() async throws {
        let store = Diagnostics.inMemoryDiagnosticsStore()
        let policy = Diagnostics.DiagnosticsPolicy(
            detailLevel: .off,
            persistLocalLogs: false,
            includeTerminalContent: false
        )
        let record = Diagnostics.RecordDiagnosticEvent(
            clock: FixedClock(),
            store: store,
            redactor: Diagnostics.supportBundleRedactor()
        )
        let report = Diagnostics.BuildDiagnosticsReport(clock: FixedClock(), store: store)

        let recorded = try await record.run(.init(
            requestID: "record",
            event: diagnosticEvent(category: .tmuxKernel, severity: .error),
            policy: policy,
            source: .test
        )).get()
        let result = try await report.run(.init(requestID: "report", policy: policy, source: .test)).get()

        #expect(!recorded.recorded)
        #expect(recorded.event == nil)
        #expect(result.report.events.isEmpty)
        #expect(result.report.redactionNotice == "Diagnostics are disabled.")
    }

    @Test("Non-persistent diagnostics policy does not retain local events")
    func nonPersistentDiagnosticsPolicyDoesNotRetainLocalEvents() async throws {
        let store = Diagnostics.inMemoryDiagnosticsStore()
        let policy = Diagnostics.DiagnosticsPolicy(
            detailLevel: .verboseLocal,
            persistLocalLogs: false,
            includeTerminalContent: false
        )
        let record = Diagnostics.RecordDiagnosticEvent(
            clock: FixedClock(),
            store: store,
            redactor: Diagnostics.supportBundleRedactor()
        )
        let report = Diagnostics.BuildDiagnosticsReport(clock: FixedClock(), store: store)

        let recorded = try await record.run(.init(
            requestID: "record",
            event: diagnosticEvent(category: .serverConnection, severity: .error),
            policy: policy,
            source: .test
        )).get()
        let result = try await report.run(.init(requestID: "report", policy: .init(detailLevel: .verboseLocal), source: .test)).get()

        #expect(!recorded.recorded)
        #expect(recorded.event == nil)
        #expect(result.report.events.isEmpty)
    }

    @Test("Verbose local policy records info while errors-only skips info")
    func diagnosticsPolicyFiltersByDetailLevel() async throws {
        let errorsOnlyStore = Diagnostics.inMemoryDiagnosticsStore()
        let verboseStore = Diagnostics.inMemoryDiagnosticsStore()
        let event = diagnosticEvent(category: .nativeRuntime, severity: .info)

        let errorsOnly = Diagnostics.RecordDiagnosticEvent(
            clock: FixedClock(),
            store: errorsOnlyStore,
            redactor: Diagnostics.supportBundleRedactor()
        )
        let verbose = Diagnostics.RecordDiagnosticEvent(
            clock: FixedClock(),
            store: verboseStore,
            redactor: Diagnostics.supportBundleRedactor()
        )

        let skipped = try await errorsOnly.run(.init(requestID: "skip", event: event, source: .test)).get()
        let recorded = try await verbose.run(.init(
            requestID: "record",
            event: event,
            policy: .init(detailLevel: .verboseLocal),
            source: .test
        )).get()

        #expect(!skipped.recorded)
        #expect(recorded.recorded)
    }

    @Test("Diagnostics are accessible through command palette actions")
    func diagnosticsAreAccessibleThroughCommandPaletteActions() async throws {
        let provider = Diagnostics.paletteProvider()

        let items = try await provider.searchPalette(
            query: WorkspaceOverlays.PaletteQuery(
                rawText: "@ diag",
                domain: .actions,
                searchText: "diag",
                prefix: nil
            ),
            workspaceID: "workspace-a"
        )

        #expect(items.map(\.action).contains(.openDiagnostics))
        #expect(items.first?.id == "action-diagnostics")
    }

    @Test("Diagnostics view model exposes safe overlay rows")
    func diagnosticsViewModelExposesSafeOverlayRows() async throws {
        let report = Diagnostics.DiagnosticsReport(
            generatedAt: FixedClock().now(),
            policy: .defaults,
            events: [],
            categoryCounts: [.serverConnection: 2, .workflow: 1],
            redactionNotice: "Sensitive metadata and terminal content are redacted."
        )

        let viewModel = Diagnostics.DiagnosticsOverlayViewModel(report: report)

        #expect(viewModel.title == "Diagnostics")
        #expect(viewModel.subtitle.contains("redacted"))
        #expect(viewModel.rows.contains("Server connection: 2"))
        #expect(viewModel.rows.contains("Workflow: 1"))
    }

    private func diagnosticEvent(
        category: Diagnostics.DiagnosticCategory,
        severity: Diagnostics.DiagnosticSeverity,
        message: String = "event",
        metadata: [String: String] = [:],
        terminalContent: String? = nil
    ) -> Diagnostics.DiagnosticEvent {
        Diagnostics.DiagnosticEvent(
            id: Diagnostics.DiagnosticEventID(rawValue: "event-\(category.rawValue)-\(severity.rawValue)"),
            workspaceID: "workspace-a",
            category: category,
            severity: severity,
            title: "Diagnostic",
            message: message,
            metadata: metadata,
            terminalContent: terminalContent,
            occurredAt: FixedClock().now()
        )
    }
}
