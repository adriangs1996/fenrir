import Foundation
import FenrirNativeShared
import AuthSession
import ServerConnection
import Settings

/// Resolves the optional REMOTE Fenrir server target for the native app.
///
/// Priority:
/// 1. `FENRIR_REMOTE_SERVER_URL` environment variable (http/https base URL).
/// 2. The settings file's `serverConnection` block when `startupMode` is
///    `connectToRemoteProfile` and a default remote profile is configured.
///
/// When neither is present the app keeps its local-default startup (discover
/// or spawn a loopback server). Credentials for a remote target come from the
/// standard bootstrap env vars (pairing token or an owner-issued bearer from
/// `auth session issue --token-only`) with the exchanged bearer persisted in
/// the Keychain per endpoint, so a token only needs to be supplied once.
enum NativeRemoteServerConfiguration {
    static let serverURLEnvironmentKey = "FENRIR_REMOTE_SERVER_URL"

    /// Placeholder bootstrap credential used when the Keychain already holds a
    /// bearer for the endpoint and no fresh pairing token was supplied. The
    /// transport serves the stored bearer before ever exchanging this value;
    /// if the stored bearer is gone the exchange fails with a clean auth
    /// rejection instead of a missing-credential crash.
    static let storedSessionCredentialPlaceholder = "fenrir-remote-stored-session"

    struct Target: Equatable, Sendable {
        let endpoint: ServerConnection.Endpoint
    }

    static func target(environment: [String: String] = ProcessInfo.processInfo.environment) -> Target? {
        guard let raw = environment[serverURLEnvironmentKey]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty
        else {
            return nil
        }
        return target(endpointURL: raw, profileID: nil, displayName: "Remote Fenrir")
    }

    static func resolveTarget(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        makeSettingsPersistence: @Sendable () throws -> any Settings.LocalSettingsPersistence = {
            try Settings.applicationSupportSettingsPersistence()
        }
    ) async -> Target? {
        if let environmentTarget = target(environment: environment) {
            return environmentTarget
        }

        guard let persistence = try? makeSettingsPersistence() else {
            return nil
        }
        let result = await Settings.ReadSettings(
            clock: NativeSettingsClock(),
            persistence: persistence
        ).run(Settings.ReadSettingsInput(
            requestID: "native-remote-server-settings-read",
            source: .nativeHost
        ))
        guard case .success(let settings) = result else {
            return nil
        }
        let connection = settings.configuration.serverConnection
        guard connection.startupMode == .connectToRemoteProfile,
              let profileID = connection.defaultRemoteProfileID,
              let profile = connection.remoteProfiles.first(where: { $0.id == profileID })
        else {
            return nil
        }
        return target(
            endpointURL: profile.endpointURL,
            profileID: profile.id,
            displayName: profile.displayName
        )
    }

    static func target(endpointURL: String, profileID: ProfileID?, displayName: String) -> Target? {
        guard let httpBaseURL = normalizedHTTPBaseURL(endpointURL),
              let webSocketURL = webSocketURL(fromHTTPBaseURL: httpBaseURL)
        else {
            return nil
        }
        return Target(endpoint: ServerConnection.Endpoint(
            kind: .remote,
            transport: .webSocketURL(webSocketURL),
            profileID: profileID,
            httpBaseURL: httpBaseURL,
            displayName: displayName,
            requiresBootstrap: true
        ))
    }

    /// Remote startup never generates a credential: a generated token can only
    /// ever authenticate against a server this process spawns. Absent an
    /// env-provided pairing token or bearer, rely on the Keychain-stored
    /// session via the placeholder.
    static func bootstrapCredential(
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> String {
        NativeDesktopBootstrapCredential.resolve(environment: environment, generateIfMissing: false)
            ?? storedSessionCredentialPlaceholder
    }

    /// Only http/https base URLs are accepted (mirrors the pairing-URL
    /// protocol allowlist on the web side); anything else is rejected rather
    /// than passed to the transport.
    private static func normalizedHTTPBaseURL(_ raw: String) -> String? {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while value.hasSuffix("/") {
            value.removeLast()
        }
        guard let url = URL(string: value),
              let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host,
              !host.isEmpty
        else {
            return nil
        }
        return value
    }

    private static func webSocketURL(fromHTTPBaseURL base: String) -> String? {
        let lowered = base.lowercased()
        if lowered.hasPrefix("https://") {
            return "wss://" + base.dropFirst("https://".count) + "/ws"
        }
        if lowered.hasPrefix("http://") {
            return "ws://" + base.dropFirst("http://".count) + "/ws"
        }
        return nil
    }
}

/// Supervisor stand-in for remote endpoints: `PrepareLocalServerConnection`
/// requires the local-server collaborators even though its `.remote` branch
/// never discovers, spawns, or kills anything. Shutdown is a no-op because a
/// remote server's lifecycle is never owned by this app.
struct NativeRemoteServerSupervisorStub: ServerConnection.LocalServerDiscovering,
    ServerConnection.LocalServerSpawning,
    ServerConnection.LocalServerReadinessChecking,
    ServerConnection.LocalServerProcessManaging
{
    func discoverLocalServer(_ spec: ServerConnection.LocalServerSpec) async throws -> ServerConnection.LocalServerDiscovery {
        throw ServerConnection.ServerConnectionError.endpointUnsupported
    }

    func spawnLocalServer(_ spec: ServerConnection.LocalServerSpec, restartCount: Int) async throws -> ServerConnection.LocalServerProcessSnapshot {
        throw ServerConnection.ServerConnectionError.endpointUnsupported
    }

    func waitForLocalServerReadiness(
        _ candidate: ServerConnection.LocalServerReadinessCandidate,
        timeoutMilliseconds: Int
    ) async throws -> ServerConnection.Endpoint {
        throw ServerConnection.ServerConnectionError.endpointUnsupported
    }

    func shutdownLocalServer(processID: ServerConnection.LocalServerProcessID) async throws {}
}
