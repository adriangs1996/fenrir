import Foundation
import Testing
import FenrirNativeShared
@testable import AgentIntegration

@Suite("Managed AgentIntegration provisioner")
struct ManagedAgentIntegrationProvisionerTests {
    @Test("managed provisioner installs hooks and skills idempotently")
    func installHooksAndSkillsIdempotently() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        let provisioner = managedProvisioner(store: store)
        let request = provisioningRequest(agentID: .codex)

        let first = try await provisioner.installAgentIntegration(request)
        let second = try await provisioner.installAgentIntegration(request)

        #expect(first.change == .installed)
        #expect(second.change == .unchanged)
        #expect(first.status.state == .installed)
        #expect(await store.content(at: codexHooksPath)?.contains("fenrir-agent-integration") == true)
        #expect(await store.content(at: codexSkillsPath)?.contains("metadata-only") == true)
        #expect(await store.backups().isEmpty)
    }

    @Test("managed provisioner preserves user content and backs up before mutation")
    func preservesUserContentAndBacksUpBeforeMutation() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        await store.seed("user=true\n", at: codexHooksPath)
        await store.seed("# user skill note\n", at: codexSkillsPath)
        let provisioner = managedProvisioner(store: store)
        let request = provisioningRequest(agentID: .codex)

        let installed = try await provisioner.installAgentIntegration(request)
        let removed = try await provisioner.removeAgentIntegration(request)

        #expect(installed.change == .installed)
        #expect(removed.change == .removed)
        #expect(await store.content(at: codexHooksPath) == "user=true\n")
        #expect(await store.content(at: codexSkillsPath) == "# user skill note\n")
        #expect(await store.backups().map(\.originalPath) == [codexHooksPath, codexSkillsPath, codexHooksPath, codexSkillsPath])
    }

    @Test("managed provisioner backs up conflicted files and refuses overwrite")
    func backsUpConflictedFilesAndRefusesOverwrite() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        let conflicted = "# >>> fenrir-agent-integration:owner=fenrir version=0.8.0 id=codex-hooks\nbroken=true\n"
        await store.seed(conflicted, at: codexHooksPath)
        let provisioner = managedProvisioner(store: store)

        await #expect(throws: AgentIntegration.AgentIntegrationError.configConflict("Fenrir-owned block is missing an end marker for codex-hooks")) {
            _ = try await provisioner.installAgentIntegration(provisioningRequest(agentID: .codex))
        }
        #expect(await store.content(at: codexHooksPath) == conflicted)
        #expect(await store.backups().map(\.reason) == ["fenrir-agent-integration-conflict"])
    }

    @Test("managed MCP provisioning preserves non Fenrir servers and replaces workspace owned servers")
    func mcpProvisioningPreservesNonFenrirServers() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        await store.seed(
            """
            {
              "otherRoot": true,
              "mcpServers": {
                "external": { "command": "external" },
                "oldFenrir": { "command": "old", "_fenrir": { "owner": "fenrir", "workspaceID": "workspace-1" } },
                "otherWorkspace": { "command": "keep", "_fenrir": { "owner": "fenrir", "workspaceID": "workspace-2" } }
              }
            }
            """,
            at: codexMCPPath
        )
        let provisioner = managedProvisioner(store: store)
        let request = AgentIntegration.AgentMCPProvisioningRequest(
            requestID: "mcp",
            agentID: .codex,
            workspaceID: "workspace-1",
            servers: [.init(name: "fenrir", command: "fenrir", arguments: ["mcp", "serve"], environment: ["FENRIR_WORKSPACE": "workspace-1"])],
            source: .test
        )

        let first = try await provisioner.provisionAgentMCP(request)
        let second = try await provisioner.provisionAgentMCP(request)
        let content = try #require(await store.content(at: codexMCPPath))
        let root = try parseJSONObject(content)
        let servers = try #require(root["mcpServers"] as? [String: Any])
        let fenrirServer = try #require(servers["fenrir"] as? [String: Any])
        let fenrirMetadata = try #require(fenrirServer["_fenrir"] as? [String: Any])

        #expect(first.change == .updated)
        #expect(second.change == .unchanged)
        #expect(servers["external"] != nil)
        #expect(servers["oldFenrir"] == nil)
        #expect(servers["otherWorkspace"] != nil)
        #expect(fenrirServer["command"] as? String == "fenrir")
        #expect(fenrirServer["args"] as? [String] == ["mcp", "serve"])
        #expect((fenrirServer["env"] as? [String: String])?["FENRIR_WORKSPACE"] == "workspace-1")
        #expect(fenrirMetadata["owner"] as? String == AgentIntegration.ManagedConfigOwnership.owner)
        #expect(fenrirMetadata["workspaceID"] as? String == "workspace-1")
        #expect(await store.backups().count == 1)
    }

    @Test("managed provisioner rejects unsupported adapters")
    func rejectsUnsupportedAdapters() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        let provisioner = managedProvisioner(store: store)

        await #expect(throws: AgentIntegration.AgentIntegrationError.unsupportedAgent(.custom)) {
            _ = try await provisioner.installAgentIntegration(provisioningRequest(agentID: .custom))
        }
        await #expect(throws: AgentIntegration.AgentIntegrationError.unsupportedAgent(.future)) {
            _ = try await provisioner.provisionAgentMCP(AgentIntegration.AgentMCPProvisioningRequest(
                requestID: "mcp-future",
                agentID: .future,
                workspaceID: "workspace-1",
                servers: [],
                source: .test
            ))
        }
    }

    @Test("local config store writes and backs up files through atomic filesystem API")
    func localConfigStoreWritesAndBacksUpFiles() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("fenrir-agent-store-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let path = root.appendingPathComponent("codex/hooks.conf").path
        let store = AgentIntegration.LocalAgentIntegrationConfigFileStore()

        try await store.writeTextFile("hello", at: path)
        let backup = try await store.createBackup(of: "hello", at: path, reason: "test")

        #expect(try await store.readTextFile(at: path) == "hello")
        #expect(FileManager.default.fileExists(atPath: backup.backupPath))
        #expect(try await store.readTextFile(at: backup.backupPath) == "hello")
    }
}

