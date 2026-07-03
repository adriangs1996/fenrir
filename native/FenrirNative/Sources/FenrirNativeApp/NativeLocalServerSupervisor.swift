import Foundation
import FenrirNativeShared
import ServerConnection

struct NativeLocalServerLaunchConfiguration: Sendable, Equatable, CustomStringConvertible {
    let executableURL: URL
    let arguments: [String]
    let environment: [String: String]
    let workingDirectoryURL: URL?

    init(
        executableURL: URL,
        arguments: [String] = [],
        environment: [String: String] = [:],
        workingDirectoryURL: URL? = nil
    ) {
        self.executableURL = executableURL
        self.arguments = arguments
        self.environment = environment
        self.workingDirectoryURL = workingDirectoryURL
    }

    var description: String {
        "NativeLocalServerLaunchConfiguration(executableURL: \(executableURL.path), arguments: \(arguments.count), environment: <redacted>, workingDirectoryURL: \(workingDirectoryURL?.path ?? "nil"))"
    }
}

struct NativeLocalServerLaunchRequest: Sendable, Equatable, CustomStringConvertible {
    let configuration: NativeLocalServerLaunchConfiguration
    let endpoint: ServerConnection.Endpoint
    let restartCount: Int

    var description: String {
        "NativeLocalServerLaunchRequest(configuration: \(configuration), endpointID: \(endpoint.endpointID), restartCount: \(restartCount))"
    }
}

struct NativeLocalServerLaunchedProcess: Sendable, Equatable {
    let processID: String
}

protocol ProcessLaunching: Sendable {
    func launchLocalServer(_ request: NativeLocalServerLaunchRequest) async throws -> NativeLocalServerLaunchedProcess
    func terminateLocalServer(processID: String) async throws
}

struct NativeLocalServerHTTPProbeRequest: Sendable, Equatable {
    let url: URL
    let method: String
    let timeoutMilliseconds: Int
}

struct NativeLocalServerHTTPProbeResponse: Sendable, Equatable {
    let statusCode: Int
    let headers: [String: String]
    let body: Data
}

protocol NativeLocalServerHTTPProbing: Sendable {
    func probeLocalServer(_ request: NativeLocalServerHTTPProbeRequest) async throws -> NativeLocalServerHTTPProbeResponse
}

