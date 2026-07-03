import Foundation
import FenrirNativeShared

public extension AgentIntegration {
    actor ProviderStructuredAgentIntegrationProvisioner: AgentIntegrationInstalling, AgentMCPProvisioning {
        private let targetResolver: any AgentProviderInstallTargetResolving
        private let configStore: any AgentIntegrationConfigFileStoring
        private let clock: any AgentIntegrationClock
        private let integrationVersion: IntegrationVersion

        public init(
            targetResolver: any AgentProviderInstallTargetResolving = AgentIntegration.providerAgentInstallTargetResolver(),
            configStore: any AgentIntegrationConfigFileStoring,
            clock: any AgentIntegrationClock,
            integrationVersion: IntegrationVersion = "1.0.0"
        ) {
            self.targetResolver = targetResolver
            self.configStore = configStore
            self.clock = clock
            self.integrationVersion = integrationVersion
        }

        public func installAgentIntegration(_ request: AgentProvisioningRequest) async throws -> AgentProvisioningResult {
            let changed = try await applyIntegrationArtifacts(request, removing: false)
            return provisioningResult(request, change: changed ? .installed : .unchanged, state: .installed, installedVersion: request.targetVersion)
        }

        public func updateAgentIntegration(_ request: AgentProvisioningRequest) async throws -> AgentProvisioningResult {
            let changed = try await applyIntegrationArtifacts(request, removing: false)
            return provisioningResult(request, change: changed ? .updated : .unchanged, state: .installed, installedVersion: request.targetVersion)
        }

        public func removeAgentIntegration(_ request: AgentProvisioningRequest) async throws -> AgentProvisioningResult {
            let changed = try await applyIntegrationArtifacts(request, removing: true)
            return provisioningResult(request, change: changed ? .removed : .unchanged, state: .notInstalled, installedVersion: nil)
        }

        public func provisionAgentMCP(_ request: AgentMCPProvisioningRequest) async throws -> AgentMCPProvisioningResult {
            let target = try await targetResolver.resolveAgentProviderInstallTarget(for: request.agentID)
            guard let mcpTarget = target.fileTargets.first(where: { $0.artifact == .mcp }) else {
                throw AgentIntegrationError.unavailable
            }

            let changed: Bool
            switch mcpTarget.format {
            case .jsonMCP:
                changed = try await editSharedFile(at: mcpTarget.path, conflictReason: "fenrir-agent-mcp-conflict", backupReason: "before-fenrir-agent-mcp-write") { original in
                    try renderJSONMCPConfig(original: original, request: request)
                }
            case .tomlMCP:
                changed = try await editSharedFile(at: mcpTarget.path, conflictReason: "fenrir-agent-mcp-conflict", backupReason: "before-fenrir-agent-mcp-write") { original in
                    try renderTOMLMCPConfig(original: original, request: request)
                }
            default:
                throw AgentIntegrationError.unavailable
            }

            let change: ProvisioningChange = !changed ? .unchanged : (request.servers.isEmpty ? .removed : .updated)
            return AgentMCPProvisioningResult(requestID: request.requestID, agentID: request.agentID, workspaceID: request.workspaceID, change: change, timestamp: clock.now())
        }
    }
}

private extension AgentIntegration.ProviderStructuredAgentIntegrationProvisioner {
    static var hookMarker: String { "fenrir-managed-agent-hook:v1" }
    static var artifactMarker: String { "fenrir-managed-agent-artifact:v1" }

