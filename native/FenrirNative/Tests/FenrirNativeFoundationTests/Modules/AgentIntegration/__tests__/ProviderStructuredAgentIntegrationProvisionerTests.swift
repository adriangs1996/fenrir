import Foundation
import Testing
import FenrirNativeShared
@testable import AgentIntegration

@Suite("Provider structured AgentIntegration provisioner")
struct ProviderStructuredAgentIntegrationProvisionerTests {
    @Test("Claude hooks and skill install through structured provider targets idempotently")
    func claudeHooksAndSkillInstallIdempotently() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        await store.seed(
            """
            {
              "theme": "dark",
              "hooks": {
                "UserPromptSubmit": [
                  { "type": "command", "command": "echo user" },
                  { "hooks": [{ "type": "command", "command": "printf old # fenrir-managed-agent-hook:v1" }] }
                ]
              }
            }
            """,
            at: claudeSettingsPath
        )
        let provisioner = providerStructuredProvisioner(store: store)
        let request = provisioningRequest(agentID: .claudeCode)

        let first = try await provisioner.installAgentIntegration(request)
        let second = try await provisioner.installAgentIntegration(request)
        let content = try #require(await store.content(at: claudeSettingsPath))
        let root = try parseJSONObject(content)
        let hooks = try #require(root["hooks"] as? [String: Any])
        let promptHooks = try #require(hooks["UserPromptSubmit"] as? [[String: Any]])
        let startHooks = try #require(hooks["SessionStart"] as? [[String: Any]])
        let skill = try #require(await store.content(at: claudeSkillPath))

