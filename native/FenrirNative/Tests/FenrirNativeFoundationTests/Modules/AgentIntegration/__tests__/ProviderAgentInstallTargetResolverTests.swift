import Foundation
import Testing
import FenrirNativeShared
@testable import AgentIntegration

@Suite("Provider agent install target resolver")
struct ProviderAgentInstallTargetResolverTests {
    @Test("provider resolver returns real paths for supported agent defaults")
    func resolvesProviderDefaults() async throws {
        let resolver = AgentIntegration.ProviderAgentInstallTargetResolver(homeDirectoryPath: "/Users/test")

        let targets = try await resolver.resolveAgentProviderInstallTargets()
        let claude = try #require(targets.first { $0.agent.id == .claudeCode })
        let codex = try #require(targets.first { $0.agent.id == .codex })
        let cursor = try #require(targets.first { $0.agent.id == .cursor })
        let openCode = try #require(targets.first { $0.agent.id == .openCode })

        #expect(targets.map { $0.agent.id } == [.claudeCode, .codex, .cursor, .openCode])
        #expect(claude.configurationDirectoryPath == "/Users/test/.claude")
        #expect(claude.fileTargets.map(\.path).contains("/Users/test/.claude/settings.json"))
        #expect(claude.fileTargets.map(\.path).contains("/Users/test/.claude/skills/fenrir-native/SKILL.md"))
        #expect(codex.fileTargets.map(\.path).contains("/Users/test/.codex/hooks.json"))
        #expect(codex.fileTargets.map(\.path).contains("/Users/test/.codex/config.toml"))
        #expect(cursor.fileTargets == [AgentIntegration.AgentProviderFileTarget(
            artifact: .mcp,
            path: "/Users/test/.cursor/mcp.json",
            format: .jsonMCP,
            writeStrategy: .sharedStructuredMerge,
            requiresProviderSpecificRenderer: true,
            notes: ["Cursor has a stable MCP surface, but no accepted Fenrir hook or skill installer in the base native client."]
        )])
        #expect(openCode.fileTargets.map(\.path).contains("/Users/test/.config/opencode/plugins/fenrir-presence.js"))
        #expect(openCode.fileTargets.map(\.path).contains("/Users/test/.config/opencode/skills/fenrir-native/SKILL.md"))
    }

    @Test("provider resolver marks shared provider config as requiring structured renderers")
    func marksStructuredRendererBoundaries() async throws {
        let resolver = AgentIntegration.ProviderAgentInstallTargetResolver(homeDirectoryPath: "~")
        let codex = try await resolver.resolveAgentProviderInstallTarget(for: .codex)
        let hookTarget = try #require(codex.fileTargets.first { $0.artifact == .hooks })
        let skillTarget = try #require(codex.fileTargets.first { $0.artifact == .skills })

        #expect(hookTarget.format == .jsonHooks)
        #expect(hookTarget.writeStrategy == .sharedStructuredMerge)
        #expect(hookTarget.requiresProviderSpecificRenderer)
        #expect(skillTarget.format == .markdownSkill)
        #expect(skillTarget.writeStrategy == .ownedFile)
        #expect(!skillTarget.requiresProviderSpecificRenderer)
        #expect(codex.requiresProviderSpecificRenderer)
    }

    @Test("provider resolver rejects custom and future targets")
    func rejectsUnsupportedTargets() async {
        let resolver = AgentIntegration.ProviderAgentInstallTargetResolver()

        await #expect(throws: AgentIntegration.AgentIntegrationError.unsupportedAgent(.custom)) {
            _ = try await resolver.resolveAgentProviderInstallTarget(for: .custom)
        }
        await #expect(throws: AgentIntegration.AgentIntegrationError.unsupportedAgent(.future)) {
            _ = try await resolver.resolveAgentProviderInstallTarget(for: .future)
        }
    }

    @Test("resolve provider targets action filters by agent and stamps timestamp")
    func actionFiltersByAgent() async throws {
        let resolver = AgentIntegration.ProviderAgentInstallTargetResolver(homeDirectoryPath: "/Users/test")
        let action = AgentIntegration.ResolveAgentProviderInstallTargets(resolver: resolver, clock: fixedProviderTargetClock)

        let result = try await action.run(.init(requestID: "targets", agentID: .openCode, source: .test)).get()

        #expect(result.requestID == "targets")
        #expect(result.timestamp == fixedProviderTargetClock.now())
        #expect(result.targets.map { $0.agent.id } == [.openCode])
        #expect(result.targets.first?.fileTargets.first?.path == "/Users/test/.config/opencode/plugins/fenrir-presence.js")
    }
}

private let fixedProviderTargetClock = AgentIntegration.FixedAgentIntegrationClock(timestamp: FenrirTimestamp(Date(timeIntervalSince1970: 1_700_000_123)))
