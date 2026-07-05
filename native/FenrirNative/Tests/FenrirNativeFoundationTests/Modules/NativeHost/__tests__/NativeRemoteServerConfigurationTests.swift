import Foundation
import Testing
import FenrirNativeShared
import ServerConnection
import Settings
@testable import FenrirNativeApp

struct NativeRemoteServerConfigurationTests {
    @Test("Env-provided URL resolves a remote endpoint with a derived websocket URL")
    func environmentURLResolvesRemoteTarget() {
        let target = NativeRemoteServerConfiguration.target(environment: [
            "FENRIR_REMOTE_SERVER_URL": "http://fenrir-box.local:31337/"
        ])

        #expect(target != nil)
        #expect(target?.endpoint.kind == .remote)
        #expect(target?.endpoint.httpBaseURL == "http://fenrir-box.local:31337")
        #expect(target?.endpoint.transport == .webSocketURL("ws://fenrir-box.local:31337/ws"))
        #expect(target?.endpoint.requiresBootstrap == true)
    }

    @Test("HTTPS base URLs derive wss websocket URLs")
    func httpsDerivesWss() {
        let target = NativeRemoteServerConfiguration.target(environment: [
            "FENRIR_REMOTE_SERVER_URL": "https://fenrir.tailnet.ts.net"
        ])

        #expect(target?.endpoint.httpBaseURL == "https://fenrir.tailnet.ts.net")
        #expect(target?.endpoint.transport == .webSocketURL("wss://fenrir.tailnet.ts.net/ws"))
    }

    @Test("Non-http(s) URLs and empty values are rejected")
    func invalidURLsAreRejected() {
        #expect(NativeRemoteServerConfiguration.target(environment: [
            "FENRIR_REMOTE_SERVER_URL": "file:///etc/passwd"
        ]) == nil)
        #expect(NativeRemoteServerConfiguration.target(environment: [
            "FENRIR_REMOTE_SERVER_URL": "javascript:alert(1)"
        ]) == nil)
        #expect(NativeRemoteServerConfiguration.target(environment: [
            "FENRIR_REMOTE_SERVER_URL": "   "
        ]) == nil)
        #expect(NativeRemoteServerConfiguration.target(environment: [:]) == nil)
    }

    @Test("Settings remote profile resolves when startup mode is connectToRemoteProfile")
    func settingsProfileResolvesTarget() async {
        let persistence = StaticSettingsPersistence(json: #"""
        {
            "serverConnection": {
                "startupMode": "connectToRemoteProfile",
                "defaultRemoteProfileID": "workbox",
                "remoteProfiles": [
                    {
                        "id": "workbox",
                        "displayName": "Workbox",
                        "endpointURL": "http://10.0.0.7:31337"
                    }
                ]
            }
        }
        """#)

        let target = await NativeRemoteServerConfiguration.resolveTarget(
            environment: [:],
            makeSettingsPersistence: { persistence }
        )

        #expect(target?.endpoint.httpBaseURL == "http://10.0.0.7:31337")
        #expect(target?.endpoint.profileID == ProfileID(rawValue: "workbox"))
        #expect(target?.endpoint.displayName == "Workbox")
    }

    @Test("Settings without remote startup mode resolve no target")
    func defaultSettingsResolveNoTarget() async {
        let persistence = StaticSettingsPersistence(json: "{}")

        let target = await NativeRemoteServerConfiguration.resolveTarget(
            environment: [:],
            makeSettingsPersistence: { persistence }
        )

        #expect(target == nil)
    }

    @Test("Environment URL wins over settings profiles")
    func environmentWinsOverSettings() async {
        let persistence = StaticSettingsPersistence(json: #"""
        {
            "serverConnection": {
                "startupMode": "connectToRemoteProfile",
                "defaultRemoteProfileID": "workbox",
                "remoteProfiles": [
                    {"id": "workbox", "displayName": "Workbox", "endpointURL": "http://10.0.0.7:31337"}
                ]
            }
        }
        """#)

        let target = await NativeRemoteServerConfiguration.resolveTarget(
            environment: ["FENRIR_REMOTE_SERVER_URL": "http://192.168.1.20:31337"],
            makeSettingsPersistence: { persistence }
        )

        #expect(target?.endpoint.httpBaseURL == "http://192.168.1.20:31337")
        #expect(target?.endpoint.profileID == nil)
    }

    @Test("Remote bootstrap credential never generates a token")
    func remoteBootstrapCredentialUsesEnvOrPlaceholder() {
        #expect(NativeRemoteServerConfiguration.bootstrapCredential(environment: [
            "FENRIR_NATIVE_BOOTSTRAP_TOKEN": "PAIRING12345"
        ]) == "PAIRING12345")
        #expect(NativeRemoteServerConfiguration.bootstrapCredential(environment: [:])
            == NativeRemoteServerConfiguration.storedSessionCredentialPlaceholder)
    }
}

private struct StaticSettingsPersistence: Settings.LocalSettingsPersistence {
    let json: String

    func loadSettingsData() async throws -> Data? {
        Data(json.utf8)
    }

    func saveSettingsData(_ data: Data) async throws {}

    func observeSettingsData() -> AsyncStream<Result<Data?, Settings.SettingsPersistenceFailure>> {
        AsyncStream { continuation in
            continuation.finish()
        }
    }
}