    func applyIntegrationArtifacts(_ request: AgentIntegration.AgentProvisioningRequest, removing: Bool) async throws -> Bool {
        let target = try await targetResolver.resolveAgentProviderInstallTarget(for: request.agentID)
        var changed = false
        var handled = false

        for fileTarget in target.fileTargets where fileTarget.artifact == .hooks || fileTarget.artifact == .skills {
            if fileTarget.artifact == .hooks, fileTarget.format == .jsonHooks {
                handled = true
                let fileChanged = try await editSharedFile(at: fileTarget.path, conflictReason: "fenrir-agent-hooks-conflict", backupReason: "before-fenrir-agent-hooks-write") { original in
                    if removing {
                        return try removeJSONHooks(original: original)
                    }
                    return try renderJSONHooks(original: original, agentID: request.agentID)
                }
                changed = changed || fileChanged
            } else if fileTarget.artifact == .hooks, fileTarget.format == .javascriptPlugin {
                handled = true
                let fileChanged: Bool
                if removing {
                    fileChanged = try await removeOwnedArtifact(at: fileTarget.path)
                } else {
                    fileChanged = try await writeOwnedArtifact(openCodePlugin(agentID: request.agentID), at: fileTarget.path, conflictReason: "fenrir-agent-plugin-conflict")
                }
                changed = changed || fileChanged
            } else if fileTarget.artifact == .skills, fileTarget.format == .markdownSkill {
                handled = true
                let fileChanged: Bool
                if removing {
                    fileChanged = try await removeOwnedArtifact(at: fileTarget.path)
                } else {
                    fileChanged = try await writeOwnedArtifact(skillMarkdown(for: target.agent, version: request.targetVersion), at: fileTarget.path, conflictReason: "fenrir-agent-skill-conflict")
                }
                changed = changed || fileChanged
            }
        }

        guard handled else {
            throw AgentIntegration.AgentIntegrationError.unavailable
        }
        return changed
    }

    func editSharedFile(at path: String, conflictReason: String, backupReason: String, render: (String) throws -> String) async throws -> Bool {
        let original = try await configStore.readTextFile(at: path) ?? ""
        let rendered: String
        do {
            rendered = try render(original)
        } catch let error as AgentIntegration.AgentIntegrationError {
            if case .configConflict = error, !original.isEmpty {
                _ = try await configStore.createBackup(of: original, at: path, reason: conflictReason)
            }
            throw error
        }

        guard rendered != original else { return false }
        if !original.isEmpty {
            _ = try await configStore.createBackup(of: original, at: path, reason: backupReason)
        }
        try await configStore.writeTextFile(rendered, at: path)
        return true
    }

    func writeOwnedArtifact(_ content: String, at path: String, conflictReason: String) async throws -> Bool {
        let original = try await configStore.readTextFile(at: path)
        if let original, !original.isEmpty, !original.contains(Self.artifactMarker) {
            _ = try await configStore.createBackup(of: original, at: path, reason: conflictReason)
            throw AgentIntegration.AgentIntegrationError.configConflict("Refusing to overwrite non-Fenrir-owned artifact at " + path)
        }
        guard original != content else { return false }
        if let original, !original.isEmpty {
            _ = try await configStore.createBackup(of: original, at: path, reason: "before-fenrir-agent-artifact-write")
        }
        try await configStore.writeTextFile(content, at: path)
        return true
    }

    func removeOwnedArtifact(at path: String) async throws -> Bool {
        guard let original = try await configStore.readTextFile(at: path), !original.isEmpty else { return false }
        guard original.contains(Self.artifactMarker) else { return false }
        _ = try await configStore.createBackup(of: original, at: path, reason: "before-fenrir-agent-artifact-remove")
        try await configStore.removeTextFile(at: path)
        return true
    }

    func renderJSONHooks(original: String, agentID: AgentIntegration.AgentCLIIdentifier) throws -> String {
        var root = try parseJSONObject(original: original, description: "hook config")
        var hooks = try hookMap(from: root)
        hooks = pruneFenrirHooks(from: hooks)
        for event in hookEvents(for: agentID) {
            var entries = hooks[event.name] as? [[String: Any]] ?? []
            entries.append(hookEntry(for: agentID, event: event))
            hooks[event.name] = entries
        }
        root["hooks"] = hooks
        return try renderJSONObject(root)
    }

    func removeJSONHooks(original: String) throws -> String {
        if original.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return original
        }

        var root = try parseJSONObject(original: original, description: "hook config")
        let hooks = try hookMap(from: root)
        guard containsFenrirHooks(in: hooks) else {
            return original
        }

