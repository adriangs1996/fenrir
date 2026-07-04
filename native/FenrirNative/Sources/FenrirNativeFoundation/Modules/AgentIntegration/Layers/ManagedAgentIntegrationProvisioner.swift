import Foundation
import FenrirNativeShared

public extension AgentIntegration {
    struct AgentInstallTarget: Codable, Equatable, Sendable {
        public let agentID: AgentCLIIdentifier
        public let hooksFilePath: String?
        public let skillsFilePath: String?
        public let mcpConfigFilePath: String?
        public let hooksLinePrefix: String
        public let skillsLinePrefix: String

        public init(
            agentID: AgentCLIIdentifier,
            hooksFilePath: String? = nil,
            skillsFilePath: String? = nil,
            mcpConfigFilePath: String? = nil,
            hooksLinePrefix: String = "#",
            skillsLinePrefix: String = "#"
        ) {
            self.agentID = agentID
            self.hooksFilePath = hooksFilePath
            self.skillsFilePath = skillsFilePath
            self.mcpConfigFilePath = mcpConfigFilePath
            self.hooksLinePrefix = hooksLinePrefix
            self.skillsLinePrefix = skillsLinePrefix
        }
    }

    static func defaultManagedAgentInstallTargets(configurationRootPath: String = "~/.fenrir/native-agent-integrations") -> [AgentInstallTarget] {
        supportedAgentDescriptors
            .filter { $0.id != .custom && $0.id != .future }
            .map { descriptor in
                let basePath = managedAgentIntegrationPath(configurationRootPath, descriptor.id.rawValue)
                return AgentInstallTarget(
                    agentID: descriptor.id,
                    hooksFilePath: managedAgentIntegrationPath(basePath, "hooks.conf"),
                    skillsFilePath: managedAgentIntegrationPath(basePath, "skills.md"),
                    mcpConfigFilePath: managedAgentIntegrationPath(basePath, "mcp.json")
                )
            }
    }

    struct AgentIntegrationConfigBackup: Codable, Equatable, Sendable {
        public let originalPath: String
        public let backupPath: String
        public let reason: String
        public let content: String

        public init(originalPath: String, backupPath: String, reason: String, content: String) {
            self.originalPath = originalPath
            self.backupPath = backupPath
            self.reason = reason
            self.content = content
        }
    }

    protocol AgentIntegrationConfigFileStoring: Sendable {
        func readTextFile(at path: String) async throws -> String?
        func writeTextFile(_ content: String, at path: String) async throws
        func removeTextFile(at path: String) async throws
        func createBackup(of content: String, at path: String, reason: String) async throws -> AgentIntegrationConfigBackup
    }

    actor InMemoryAgentIntegrationConfigFileStore: AgentIntegrationConfigFileStoring {
        private var storedFiles: [String: String]
        private var storedBackups: [AgentIntegrationConfigBackup]

        public init(files: [String: String] = [:], backups: [AgentIntegrationConfigBackup] = []) {
            self.storedFiles = files
            self.storedBackups = backups
        }

        public func readTextFile(at path: String) async throws -> String? {
            storedFiles[path]
        }

        public func writeTextFile(_ content: String, at path: String) async throws {
            storedFiles[path] = content
        }

        public func removeTextFile(at path: String) async throws {
            storedFiles.removeValue(forKey: path)
        }

        public func createBackup(of content: String, at path: String, reason: String) async throws -> AgentIntegrationConfigBackup {
            let backup = AgentIntegrationConfigBackup(
                originalPath: path,
                backupPath: "\(path).fenrir-backup-\(storedBackups.count + 1)",
                reason: reason,
                content: content
            )
            storedBackups.append(backup)
            return backup
        }

        public func seed(_ content: String, at path: String) {
            storedFiles[path] = content
        }

        public func content(at path: String) -> String? {
            storedFiles[path]
        }

        public func backups() -> [AgentIntegrationConfigBackup] {
            storedBackups
        }
    }

    struct LocalAgentIntegrationConfigFileStore: AgentIntegrationConfigFileStoring, Sendable {
        public init() {}

        public func readTextFile(at path: String) async throws -> String? {
            let url = localAgentIntegrationURL(for: path)
            guard FileManager.default.fileExists(atPath: url.path) else {
                return nil
            }
            return try String(contentsOf: url, encoding: .utf8)
        }

        public func writeTextFile(_ content: String, at path: String) async throws {
            let url = localAgentIntegrationURL(for: path)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(content.utf8).write(to: url, options: [.atomic])
        }