        #expect(first.change == .installed)
        #expect(second.change == .unchanged)
        #expect(root["theme"] as? String == "dark")
        #expect(promptHooks.contains { $0["command"] as? String == "echo user" })
        #expect(promptHooks.contains { String(describing: $0).contains("fenrir-managed-agent-hook:v1") })
        #expect(!promptHooks.contains { String(describing: $0).contains("printf old") })
        #expect(startHooks.contains { String(describing: $0).contains("com.fenrir.agent.presence.v1") })
        #expect(skill.contains("fenrir-managed-agent-artifact:v1"))
        #expect(skill.contains("Claude Code"))
        #expect(await store.backups().map { $0.originalPath } == [claudeSettingsPath])
    }

    @Test("removing Claude integration preserves user hooks and removes owned skill")
    func removingClaudePreservesUserHooksAndRemovesOwnedSkill() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        await store.seed(
            """
            {
              "hooks": {
                "UserPromptSubmit": [{ "type": "command", "command": "echo user" }]
              }
            }
            """,
            at: claudeSettingsPath
        )
        let provisioner = providerStructuredProvisioner(store: store)
        let request = provisioningRequest(agentID: .claudeCode)

        _ = try await provisioner.installAgentIntegration(request)
        let removed = try await provisioner.removeAgentIntegration(request)
        let content = try #require(await store.content(at: claudeSettingsPath))
        let root = try parseJSONObject(content)
        let hooks = try #require(root["hooks"] as? [String: Any])
        let promptHooks = try #require(hooks["UserPromptSubmit"] as? [[String: Any]])

        #expect(removed.change == .removed)
        #expect(promptHooks.count == 1)
        #expect(promptHooks.first?["command"] as? String == "echo user")
        #expect(!content.contains("fenrir-managed-agent-hook:v1"))
        #expect(await store.content(at: claudeSkillPath) == nil)
    }

    @Test("remove on missing provider files is unchanged and does not create empty JSON")
    func removeOnMissingProviderFilesIsUnchanged() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        let provisioner = providerStructuredProvisioner(store: store)

        let removed = try await provisioner.removeAgentIntegration(provisioningRequest(agentID: .codex))

        #expect(removed.change == .unchanged)
        #expect(await store.content(at: codexHooksPath) == nil)
        #expect(await store.content(at: codexSkillPath) == nil)
        #expect(await store.backups().isEmpty)
    }

    @Test("Cursor JSON MCP preserves external servers and replaces only workspace owned entries")
    func cursorJSONMCPPreservesExternalServers() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        await store.seed(
            """
            {
              "mcpServers": {
                "external": { "command": "external" },
                "oldFenrir": { "command": "old", "_fenrir": { "owner": "fenrir", "workspaceID": "workspace-1" } },
                "otherWorkspace": { "command": "keep", "_fenrir": { "owner": "fenrir", "workspaceID": "workspace-2" } }
              }
            }
            """,
            at: cursorMCPPath
        )
        let provisioner = providerStructuredProvisioner(store: store)
        let request = mcpRequest(agentID: .cursor, servers: [fenrirMCPServer])

        let first = try await provisioner.provisionAgentMCP(request)
        let second = try await provisioner.provisionAgentMCP(request)
        let content = try #require(await store.content(at: cursorMCPPath))
        let root = try parseJSONObject(content)
        let servers = try #require(root["mcpServers"] as? [String: Any])
        let fenrirServer = try #require(servers["fenrir"] as? [String: Any])
        let metadata = try #require(fenrirServer["_fenrir"] as? [String: Any])

        #expect(first.change == .updated)
        #expect(second.change == .unchanged)
        #expect(servers["external"] != nil)
        #expect(servers["oldFenrir"] == nil)
        #expect(servers["otherWorkspace"] != nil)
        #expect(fenrirServer["command"] as? String == "fenrir")
        #expect(fenrirServer["args"] as? [String] == ["mcp", "serve"])
        #expect((fenrirServer["env"] as? [String: String])?["FENRIR_WORKSPACE"] == "workspace-1")
        #expect(metadata["owner"] as? String == AgentIntegration.ManagedConfigOwnership.owner)
        #expect(metadata["workspaceID"] as? String == "workspace-1")
        #expect(await store.backups().count == 1)
    }

    @Test("JSON MCP removal on missing file is unchanged")
    func jsonMCPRemovalOnMissingFileIsUnchanged() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        let provisioner = providerStructuredProvisioner(store: store)

        let result = try await provisioner.provisionAgentMCP(mcpRequest(agentID: .cursor, servers: []))

        #expect(result.change == .unchanged)
        #expect(await store.content(at: cursorMCPPath) == nil)
        #expect(await store.backups().isEmpty)
    }

    @Test("Codex TOML MCP installs idempotently and removes only Fenrir owned block")
    func codexTOMLMCPInstallsAndRemovesOwnedBlock() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        await store.seed("approval_policy = \"never\"\n", at: codexConfigPath)
        let provisioner = providerStructuredProvisioner(store: store)
        let install = mcpRequest(agentID: .codex, servers: [fenrirMCPServer])

        let first = try await provisioner.provisionAgentMCP(install)
        let second = try await provisioner.provisionAgentMCP(install)
        let installedContent = try #require(await store.content(at: codexConfigPath))
        let removed = try await provisioner.provisionAgentMCP(mcpRequest(agentID: .codex, servers: []))

        #expect(first.change == .updated)
        #expect(second.change == .unchanged)
        #expect(installedContent.contains("[mcp_servers.\"fenrir\"]"))
        #expect(installedContent.contains("workspaceID = \"workspace-1\""))
        #expect(removed.change == .removed)
        #expect(await store.content(at: codexConfigPath) == "approval_policy = \"never\"\n")
    }

    @Test("OpenCode plugin and MCP use provider real structured surfaces")
    func openCodePluginAndMCPUseStructuredSurfaces() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        let provisioner = providerStructuredProvisioner(store: store)
        let request = provisioningRequest(agentID: .openCode)

        let install = try await provisioner.installAgentIntegration(request)
        let mcp = try await provisioner.provisionAgentMCP(mcpRequest(agentID: .openCode, servers: [fenrirMCPServer]))
        let plugin = try #require(await store.content(at: openCodePluginPath))
        let skill = try #require(await store.content(at: openCodeSkillPath))
        let root = try parseJSONObject(try #require(await store.content(at: openCodeConfigPath)))

        #expect(install.change == .installed)
        #expect(mcp.change == .updated)
        #expect(plugin.contains("fenrir-managed-agent-artifact:v1"))
        #expect(plugin.contains("permission.ask"))
        #expect(plugin.contains("nothrow"))
        #expect(skill.contains("OpenCode"))
        #expect(root["mcpServers"] == nil)
        #expect((root["mcp"] as? [String: Any])?["fenrir"] != nil)
    }

    @Test("owned provider artifacts refuse non Fenrir files and create a backup")
    func ownedProviderArtifactsRefuseNonFenrirFiles() async throws {
        let store = AgentIntegration.InMemoryAgentIntegrationConfigFileStore()
        await store.seed("export default {}\n", at: openCodePluginPath)
        let provisioner = providerStructuredProvisioner(store: store)

        await #expect(throws: AgentIntegration.AgentIntegrationError.configConflict("Refusing to overwrite non-Fenrir-owned artifact at " + openCodePluginPath)) {
            _ = try await provisioner.installAgentIntegration(provisioningRequest(agentID: .openCode))
        }
        #expect(await store.content(at: openCodePluginPath) == "export default {}\n")
        #expect(await store.backups().map { $0.reason } == ["fenrir-agent-plugin-conflict"])
    }
}

