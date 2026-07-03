import Foundation

public extension AgentIntegration {
    static let layerNotes = """
    AgentIntegration live layers are adapter-owned and port-backed.
    PathAgentIntegrationDetector only reads PATH. ManagedAgentIntegrationProvisioner
    performs explicit hook, skill, and MCP config provisioning through a config
    file store with managed markers, backups, and conflict detection. No layer
    exposes a pane-write capability.
    """
}
