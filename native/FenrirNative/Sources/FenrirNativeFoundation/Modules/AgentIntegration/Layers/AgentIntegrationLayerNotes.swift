import Foundation

public extension AgentIntegration {
    static let layerNotes = """
    AgentIntegration live layers are intentionally adapter-owned.
    This foundation slice ships in-memory/test stores and pure config editing
    primitives only; live agent config directory writes must stay behind the
    installer and MCP provisioner ports.
    """
}