        public func removeTextFile(at path: String) async throws {
            let url = localAgentIntegrationURL(for: path)
            guard FileManager.default.fileExists(atPath: url.path) else {
                return
            }
            try FileManager.default.removeItem(at: url)
        }

        public func createBackup(of content: String, at path: String, reason: String) async throws -> AgentIntegrationConfigBackup {
            let backupPath = "\(path).fenrir-backup-\(UUID().uuidString)"
            try await writeTextFile(content, at: backupPath)
            return AgentIntegrationConfigBackup(originalPath: path, backupPath: backupPath, reason: reason, content: content)
        }
    }

    actor ManagedAgentIntegrationProvisioner: AgentIntegrationInstalling, AgentMCPProvisioning {
        private let targetsByAgentID: [AgentCLIIdentifier: AgentInstallTarget]
        private let configStore: any AgentIntegrationConfigFileStoring
        private let clock: any AgentIntegrationClock
        private let integrationVersion: IntegrationVersion

        public init(
            targets: [AgentInstallTarget] = AgentIntegration.defaultManagedAgentInstallTargets(),
            configStore: any AgentIntegrationConfigFileStoring,
            clock: any AgentIntegrationClock,
            integrationVersion: IntegrationVersion = "1.0.0"
        ) {
            self.targetsByAgentID = Dictionary(uniqueKeysWithValues: targets.map { ($0.agentID, $0) })
            self.configStore = configStore
            self.clock = clock
            self.integrationVersion = integrationVersion
        }

        public func installAgentIntegration(_ request: AgentProvisioningRequest) async throws -> AgentProvisioningResult {
            let changed = try await installTextArtifacts(for: request)
            return provisioningResult(
                request,
                change: changed ? .installed : .unchanged,
                state: .installed,
                installedVersion: request.targetVersion
            )
        }

        public func updateAgentIntegration(_ request: AgentProvisioningRequest) async throws -> AgentProvisioningResult {
            let changed = try await installTextArtifacts(for: request)
            return provisioningResult(
                request,
                change: changed ? .updated : .unchanged,
                state: .installed,
                installedVersion: request.targetVersion
            )
        }

        public func removeAgentIntegration(_ request: AgentProvisioningRequest) async throws -> AgentProvisioningResult {
            let changed = try await removeTextArtifacts(for: request)
            return provisioningResult(
                request,
                change: changed ? .removed : .unchanged,
                state: .notInstalled,
                installedVersion: nil
            )
        }

        public func provisionAgentMCP(_ request: AgentMCPProvisioningRequest) async throws -> AgentMCPProvisioningResult {
            let descriptor = try supportedDescriptor(for: request.agentID)
            let target = try installTarget(for: descriptor.id)
            guard descriptor.supportsMCP, let path = target.mcpConfigFilePath else {
                throw AgentIntegrationError.unavailable
            }

            let original = try await configStore.readTextFile(at: path) ?? ""
            let rendered: String
            do {
                rendered = try renderMCPConfig(original: original, request: request)
            } catch let error as AgentIntegrationError {
                if case .configConflict = error, !original.isEmpty {
                    _ = try await configStore.createBackup(of: original, at: path, reason: "fenrir-agent-mcp-conflict")
                }
                throw error
            }

            guard rendered != original else {
                return AgentMCPProvisioningResult(requestID: request.requestID, agentID: request.agentID, workspaceID: request.workspaceID, change: .unchanged, timestamp: clock.now())
            }
            if !original.isEmpty {
                _ = try await configStore.createBackup(of: original, at: path, reason: "before-fenrir-agent-mcp-write")
            }
            try await configStore.writeTextFile(rendered, at: path)
            let change: ProvisioningChange = request.servers.isEmpty ? .removed : .updated
            return AgentMCPProvisioningResult(requestID: request.requestID, agentID: request.agentID, workspaceID: request.workspaceID, change: change, timestamp: clock.now())
        }
    }
}

private extension AgentIntegration.ManagedAgentIntegrationProvisioner {
    struct ManagedTextArtifact: Sendable {
        let path: String
        let blockID: String
        let linePrefix: String
        let body: String
    }

    func installTextArtifacts(for request: AgentIntegration.AgentProvisioningRequest) async throws -> Bool {
        let artifacts = try textArtifacts(for: request)
        var changed = false
        for artifact in artifacts {
            let artifactChanged = try await editTextArtifact(artifact) { editor, original in
                try editor.install(into: original, managedBody: artifact.body)
            }
            changed = changed || artifactChanged
        }
        return changed
    }