private let provisionerClock = AgentIntegration.FixedAgentIntegrationClock(timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_001)))
private let codexHooksPath = "/tmp/fenrir-native-agent/codex/hooks.conf"
private let codexSkillsPath = "/tmp/fenrir-native-agent/codex/skills.md"
private let codexMCPPath = "/tmp/fenrir-native-agent/codex/mcp.json"

private func managedProvisioner(store: AgentIntegration.InMemoryAgentIntegrationConfigFileStore) -> AgentIntegration.ManagedAgentIntegrationProvisioner {
    AgentIntegration.ManagedAgentIntegrationProvisioner(
        targets: [AgentIntegration.AgentInstallTarget(agentID: .codex, hooksFilePath: codexHooksPath, skillsFilePath: codexSkillsPath, mcpConfigFilePath: codexMCPPath)],
        configStore: store,
        clock: provisionerClock,
        integrationVersion: "1.0.0"
    )
}

private func provisioningRequest(agentID: AgentIntegration.AgentCLIIdentifier) -> AgentIntegration.AgentProvisioningRequest {
    AgentIntegration.AgentProvisioningRequest(requestID: RequestID(rawValue: "provision-\(agentID.rawValue)"), agentID: agentID, workspaceID: "workspace-1", targetVersion: "1.0.0", source: .test)
}

private func parseJSONObject(_ content: String) throws -> [String: Any] {
    guard let root = try JSONSerialization.jsonObject(with: Data(content.utf8), options: []) as? [String: Any] else {
        throw AgentIntegration.AgentIntegrationError.configConflict("Expected JSON object")
    }
    return root
}
