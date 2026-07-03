import Foundation

public extension AgentIntegration {
    struct ProviderAgentInstallTargetResolver: AgentProviderInstallTargetResolving, Sendable {
        private let homeDirectoryPath: String

        public init(homeDirectoryPath: String = "~") {
            self.homeDirectoryPath = homeDirectoryPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "~" : homeDirectoryPath
        }

        public func resolveAgentProviderInstallTargets() async throws -> [AgentProviderInstallTarget] {
            try [.claudeCode, .codex, .cursor, .openCode].map(resolveTarget)
        }

        public func resolveAgentProviderInstallTarget(for agentID: AgentCLIIdentifier) async throws -> AgentProviderInstallTarget {
            try resolveTarget(agentID)
        }

        private func resolveTarget(_ agentID: AgentCLIIdentifier) throws -> AgentProviderInstallTarget {
            guard let descriptor = AgentIntegration.supportedAgentDescriptors.first(where: { $0.id == agentID }),
                  descriptor.id != .custom,
                  descriptor.id != .future
            else {
                throw AgentIntegrationError.unsupportedAgent(agentID)
            }

            switch agentID {
            case .claudeCode:
                return AgentProviderInstallTarget(
                    agent: descriptor,
                    configurationDirectoryPath: path(".claude"),
                    fileTargets: [
                        AgentProviderFileTarget(
                            artifact: .hooks,
                            path: path(".claude", "settings.json"),
                            format: .jsonHooks,
                            writeStrategy: .sharedStructuredMerge,
                            requiresProviderSpecificRenderer: true,
                            notes: ["Claude Code hooks live in settings JSON and must be merged structurally."]
                        ),
                        AgentProviderFileTarget(
                            artifact: .skills,
                            path: path(".claude", "skills", "fenrir-native", "SKILL.md"),
                            format: .markdownSkill,
                            writeStrategy: .ownedFile,
                            requiresProviderSpecificRenderer: false
                        ),
                        AgentProviderFileTarget(
                            artifact: .mcp,
                            path: path(".claude.json"),
                            format: .jsonMCP,
                            writeStrategy: .sharedStructuredMerge,
                            requiresProviderSpecificRenderer: true,
                            notes: ["User-scope Claude Code MCP entries are shared JSON and must preserve non-Fenrir servers."]
                        )
                    ],
                    notes: ["Global hooks and skills are additive; project-local variants can be added as a separate scoped target."]
                )
            case .codex:
                return AgentProviderInstallTarget(
                    agent: descriptor,
                    configurationDirectoryPath: path(".codex"),
                    fileTargets: [
                        AgentProviderFileTarget(
                            artifact: .hooks,
                            path: path(".codex", "hooks.json"),
                            format: .jsonHooks,
                            writeStrategy: .sharedStructuredMerge,
                            requiresProviderSpecificRenderer: true,
                            notes: ["Codex hooks are enabled through hooks.json or inline config TOML; use one representation per layer."]
                        ),
                        AgentProviderFileTarget(
                            artifact: .skills,
                            path: path(".codex", "skills", "fenrir-native", "SKILL.md"),
                            format: .markdownSkill,
                            writeStrategy: .ownedFile,
                            requiresProviderSpecificRenderer: false
                        ),
                        AgentProviderFileTarget(
                            artifact: .mcp,
                            path: path(".codex", "config.toml"),
                            format: .tomlMCP,
                            writeStrategy: .sharedStructuredMerge,
                            requiresProviderSpecificRenderer: true,
                            notes: ["Codex MCP servers are TOML tables, not mcpServers JSON."]
                        )
                    ]
                )
            case .cursor:
                return AgentProviderInstallTarget(
                    agent: descriptor,
                    configurationDirectoryPath: path(".cursor"),
                    fileTargets: [
                        AgentProviderFileTarget(
                            artifact: .mcp,
                            path: path(".cursor", "mcp.json"),
                            format: .jsonMCP,
                            writeStrategy: .sharedStructuredMerge,
                            requiresProviderSpecificRenderer: true,
                            notes: ["Cursor has a stable MCP surface, but no accepted Fenrir hook or skill installer in the base native client."]
                        )
                    ],
                    notes: ["Cursor support is MCP/context oriented until a Cursor hook or skill adapter is explicitly accepted."]
                )
            case .openCode:
                return AgentProviderInstallTarget(
                    agent: descriptor,
                    configurationDirectoryPath: path(".config", "opencode"),
                    fileTargets: [
                        AgentProviderFileTarget(
                            artifact: .hooks,
                            path: path(".config", "opencode", "plugins", "fenrir-presence.js"),
                            format: .javascriptPlugin,
                            writeStrategy: .ownedFile,
                            requiresProviderSpecificRenderer: true,
                            notes: ["OpenCode loads plugin files; Fenrir must write a real JavaScript plugin, not a generic text block."]
                        ),
                        AgentProviderFileTarget(
                            artifact: .skills,
                            path: path(".config", "opencode", "skills", "fenrir-native", "SKILL.md"),
                            format: .markdownSkill,
                            writeStrategy: .ownedFile,
                            requiresProviderSpecificRenderer: false
                        ),
                        AgentProviderFileTarget(
                            artifact: .mcp,
                            path: path(".config", "opencode", "opencode.json"),
                            format: .jsonMCP,
                            writeStrategy: .sharedStructuredMerge,
                            requiresProviderSpecificRenderer: true,
                            notes: ["OpenCode MCP lives under the opencode config mcp key, not a top-level mcpServers map."]
                        )
                    ]
                )
            case .custom, .future:
                throw AgentIntegrationError.unsupportedAgent(agentID)
            }
        }

        private func path(_ components: String...) -> String {
            components.reduce(homeDirectoryPath) { partial, component in
                appendPathComponent(component, to: partial)
            }
        }
    }
}

private func appendPathComponent(_ component: String, to base: String) -> String {
    if component.isEmpty {
        return base
    }
    if base.hasSuffix("/") {
        return base + component
    }
    return base + "/" + component
}