    func removeTextArtifacts(for request: AgentIntegration.AgentProvisioningRequest) async throws -> Bool {
        let artifacts = try textArtifacts(for: request)
        var changed = false
        for artifact in artifacts {
            let artifactChanged = try await editTextArtifact(artifact) { editor, original in
                try editor.remove(from: original)
            }
            changed = changed || artifactChanged
        }
        return changed
    }

    func textArtifacts(for request: AgentIntegration.AgentProvisioningRequest) throws -> [ManagedTextArtifact] {
        let descriptor = try supportedDescriptor(for: request.agentID)
        let target = try installTarget(for: descriptor.id)
        var artifacts: [ManagedTextArtifact] = []
        if descriptor.supportsHooks, let path = target.hooksFilePath {
            artifacts.append(ManagedTextArtifact(
                path: path,
                blockID: "\(descriptor.id.rawValue)-hooks",
                linePrefix: target.hooksLinePrefix,
                body: hookBody(for: descriptor, version: request.targetVersion)
            ))
        }
        if descriptor.supportsSkills, let path = target.skillsFilePath {
            artifacts.append(ManagedTextArtifact(
                path: path,
                blockID: "\(descriptor.id.rawValue)-skills",
                linePrefix: target.skillsLinePrefix,
                body: skillBody(for: descriptor, version: request.targetVersion)
            ))
        }
        guard !artifacts.isEmpty else {
            throw AgentIntegration.AgentIntegrationError.unavailable
        }
        return artifacts
    }

    func editTextArtifact(
        _ artifact: ManagedTextArtifact,
        operation: (AgentIntegration.ManagedConfigBlockEditor, String) throws -> AgentIntegration.ManagedConfigEditResult
    ) async throws -> Bool {
        let original = try await configStore.readTextFile(at: artifact.path) ?? ""
        let editor = AgentIntegration.ManagedConfigBlockEditor(
            ownership: AgentIntegration.ManagedConfigOwnership(version: integrationVersion, blockID: artifact.blockID),
            linePrefix: artifact.linePrefix
        )
        let edit: AgentIntegration.ManagedConfigEditResult
        do {
            edit = try operation(editor, original)
        } catch let error as AgentIntegration.AgentIntegrationError {
            if case .configConflict = error, !original.isEmpty {
                _ = try await configStore.createBackup(of: original, at: artifact.path, reason: "fenrir-agent-integration-conflict")
            }
            throw error
        }
        guard edit.changed else {
            return false
        }
        if !original.isEmpty {
            _ = try await configStore.createBackup(of: original, at: artifact.path, reason: "before-fenrir-agent-integration-write")
        }
        try await configStore.writeTextFile(edit.content, at: artifact.path)
        return true
    }