private let providerClock = AgentIntegration.FixedAgentIntegrationClock(timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_111)))
private let providerHome = "/tmp/fenrir-provider-home"
private let claudeSettingsPath = providerHome + "/.claude/settings.json"
private let claudeSkillPath = providerHome + "/.claude/skills/fenrir-native/SKILL.md"
private let codexHooksPath = providerHome + "/.codex/hooks.json"
private let codexSkillPath = providerHome + "/.codex/skills/fenrir-native/SKILL.md"
private let codexConfigPath = providerHome + "/.codex/config.toml"
private let cursorMCPPath = providerHome + "/.cursor/mcp.json"
private let openCodePluginPath = providerHome + "/.config/opencode/plugins/fenrir-presence.js"
private let openCodeSkillPath = providerHome + "/.config/opencode/skills/fenrir-native/SKILL.md"
private let openCodeConfigPath = providerHome + "/.config/opencode/opencode.json"
private let fenrirMCPServer = AgentIntegration.AgentMCPServerDescriptor(name: "fenrir", command: "fenrir", arguments: ["mcp", "serve"], environment: ["FENRIR_WORKSPACE": "workspace-1"])

private func providerStructuredProvisioner(store: AgentIntegration.InMemoryAgentIntegrationConfigFileStore) -> AgentIntegration.ProviderStructuredAgentIntegrationProvisioner {
    AgentIntegration.providerStructuredAgentIntegrationProvisioner(
        configStore: store,
        clock: providerClock,
        homeDirectoryPath: providerHome,
        integrationVersion: "1.0.0"
    )
}

private func provisioningRequest(agentID: AgentIntegration.AgentCLIIdentifier) -> AgentIntegration.AgentProvisioningRequest {
    AgentIntegration.AgentProvisioningRequest(requestID: RequestID(rawValue: "provider-provision-\(agentID.rawValue)"), agentID: agentID, workspaceID: "workspace-1", targetVersion: "1.0.0", source: .test)
}

private func mcpRequest(agentID: AgentIntegration.AgentCLIIdentifier, servers: [AgentIntegration.AgentMCPServerDescriptor]) -> AgentIntegration.AgentMCPProvisioningRequest {
    AgentIntegration.AgentMCPProvisioningRequest(requestID: RequestID(rawValue: "provider-mcp-\(agentID.rawValue)-\(servers.count)"), agentID: agentID, workspaceID: "workspace-1", servers: servers, source: .test)
}

private func parseJSONObject(_ content: String) throws -> [String: Any] {
    guard let root = try JSONSerialization.jsonObject(with: Data(content.utf8), options: []) as? [String: Any] else {
        throw AgentIntegration.AgentIntegrationError.configConflict("Expected JSON object")
    }
    return root
}