        let pruned = pruneFenrirHooks(from: hooks)
        if pruned.isEmpty {
            root.removeValue(forKey: "hooks")
        } else {
            root["hooks"] = pruned
        }
        return try renderJSONObject(root)
    }

    func containsFenrirHooks(in hooks: [String: Any]) -> Bool {
        hooks.values.contains { value in
            guard let entries = value as? [[String: Any]] else { return false }
            return entries.contains { entryContainsFenrirHook($0) }
        }
    }

    func entryContainsFenrirHook(_ entry: [String: Any]) -> Bool {
        if let command = entry["command"] as? String, command.contains(Self.hookMarker) {
            return true
        }
        guard let hooks = entry["hooks"] as? [[String: Any]] else {
            return false
        }
        return hooks.contains { hook in
            guard let command = hook["command"] as? String else { return false }
            return command.contains(Self.hookMarker)
        }
    }

    func renderJSONMCPConfig(original: String, request: AgentIntegration.AgentMCPProvisioningRequest) throws -> String {
        if original.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, request.servers.isEmpty {
            return original
        }

        var root = try parseJSONObject(original: original, description: "MCP config")
        let key = request.agentID == .openCode ? "mcp" : "mcpServers"
        var servers = try objectMap(root[key], description: "MCP servers")
        var removedOwnedServer = false
        for serverName in Array(servers.keys) where isFenrirOwnedMCPServer(servers[serverName], workspaceID: request.workspaceID) {
            servers.removeValue(forKey: serverName)
            removedOwnedServer = true
        }
        if request.servers.isEmpty, !removedOwnedServer {
            return original
        }
        for server in request.servers {
            let name = server.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else {
                throw AgentIntegration.AgentIntegrationError.configConflict("MCP server names cannot be empty")
            }
            servers[name] = mcpServerObject(server, request: request)
        }
        if servers.isEmpty {
            root.removeValue(forKey: key)
        } else {
            root[key] = servers
        }
        return try renderJSONObject(root)
    }

    func renderTOMLMCPConfig(original: String, request: AgentIntegration.AgentMCPProvisioningRequest) throws -> String {
        let blockID = request.agentID.rawValue + "-mcp-" + request.workspaceID.rawValue
        let editor = AgentIntegration.ManagedConfigBlockEditor(ownership: AgentIntegration.ManagedConfigOwnership(version: integrationVersion, blockID: blockID), linePrefix: "#")
        if request.servers.isEmpty {
            return try editor.remove(from: original).content
        }
        return try editor.install(into: original, managedBody: tomlMCPBody(for: request)).content
    }

    func parseJSONObject(original: String, description: String) throws -> [String: Any] {
        guard !original.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [:] }
        do {
            guard let root = try JSONSerialization.jsonObject(with: Data(original.utf8), options: []) as? [String: Any] else {
                throw AgentIntegration.AgentIntegrationError.configConflict(description + " root must be a JSON object")
            }
            return root
        } catch let error as AgentIntegration.AgentIntegrationError {
            throw error
        } catch {
            throw AgentIntegration.AgentIntegrationError.configConflict(description + " contains invalid JSON")
        }
    }

    func renderJSONObject(_ root: [String: Any]) throws -> String {
        guard JSONSerialization.isValidJSONObject(root) else {
            throw AgentIntegration.AgentIntegrationError.configConflict("Provider config cannot be serialized")
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
            guard var rendered = String(data: data, encoding: .utf8) else {
                throw AgentIntegration.AgentIntegrationError.configConflict("Provider config cannot be encoded as UTF-8")
            }
            if !rendered.hasSuffix("\n") { rendered += "\n" }
            return rendered
        } catch let error as AgentIntegration.AgentIntegrationError {
            throw error
        } catch {
            throw AgentIntegration.AgentIntegrationError.configConflict("Provider config cannot be serialized")
        }
    }

    func hookMap(from root: [String: Any]) throws -> [String: Any] {
        guard let existing = root["hooks"] else { return [:] }
        guard let hooks = existing as? [String: Any] else {
            throw AgentIntegration.AgentIntegrationError.configConflict("hook config hooks key must be a JSON object")
        }
        return hooks
    }

    func objectMap(_ value: Any?, description: String) throws -> [String: Any] {
        guard let value else { return [:] }
        guard let object = value as? [String: Any] else {
            throw AgentIntegration.AgentIntegrationError.configConflict(description + " must be a JSON object")
        }
        return object
    }

    func pruneFenrirHooks(from hooks: [String: Any]) -> [String: Any] {
        var next: [String: Any] = [:]
        for (event, value) in hooks {
            guard let entries = value as? [[String: Any]] else {
                next[event] = value
                continue
            }
            let pruned = entries.compactMap(pruneFenrirHookEntry)
            if !pruned.isEmpty { next[event] = pruned }
        }
        return next
    }

    func pruneFenrirHookEntry(_ entry: [String: Any]) -> [String: Any]? {
        if let command = entry["command"] as? String, command.contains(Self.hookMarker) { return nil }
        var next = entry
        if let hooks = entry["hooks"] as? [[String: Any]] {
            let prunedHooks = hooks.filter { hook in
                guard let command = hook["command"] as? String else { return true }
                return !command.contains(Self.hookMarker)
            }
            if prunedHooks.isEmpty, prunedHooks.count != hooks.count { return nil }
            next["hooks"] = prunedHooks
        }
        return next
    }

    func hookEntry(for agentID: AgentIntegration.AgentCLIIdentifier, event: ProviderHookEvent) -> [String: Any] {
        let command = presenceCommand(agentID: agentID, state: event.state, eventName: event.name)
        if agentID == .claudeCode {
            return ["hooks": [["type": "command", "command": command, "timeout": 10]]]
        }
        return ["type": "command", "command": command, "timeout": 10]
    }

    func hookEvents(for agentID: AgentIntegration.AgentCLIIdentifier) -> [ProviderHookEvent] {
        switch agentID {
        case .claudeCode:
            return [
                ProviderHookEvent(name: "SessionStart", state: .sessionStarted),
                ProviderHookEvent(name: "UserPromptSubmit", state: .busy),
                ProviderHookEvent(name: "PreToolUse", state: .busy),
                ProviderHookEvent(name: "PermissionRequest", state: .awaitingApproval),
                ProviderHookEvent(name: "Notification", state: .awaitingInput),
                ProviderHookEvent(name: "Stop", state: .turnCompleted),
                ProviderHookEvent(name: "SessionEnd", state: .sessionEnded)
            ]
        case .codex:
            return [
                ProviderHookEvent(name: "SessionStart", state: .sessionStarted),
                ProviderHookEvent(name: "UserPromptSubmit", state: .busy),
                ProviderHookEvent(name: "PermissionRequest", state: .awaitingApproval),
                ProviderHookEvent(name: "Stop", state: .turnCompleted)
            ]
        case .cursor, .openCode, .custom, .future:
            return []
        }
    }

    func presenceCommand(agentID: AgentIntegration.AgentCLIIdentifier, state: AgentIntegration.AgentPresenceState, eventName: String) -> String {
        let payload = "{\"namespace\":\"" + AgentIntegration.AgentPresenceSignal.namespace + "\",\"agentID\":\"" + agentID.rawValue + "\",\"state\":\"" + state.rawValue + "\"}"
        return "printf \"\\033]8737;" + payload + "\\007\" > /dev/tty 2>/dev/null || true # " + Self.hookMarker + " agent=" + agentID.rawValue + " event=" + eventName
    }

    func mcpServerObject(_ server: AgentIntegration.AgentMCPServerDescriptor, request: AgentIntegration.AgentMCPProvisioningRequest) -> [String: Any] {
        [
            "command": server.command,
            "args": server.arguments,
            "env": server.environment,
            "_fenrir": [
                "owner": AgentIntegration.ManagedConfigOwnership.owner,
                "version": integrationVersion.rawValue,
                "workspaceID": request.workspaceID.rawValue,
                "agentID": request.agentID.rawValue
            ]
        ]
    }

    func isFenrirOwnedMCPServer(_ value: Any?, workspaceID: WorkspaceID) -> Bool {
        guard let server = value as? [String: Any],
              let metadata = server["_fenrir"] as? [String: Any],
              metadata["owner"] as? String == AgentIntegration.ManagedConfigOwnership.owner,
              metadata["workspaceID"] as? String == workspaceID.rawValue
        else { return false }
        return true
    }

    func tomlMCPBody(for request: AgentIntegration.AgentMCPProvisioningRequest) -> String {
        request.servers.map { server in
            let name = tomlQuoted(server.name)
            var lines = [
                "[mcp_servers." + name + "]",
                "command = " + tomlQuoted(server.command),
                "args = " + tomlArray(server.arguments)
            ]
            if !server.environment.isEmpty {
                lines.append("[mcp_servers." + name + ".env]")
                for key in server.environment.keys.sorted() {
                    lines.append(key + " = " + tomlQuoted(server.environment[key] ?? ""))
                }
            }
            lines.append("[mcp_servers." + name + "._fenrir]")
            lines.append("owner = " + tomlQuoted(AgentIntegration.ManagedConfigOwnership.owner))
            lines.append("version = " + tomlQuoted(integrationVersion.rawValue))
            lines.append("workspaceID = " + tomlQuoted(request.workspaceID.rawValue))
            lines.append("agentID = " + tomlQuoted(request.agentID.rawValue))
            return lines.joined(separator: "\n")
        }.joined(separator: "\n\n")
    }

    func tomlArray(_ values: [String]) -> String {
        "[" + values.map(tomlQuoted).joined(separator: ", ") + "]"
    }

    func tomlQuoted(_ value: String) -> String {
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
        return "\"" + escaped + "\""
    }

    func skillMarkdown(for descriptor: AgentIntegration.AgentDescriptor, version: AgentIntegration.IntegrationVersion) -> String {
        [
            "<!-- " + Self.artifactMarker + " agent=" + descriptor.id.rawValue + " version=" + version.rawValue + " -->",
            "# Fenrir Native Agent Skill",
            "",
            "Agent: " + descriptor.displayName,
            "Integration version: " + version.rawValue,
            "Presence mode: terminal OSC metadata only",
            "",
            "Fenrir Native owns terminal panes on behalf of the user. Report session state through reserved OSC " + String(AgentIntegration.AgentPresenceSignal.oscIdentifier) + " using namespace " + AgentIntegration.AgentPresenceSignal.namespace + ". Do not write into unrelated panes."
        ].joined(separator: "\n") + "\n"
    }

    func openCodePlugin(agentID: AgentIntegration.AgentCLIIdentifier) -> String {
        """
        // \(Self.artifactMarker) agent=\(agentID.rawValue) version=\(integrationVersion.rawValue)
        const namespace = "\(AgentIntegration.AgentPresenceSignal.namespace)";
        const agentID = "\(agentID.rawValue)";
        const marker = "\(Self.hookMarker)";
        const emit = async ($, state) => {
          if (typeof $ !== "function") return;
          const payload = JSON.stringify({ namespace, agentID, state });
          const command = "printf '\\033]8737;" + payload.replace(/'/g, "'\\\\''") + "\\007' > /dev/tty 2>/dev/null || true # " + marker;
          await $({ raw: command }).quiet().nothrow();
        };
        export const ToolBefore = async ({ $ }) => emit($, "busy");
        export const ToolAfter = async ({ $ }) => emit($, "turnCompleted");
        export const PermissionAsk = async ({ $ }) => emit($, "awaitingApproval");
        export const SessionIdle = async ({ $ }) => emit($, "awaitingInput");
        export const PermissionReplied = async ({ $ }) => emit($, "busy");
        export default async function fenrirPresencePlugin({ app }) {
          app.on("tool.execute.before", ToolBefore);
          app.on("tool.execute.after", ToolAfter);
          app.on("permission.ask", PermissionAsk);
          app.on("session.idle", SessionIdle);
          app.on("permission.replied", PermissionReplied);
        }
        """
    }

    func provisioningResult(_ request: AgentIntegration.AgentProvisioningRequest, change: AgentIntegration.ProvisioningChange, state: AgentIntegration.IntegrationState, installedVersion: AgentIntegration.IntegrationVersion?) -> AgentIntegration.AgentProvisioningResult {
        let descriptor = AgentIntegration.supportedAgentDescriptors.first(where: { $0.id == request.agentID }) ?? AgentIntegration.AgentDescriptor(id: request.agentID, displayName: request.agentID.rawValue, executableNames: [], supportsHooks: false, supportsSkills: false, supportsMCP: false)
        let ownership = state == .notInstalled ? nil : AgentIntegration.ManagedConfigOwnership(version: request.targetVersion, blockID: request.agentID.rawValue + "-provider-integration")
        return AgentIntegration.AgentProvisioningResult(requestID: request.requestID, agentID: request.agentID, change: change, status: AgentIntegration.AgentIntegrationStatus(agent: descriptor, state: state, installedVersion: installedVersion, expectedVersion: request.targetVersion, ownership: ownership, detectedExecutablePath: nil), timestamp: clock.now())
    }

    struct ProviderHookEvent: Sendable {
        let name: String
        let state: AgentIntegration.AgentPresenceState
    }
}