struct NativeLocalServerSupervisor: ServerConnection.LocalServerDiscovering,
    ServerConnection.LocalServerReadinessChecking,
    ServerConnection.LocalServerSpawning,
    ServerConnection.LocalServerProcessManaging
{
    static let defaultHost = "127.0.0.1"
    static let defaultPort = 31337
    static let defaultProbePath = "/.well-known/t3/environment"
    static let defaultServerResourceName = "fenrir-server"
    static let developmentServerEntryRelativePath = "apps/server/src/bin.ts"

    private let launchConfiguration: NativeLocalServerLaunchConfiguration
    private let launcher: any ProcessLaunching
    private let prober: any NativeLocalServerHTTPProbing
    private let clock: any FenrirClock
    private let probePath: String
    private let pollIntervalMilliseconds: Int
    private let ownership: NativeLocalServerProcessOwnership

    init(
        launchConfiguration: NativeLocalServerLaunchConfiguration,
        launcher: any ProcessLaunching = NativeFoundationProcessLauncher(),
        prober: any NativeLocalServerHTTPProbing = NativeURLSessionLocalServerHTTPProber(),
        clock: any FenrirClock = SystemFenrirClock(),
        probePath: String = NativeLocalServerSupervisor.defaultProbePath,
        pollIntervalMilliseconds: Int = 100,
        ownership: NativeLocalServerProcessOwnership = NativeLocalServerProcessOwnership()
    ) {
        self.launchConfiguration = launchConfiguration
        self.launcher = launcher
        self.prober = prober
        self.clock = clock
        self.probePath = probePath
        self.pollIntervalMilliseconds = max(1, pollIntervalMilliseconds)
        self.ownership = ownership
    }

    static func localDefault(
        bundle: Bundle = .main,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        currentDirectoryURL: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
        fileManager: FileManager = .default
    ) -> NativeLocalServerSupervisor {
        return NativeLocalServerSupervisor(
            launchConfiguration: localDefaultLaunchConfiguration(
                bundle: bundle,
                environment: environment,
                currentDirectoryURL: currentDirectoryURL,
                fileManager: fileManager
            )
        )
    }

    static func localDefaultLaunchConfiguration(
        bundle: Bundle = .main,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        currentDirectoryURL: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
        fileManager: FileManager = .default
    ) -> NativeLocalServerLaunchConfiguration {
        let workspaceRoot = workspaceRootURL(environment: environment, fallback: currentDirectoryURL)
        if let explicitAssetURL = explicitServerAssetURL(environment: environment, relativeTo: currentDirectoryURL) {
            return serverExecutableLaunchConfiguration(
                executableURL: explicitAssetURL,
                workspaceRootURL: workspaceRoot,
                environment: environment
            )
        }

        if let bundledURL = bundle.url(forResource: defaultServerResourceName, withExtension: nil) {
            return serverExecutableLaunchConfiguration(
                executableURL: bundledURL,
                workspaceRootURL: workspaceRoot,
                environment: environment
            )
        }

        if let developmentConfiguration = developmentLaunchConfiguration(
            environment: environment,
            currentDirectoryURL: currentDirectoryURL,
            fileManager: fileManager
        ) {
            return developmentConfiguration
        }

        return NativeLocalServerLaunchConfiguration(
            executableURL: URL(fileURLWithPath: "/nonexistent/fenrir-server")
        )
    }

    static func canLaunchDevelopmentServer(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        currentDirectoryURL: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
        fileManager: FileManager = .default
    ) -> Bool {
        developmentLaunchConfiguration(
            environment: environment,
            currentDirectoryURL: currentDirectoryURL,
            fileManager: fileManager
        ) != nil
    }

    static func developmentLaunchConfiguration(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        currentDirectoryURL: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
        fileManager: FileManager = .default
    ) -> NativeLocalServerLaunchConfiguration? {
        guard let repositoryRootURL = repositoryRootURL(
            environment: environment,
            currentDirectoryURL: currentDirectoryURL,
            fileManager: fileManager
        ) else {
            return nil
        }

        let serverEntryURL = repositoryRootURL.appendingPathComponent(developmentServerEntryRelativePath)
        guard fileManager.fileExists(atPath: serverEntryURL.path) else {
            return nil
        }

        return NativeLocalServerLaunchConfiguration(
            executableURL: URL(fileURLWithPath: "/usr/bin/env"),
            arguments: [
                "bun",
                "run",
                "src/bin.ts",
                "--mode",
                "desktop",
                "--host",
                defaultHost,
                "--port",
                String(defaultPort),
                "--no-browser",
                "--auto-bootstrap-project-from-cwd",
                workspaceRootURL(environment: environment, fallback: repositoryRootURL).path
            ],
            environment: serverLaunchEnvironment(environment: environment),
            workingDirectoryURL: repositoryRootURL.appendingPathComponent("apps/server")
        )
    }

    func discoverLocalServer(_ spec: ServerConnection.LocalServerSpec) async throws -> ServerConnection.LocalServerDiscovery {
        do {
            let endpoint = try await probeEndpoint(spec.endpoint, timeoutMilliseconds: min(1_000, max(1, spec.readinessTimeoutMilliseconds)))
            return ServerConnection.LocalServerDiscovery(status: .found, endpoint: endpoint)
        } catch NativeLocalServerSupervisorError.unhealthy {
            return ServerConnection.LocalServerDiscovery(status: .unhealthy)
        } catch {
            return ServerConnection.LocalServerDiscovery(status: .missing)
        }
    }

    func waitForLocalServerReadiness(
        _ candidate: ServerConnection.LocalServerReadinessCandidate,
        timeoutMilliseconds: Int
    ) async throws -> ServerConnection.Endpoint {
        let endpoint = switch candidate {
        case .existing(let endpoint):
            endpoint
        case .spawned(let process):
            process.endpoint
        }
        let timeout = max(1, timeoutMilliseconds)
        let deadline = Date().addingTimeInterval(Double(timeout) / 1_000)

        repeat {
            do {
                return try await probeEndpoint(endpoint, timeoutMilliseconds: timeout)
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                if Date() >= deadline {
                    throw ServerConnection.ServerConnectionError.localServerReadinessFailed
                }
                let delayNanoseconds = UInt64(pollIntervalMilliseconds) * 1_000_000
                try await Task.sleep(nanoseconds: delayNanoseconds)
            }
        } while true
    }

    func spawnLocalServer(
        _ spec: ServerConnection.LocalServerSpec,
        restartCount: Int
    ) async throws -> ServerConnection.LocalServerProcessSnapshot {
        do {
            let endpoint = spec.endpoint
            let launched = try await launcher.launchLocalServer(NativeLocalServerLaunchRequest(
                configuration: launchConfiguration,
                endpoint: endpoint,
                restartCount: restartCount
            ))
            await ownership.insert(launched.processID)
            return ServerConnection.LocalServerProcessSnapshot(
                processID: ServerConnection.LocalServerProcessID(rawValue: launched.processID),
                endpoint: endpoint,
                startedAt: clock.now(),
                restartCount: restartCount
            )
        } catch let error as ServerConnection.ServerConnectionError {
            throw error
        } catch {
            throw ServerConnection.ServerConnectionError.localServerSpawnFailed
        }
    }

    func shutdownLocalServer(processID: ServerConnection.LocalServerProcessID) async throws {
        guard await ownership.remove(processID.rawValue) else {
            return
        }
        do {
            try await launcher.terminateLocalServer(processID: processID.rawValue)
        } catch let error as ServerConnection.ServerConnectionError {
            throw error
        } catch {
            throw ServerConnection.ServerConnectionError.localServerShutdownFailed
        }
    }

    private func probeEndpoint(
        _ endpoint: ServerConnection.Endpoint,
        timeoutMilliseconds: Int
    ) async throws -> ServerConnection.Endpoint {
        guard let httpBaseURL = endpoint.httpBaseURL,
              let url = probeURL(baseURL: httpBaseURL)
        else {
            throw NativeLocalServerSupervisorError.missing
        }
        let response = try await prober.probeLocalServer(NativeLocalServerHTTPProbeRequest(
            url: url,
            method: "GET",
            timeoutMilliseconds: max(1, timeoutMilliseconds)
        ))
        guard (200..<400).contains(response.statusCode) else {
            throw NativeLocalServerSupervisorError.unhealthy
        }
        if let expectedIdentity = endpoint.expectedServerIdentity {
            let actualIdentity = response.headers.first { key, _ in
                key.caseInsensitiveCompare("X-Fenrir-Server-Identity") == .orderedSame
            }?.value
            guard actualIdentity == expectedIdentity else {
                throw NativeLocalServerSupervisorError.unhealthy
            }
        }
        return endpoint
    }

    private func probeURL(baseURL: String) -> URL? {
        guard var components = URLComponents(string: baseURL) else {
            return nil
        }
        let path = probePath.hasPrefix("/") ? probePath : "/\(probePath)"
        components.path = path
        components.query = nil
        components.fragment = nil
        return components.url
    }

    private static func serverExecutableLaunchConfiguration(
        executableURL: URL,
        workspaceRootURL: URL,
        environment: [String: String]
    ) -> NativeLocalServerLaunchConfiguration {
        NativeLocalServerLaunchConfiguration(
            executableURL: executableURL,
            arguments: [
                "--mode",
                "desktop",
                "--host",
                defaultHost,
                "--port",
                String(defaultPort),
                "--no-browser",
                "--auto-bootstrap-project-from-cwd",
                workspaceRootURL.path
            ],
            environment: serverLaunchEnvironment(environment: environment),
            workingDirectoryURL: workspaceRootURL
        )
    }

    private static func serverLaunchEnvironment(environment: [String: String]) -> [String: String] {
        var launchEnvironment = [
            "FENRIR_MODE": "desktop",
            "FENRIR_HOST": defaultHost,
            "FENRIR_PORT": String(defaultPort),
            "FENRIR_NO_BROWSER": "true",
            "FENRIR_AUTO_BOOTSTRAP_PROJECT_FROM_CWD": "true"
        ]
        if let bootstrapCredential = NativeDesktopBootstrapCredential.resolve(environment: environment) {
            launchEnvironment["FENRIR_DESKTOP_BOOTSTRAP_TOKEN"] = bootstrapCredential
        }
        return launchEnvironment
    }

    private static func explicitServerAssetURL(
        environment: [String: String],
        relativeTo currentDirectoryURL: URL
    ) -> URL? {
        [
            "FENRIR_NATIVE_SERVER_ASSET",
            "FENRIR_SERVER_ASSET",
            "SERVER_ASSET"
        ]
            .compactMap { environment[$0]?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
            .map { absoluteURL(path: $0, relativeTo: currentDirectoryURL) }
    }

    private static func repositoryRootURL(
        environment: [String: String],
        currentDirectoryURL: URL,
        fileManager: FileManager
    ) -> URL? {
        if let configured = [
            "FENRIR_NATIVE_REPO_ROOT",
            "FENRIR_REPO_ROOT"
        ]
            .compactMap({ environment[$0]?.trimmingCharacters(in: .whitespacesAndNewlines) })
            .first(where: { !$0.isEmpty })
        {
            let url = absoluteURL(path: configured, relativeTo: currentDirectoryURL)
            return isRepositoryRoot(url, fileManager: fileManager) ? url : nil
        }

        return nearestRepositoryRoot(startingAt: currentDirectoryURL, fileManager: fileManager)
    }

    private static func workspaceRootURL(
        environment: [String: String],
        fallback: URL
    ) -> URL {
        if let configured = [
            "FENRIR_NATIVE_WORKSPACE_ROOT",
            "FENRIR_WORKSPACE_ROOT"
        ]
            .compactMap({ environment[$0]?.trimmingCharacters(in: .whitespacesAndNewlines) })
            .first(where: { !$0.isEmpty })
        {
            return absoluteURL(path: configured, relativeTo: fallback)
        }

        return fallback.standardizedFileURL
    }

    private static func nearestRepositoryRoot(startingAt url: URL, fileManager: FileManager) -> URL? {
        var candidate = url.standardizedFileURL
        var isDirectory = ObjCBool(false)
        if fileManager.fileExists(atPath: candidate.path, isDirectory: &isDirectory),
           !isDirectory.boolValue
        {
            candidate.deleteLastPathComponent()
        }

        while true {
            if isRepositoryRoot(candidate, fileManager: fileManager) {
                return candidate
            }
            let parent = candidate.deletingLastPathComponent()
            if parent.path == candidate.path {
                return nil
            }
            candidate = parent
        }
    }

    private static func isRepositoryRoot(_ url: URL, fileManager: FileManager) -> Bool {
        fileManager.fileExists(atPath: url.appendingPathComponent("package.json").path)
            && fileManager.fileExists(atPath: url.appendingPathComponent("apps/server/package.json").path)
            && fileManager.fileExists(atPath: url.appendingPathComponent(developmentServerEntryRelativePath).path)
    }

    private static func absoluteURL(path rawPath: String, relativeTo baseURL: URL) -> URL {
        let expanded = (rawPath as NSString).expandingTildeInPath
        if (expanded as NSString).isAbsolutePath {
            return URL(fileURLWithPath: expanded).standardizedFileURL
        }
        return baseURL.appendingPathComponent(expanded).standardizedFileURL
    }
}

enum NativeLocalServerSupervisorError: Error, Sendable {
    case missing
    case unhealthy
}

actor NativeLocalServerProcessOwnership {
    private var processIDs = Set<String>()

    func insert(_ processID: String) {
        processIDs.insert(processID)
    }

    func remove(_ processID: String) -> Bool {
        processIDs.remove(processID) != nil
    }
}

struct NativeURLSessionLocalServerHTTPProber: NativeLocalServerHTTPProbing {
    func probeLocalServer(_ request: NativeLocalServerHTTPProbeRequest) async throws -> NativeLocalServerHTTPProbeResponse {
        var urlRequest = URLRequest(url: request.url)
        urlRequest.httpMethod = request.method
        urlRequest.timeoutInterval = Double(max(1, request.timeoutMilliseconds)) / 1_000
        urlRequest.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        let (body, response) = try await URLSession.shared.data(for: urlRequest)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw NativeLocalServerSupervisorError.missing
        }
        var headers: [String: String] = [:]
        for (key, value) in httpResponse.allHeaderFields {
            guard let key = key as? String else {
                continue
            }
            headers[key] = String(describing: value)
        }
        return NativeLocalServerHTTPProbeResponse(
            statusCode: httpResponse.statusCode,
            headers: headers,
            body: body
        )
    }
}