    func renderMCPConfig(original: String, request: AgentIntegration.AgentMCPProvisioningRequest) throws -> String {
        var root = try parseMCPRoot(original: original)
        var servers = root["mcpServers"] as? [String: Any] ?? [:]
        for serverName in Array(servers.keys) {
            if isFenrirOwnedMCPServer(servers[serverName], workspaceID: request.workspaceID) {
                servers.removeValue(forKey: serverName)
            }
        }
        for server in request.servers {
            let trimmedName = server.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedName.isEmpty else {
                throw AgentIntegration.AgentIntegrationError.configConflict("MCP server names cannot be empty")
            }
            servers[trimmedName] = [
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
        root["mcpServers"] = servers
        guard JSONSerialization.isValidJSONObject(root) else {
            throw AgentIntegration.AgentIntegrationError.configConflict("MCP config cannot be serialized")
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
            guard var rendered = String(data: data, encoding: .utf8) else {
                throw AgentIntegration.AgentIntegrationError.configConflict("MCP config cannot be encoded as UTF-8")
            }
            if !rendered.hasSuffix("\n") {
                rendered += "\n"
            }
            return rendered
        } catch let error as AgentIntegration.AgentIntegrationError {
            throw error
        } catch {
            throw AgentIntegration.AgentIntegrationError.configConflict("MCP config cannot be serialized")
        }
    }

    func parseMCPRoot(original: String) throws -> [String: Any] {
        let trimmed = original.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return [:]
        }
        do {
            guard let root = try JSONSerialization.jsonObject(with: Data(original.utf8), options: []) as? [String: Any] else {
                throw AgentIntegration.AgentIntegrationError.configConflict("MCP config root must be a JSON object")
            }
            return root
        } catch let error as AgentIntegration.AgentIntegrationError {
            throw error
        } catch {
            throw AgentIntegration.AgentIntegrationError.configConflict("MCP config contains invalid JSON")
        }
    }

    func isFenrirOwnedMCPServer(_ value: Any?, workspaceID: WorkspaceID) -> Bool {
        guard let server = value as? [String: Any],
              let metadata = server["_fenrir"] as? [String: Any],
              metadata["owner"] as? String == AgentIntegration.ManagedConfigOwnership.owner,
              metadata["workspaceID"] as? String == workspaceID.rawValue
        else {
            return false
        }
        return true
    }

    func supportedDescriptor(for agentID: AgentIntegration.AgentCLIIdentifier) throws -> AgentIntegration.AgentDescriptor {
        guard let descriptor = AgentIntegration.supportedAgentDescriptors.first(where: { $0.id == agentID }),
              descriptor.id != .custom,
              descriptor.id != .future
        else {
            throw AgentIntegration.AgentIntegrationError.unsupportedAgent(agentID)
        }
        return descriptor
    }

    func installTarget(for agentID: AgentIntegration.AgentCLIIdentifier) throws -> AgentIntegration.AgentInstallTarget {
        guard let target = targetsByAgentID[agentID] else {
            throw AgentIntegration.AgentIntegrationError.unavailable
        }
        return target
    }

    func provisioningResult(
        _ request: AgentIntegration.AgentProvisioningRequest,
        change: AgentIntegration.ProvisioningChange,
        state: AgentIntegration.IntegrationState,
        installedVersion: AgentIntegration.IntegrationVersion?
    ) -> AgentIntegration.AgentProvisioningResult {
        let descriptor = (try? supportedDescriptor(for: request.agentID)) ?? AgentIntegration.AgentDescriptor(
            id: request.agentID,
            displayName: request.agentID.rawValue,
            executableNames: [],
            supportsHooks: false,
            supportsSkills: false,
            supportsMCP: false
        )
        let ownership = state == .notInstalled ? nil : AgentIntegration.ManagedConfigOwnership(version: request.targetVersion, blockID: "\(request.agentID.rawValue)-integration")
        let status = AgentIntegration.AgentIntegrationStatus(
            agent: descriptor,
            state: state,
            installedVersion: installedVersion,
            expectedVersion: request.targetVersion,
            ownership: ownership,
            detectedExecutablePath: nil
        )
        return AgentIntegration.AgentProvisioningResult(requestID: request.requestID, agentID: request.agentID, change: change, status: status, timestamp: clock.now())
    }

    func hookBody(for descriptor: AgentIntegration.AgentDescriptor, version: AgentIntegration.IntegrationVersion) -> String {
        [
            "fenrir.agent.id=\(descriptor.id.rawValue)",
            "fenrir.agent.display_name=\(descriptor.displayName)",
            "fenrir.agent.integration.version=\(version.rawValue)",
            "fenrir.agent.presence.osc=\(AgentIntegration.AgentPresenceSignal.oscIdentifier)",
            "fenrir.agent.presence.namespace=\(AgentIntegration.AgentPresenceSignal.namespace)",
            "fenrir.agent.presence.mode=metadata-only",
            // D-044: session-start presence events carry the agent-native
            // session id (when the CLI exposes one) so dead agent panes stay
            // resumable. Ids stay metadata; commands come only from the
            // client-side resume descriptor table.
            "fenrir.agent.presence.session_start.session_id=include-when-available",
            "fenrir.agent.presence.session_id.pattern=\(AgentIntegration.agentSessionIDPattern)"
        ].joined(separator: "\n")
    }

    func skillBody(for descriptor: AgentIntegration.AgentDescriptor, version: AgentIntegration.IntegrationVersion) -> String {
        [
            "# Fenrir Native Agent Skill",
            "",
            "Agent: \(descriptor.displayName)",
            "Integration version: \(version.rawValue)",
            "Presence mode: metadata-only",
            "",
            "Fenrir Native treats terminal panes as user-owned. Report session state through reserved OSC \(AgentIntegration.AgentPresenceSignal.oscIdentifier) using namespace \(AgentIntegration.AgentPresenceSignal.namespace). Do not write into unrelated panes."
        ].joined(separator: "\n")
    }
}

private func managedAgentIntegrationPath(_ base: String, _ component: String) -> String {
    if base.hasSuffix("/") {
        return base + component
    }
    return base + "/" + component
}

private func localAgentIntegrationURL(for path: String) -> URL {
    if path.hasPrefix("~/") {
        let relativePath = String(path.dropFirst(2))
        return FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(relativePath)
    }
    return URL(fileURLWithPath: path)
}