actor NativeFoundationProcessLauncher: ProcessLaunching {
    private struct ManagedProcess {
        let process: Process
        let stdout: Pipe
        let stderr: Pipe
    }

    private var processes: [String: ManagedProcess] = [:]

    func launchLocalServer(_ request: NativeLocalServerLaunchRequest) async throws -> NativeLocalServerLaunchedProcess {
        let process = Process()
        process.executableURL = request.configuration.executableURL
        process.arguments = request.configuration.arguments
        if !request.configuration.environment.isEmpty {
            process.environment = ProcessInfo.processInfo.environment.merging(request.configuration.environment) { _, new in new }
        }
        process.currentDirectoryURL = request.configuration.workingDirectoryURL

        let stdout = Pipe()
        let stderr = Pipe()
        stdout.fileHandleForReading.readabilityHandler = { handle in
            _ = handle.availableData
        }
        stderr.fileHandleForReading.readabilityHandler = { handle in
            _ = handle.availableData
        }
        process.standardOutput = stdout
        process.standardError = stderr

        do {
            try process.run()
        } catch {
            stdout.fileHandleForReading.readabilityHandler = nil
            stderr.fileHandleForReading.readabilityHandler = nil
            throw error
        }

        let processID = String(process.processIdentifier)
        process.terminationHandler = { [weak self] _ in
            stdout.fileHandleForReading.readabilityHandler = nil
            stderr.fileHandleForReading.readabilityHandler = nil
            Task {
                await self?.removeTerminatedProcess(processID: processID)
            }
        }
        processes[processID] = ManagedProcess(process: process, stdout: stdout, stderr: stderr)
        if !process.isRunning {
            removeProcess(processID: processID)
        }
        return NativeLocalServerLaunchedProcess(processID: processID)
    }

    func terminateLocalServer(processID: String) async throws {
        guard let managedProcess = removeProcess(processID: processID) else {
            return
        }
        managedProcess.process.terminate()
    }

    private func removeTerminatedProcess(processID: String) {
        _ = removeProcess(processID: processID)
    }

    @discardableResult
    private func removeProcess(processID: String) -> ManagedProcess? {
        guard let managedProcess = processes.removeValue(forKey: processID) else {
            return nil
        }
        managedProcess.stdout.fileHandleForReading.readabilityHandler = nil
        managedProcess.stderr.fileHandleForReading.readabilityHandler = nil
        return managedProcess
    }
}
