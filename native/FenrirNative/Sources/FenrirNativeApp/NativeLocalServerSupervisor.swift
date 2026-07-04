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

/// A process currently listening on the local server port, with the identity
/// data required to decide whether it may be replaced (D-019 safety: the
/// native client must never kill a server owned by another live process).
struct NativeListeningServerProcess: Equatable, Sendable {
    let processID: pid_t
    let parentProcessID: pid_t
    let command: String
}

enum NativeLocalServerListenerDecision: Equatable, Sendable {
    /// A Fenrir local server whose parent process is gone (re-parented to
    /// launchd): an orphan from a crashed/killed app instance. Safe to replace.
    case terminateOrphanedServer
    /// A Fenrir local server whose parent process is still alive — owned by a
    /// concurrently running Fenrir instance (or a user shell). Never killed.
    case keepLiveOwnedServer
    /// Not recognizable as a Fenrir local server at kill time. Never killed.
    case keepForeignProcess
}

protocol NativeLocalServerPortListenerEnumerating: Sendable {
    func listeningServerProcesses(port: Int) async throws -> [NativeListeningServerProcess]
}

struct NativeLocalServerSupervisor: ServerConnection.LocalServerDiscovering,
    ServerConnection.LocalServerReadinessChecking,
    ServerConnection.LocalServerSpawning,
    ServerConnection.LocalServerProcessManaging,
    ServerConnection.LocalServerForeignTerminating
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
    private let portListeners: any NativeLocalServerPortListenerEnumerating
    private let signalProcess: @Sendable (pid_t, Int32) -> Void

    init(
        launchConfiguration: NativeLocalServerLaunchConfiguration,
        launcher: any ProcessLaunching = NativeFoundationProcessLauncher(),
        prober: any NativeLocalServerHTTPProbing = NativeURLSessionLocalServerHTTPProber(),
        clock: any FenrirClock = SystemFenrirClock(),
        probePath: String = NativeLocalServerSupervisor.defaultProbePath,
        pollIntervalMilliseconds: Int = 100,
        ownership: NativeLocalServerProcessOwnership = NativeLocalServerProcessOwnership(),
        portListeners: any NativeLocalServerPortListenerEnumerating = NativeLSOFPortListenerEnumerator(),
        signalProcess: @escaping @Sendable (pid_t, Int32) -> Void = { kill($0, $1) }
    ) {
        self.launchConfiguration = launchConfiguration
        self.launcher = launcher
        self.prober = prober
        self.clock = clock
        self.probePath = probePath
        self.pollIntervalMilliseconds = max(1, pollIntervalMilliseconds)
        self.ownership = ownership
        self.portListeners = portListeners
        self.signalProcess = signalProcess
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
        let workspaceRoot = defaultWorkspaceRootURL(
            environment: environment,
            currentDirectoryURL: currentDirectoryURL,
            bundle: bundle,
            fileManager: fileManager
        )
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
            bundle: bundle,
            fileManager: fileManager
        ) {
            return developmentConfiguration
        }

        return NativeLocalServerLaunchConfiguration(
            executableURL: URL(fileURLWithPath: "/nonexistent/fenrir-server")
        )
    }

    static func defaultWorkspaceRootURL(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        currentDirectoryURL: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
        bundle: Bundle? = .main,
        fileManager: FileManager = .default
    ) -> URL {
        let fallback = repositoryRootURL(
            environment: environment,
            currentDirectoryURL: currentDirectoryURL,
            bundle: bundle,
            fileManager: fileManager
        ) ?? currentDirectoryURL
        return workspaceRootURL(environment: environment, fallback: fallback)
    }

    static func canLaunchDevelopmentServer(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        currentDirectoryURL: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
        bundle: Bundle = .main,
        fileManager: FileManager = .default
    ) -> Bool {
        developmentLaunchConfiguration(
            environment: environment,
            currentDirectoryURL: currentDirectoryURL,
            bundle: bundle,
            fileManager: fileManager
        ) != nil
    }

    static func developmentLaunchConfiguration(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        currentDirectoryURL: URL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath),
        bundle: Bundle? = .main,
        fileManager: FileManager = .default
    ) -> NativeLocalServerLaunchConfiguration? {
        guard let repositoryRootURL = repositoryRootURL(
            environment: environment,
            currentDirectoryURL: currentDirectoryURL,
            bundle: bundle,
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

    /// Replaces an orphaned Fenrir local server occupying the endpoint's port.
    ///
    /// Safety contract (D-019, reliability-first): identity and ownership are
    /// verified per-pid at kill time — a listener is only signalled when its
    /// command line is recognizably a Fenrir local server AND its parent
    /// process is gone (re-parented to launchd), i.e. it was orphaned by a
    /// crashed or force-quit app instance. A server owned by another live
    /// Fenrir instance (or any foreign process that appears on the port,
    /// including between the discovery probe and this call) is never killed;
    /// the preparation fails with `.localServerForeignOwned` instead.
    func terminateUnmanagedLocalServer(endpoint: ServerConnection.Endpoint) async throws {
        guard let httpBaseURL = endpoint.httpBaseURL,
              let components = URLComponents(string: httpBaseURL),
              let port = components.port
        else {
            throw ServerConnection.ServerConnectionError.localServerShutdownFailed
        }

        let listeners = try await listenersEligibleForTermination(port: port)
        guard !listeners.isEmpty else {
            return
        }
        NSLog(
            "Fenrir Native terminating orphaned local server port=%d pids=%@",
            port,
            listeners.map { String($0.processID) }.joined(separator: ",")
        )
        for listener in listeners {
            signalProcess(listener.processID, SIGTERM)
        }

        let gracefulDeadline = Date().addingTimeInterval(5)
        while Date() < gracefulDeadline {
            if try await portListeners.listeningServerProcesses(port: port).isEmpty {
                return
            }
            try await Task.sleep(nanoseconds: UInt64(pollIntervalMilliseconds) * 1_000_000)
        }

        // Escalation re-verifies identity and ownership at kill time: the pid
        // set may have changed while waiting for the graceful shutdown.
        for listener in try await listenersEligibleForTermination(port: port) {
            signalProcess(listener.processID, SIGKILL)
        }
        let forcedDeadline = Date().addingTimeInterval(3)
        while Date() < forcedDeadline {
            if try await portListeners.listeningServerProcesses(port: port).isEmpty {
                return
            }
            try await Task.sleep(nanoseconds: UInt64(pollIntervalMilliseconds) * 1_000_000)
        }
        throw ServerConnection.ServerConnectionError.localServerShutdownFailed
    }

    /// Enumerates the port's listeners and requires every one of them to be a
    /// replaceable orphaned Fenrir server. If any listener is foreign or is
    /// owned by a live parent process, nothing is killed and the whole
    /// replacement is refused — killing the eligible subset could not free
    /// the port anyway and would only destroy state.
    private func listenersEligibleForTermination(port: Int) async throws -> [NativeListeningServerProcess] {
        let listeners = try await portListeners.listeningServerProcesses(port: port)
        var eligible: [NativeListeningServerProcess] = []
        for listener in listeners {
            switch Self.terminationDecision(for: listener) {
            case .terminateOrphanedServer:
                eligible.append(listener)
            case .keepLiveOwnedServer, .keepForeignProcess:
                NSLog(
                    "Fenrir Native refusing to terminate local server listener pid=%d ppid=%d decision=%@",
                    listener.processID,
                    listener.parentProcessID,
                    String(describing: Self.terminationDecision(for: listener))
                )
                throw ServerConnection.ServerConnectionError.localServerForeignOwned
            }
        }
        return eligible
    }

    static func terminationDecision(for listener: NativeListeningServerProcess) -> NativeLocalServerListenerDecision {
        guard isRecognizedFenrirServerCommand(listener.command) else {
            return .keepForeignProcess
        }
        // A server spawned by a Fenrir app is a direct child of that app
        // process; once the app dies the server is re-parented to launchd
        // (ppid 1). A live parent therefore means another running instance
        // (or a user shell) still owns this server.
        guard listener.parentProcessID <= 1 else {
            return .keepLiveOwnedServer
        }
        return .terminateOrphanedServer
    }

    static func isRecognizedFenrirServerCommand(_ command: String) -> Bool {
        let lowered = command.lowercased()
        if lowered.contains("fenrir-server") {
            return true
        }
        // Development launch: `bun run src/bin.ts --mode desktop …`.
        return lowered.contains("bun") && lowered.contains("bin.ts")
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
        bundle: Bundle?,
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

        for candidate in repositoryRootSearchURLs(currentDirectoryURL: currentDirectoryURL, bundle: bundle) {
            if let root = nearestRepositoryRoot(startingAt: candidate, fileManager: fileManager) {
                return root
            }
        }
        return nil
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

    private static func repositoryRootSearchURLs(
        currentDirectoryURL: URL,
        bundle: Bundle?
    ) -> [URL] {
        var seen = Set<String>()
        var urls: [URL] = []
        func append(_ url: URL?) {
            guard let url else {
                return
            }
            let standardized = url.standardizedFileURL
            guard seen.insert(standardized.path).inserted else {
                return
            }
            urls.append(standardized)
        }

        append(currentDirectoryURL)
        append(bundle?.bundleURL)
        append(bundle?.resourceURL)
        append(bundle?.executableURL)
        return urls
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

/// Enumerates listeners on a TCP port via `lsof`, then resolves parent pid
/// and command line per listener via `ps`. All subprocess execution is
/// asynchronous — no Swift-concurrency thread is ever blocked on pipe reads
/// or process exit (the supervisor polls this inside its shutdown loops).
struct NativeLSOFPortListenerEnumerator: NativeLocalServerPortListenerEnumerating {
    func listeningServerProcesses(port: Int) async throws -> [NativeListeningServerProcess] {
        let lsofOutput = try await NativeAsyncSubprocess.runCollectingStandardOutput(
            executableURL: URL(fileURLWithPath: "/usr/sbin/lsof"),
            arguments: ["-nP", "-iTCP:\(port)", "-sTCP:LISTEN", "-t"]
        )
        let processIDs = lsofOutput
            .split(whereSeparator: \.isNewline)
            .compactMap { pid_t($0.trimmingCharacters(in: .whitespaces)) }
            .filter { $0 > 0 }
        guard !processIDs.isEmpty else {
            return []
        }

        let psOutput = try await NativeAsyncSubprocess.runCollectingStandardOutput(
            executableURL: URL(fileURLWithPath: "/bin/ps"),
            arguments: ["-o", "pid=,ppid=,command=", "-p", processIDs.map(String.init).joined(separator: ",")]
        )
        return Self.parseProcessListing(psOutput, restrictedTo: Set(processIDs))
    }

    /// Parses `ps -o pid=,ppid=,command=` output rows. Rows for pids outside
    /// `restrictedTo` (or unparsable rows) are dropped.
    static func parseProcessListing(_ output: String, restrictedTo processIDs: Set<pid_t>) -> [NativeListeningServerProcess] {
        output.split(whereSeparator: \.isNewline).compactMap { line in
            let fields = line.split(separator: " ", omittingEmptySubsequences: true)
            guard fields.count >= 3,
                  let processID = pid_t(fields[0]),
                  let parentProcessID = pid_t(fields[1]),
                  processIDs.contains(processID)
            else {
                return nil
            }
            let command = fields[2...].joined(separator: " ")
            return NativeListeningServerProcess(
                processID: processID,
                parentProcessID: parentProcessID,
                command: command
            )
        }
    }
}

enum NativeAsyncSubprocess {
    /// Runs a subprocess and collects its standard output without blocking a
    /// Swift-concurrency thread: stdout is consumed through the FileHandle
    /// async-bytes sequence and process exit is awaited via the termination
    /// handler. A non-zero exit status is not an error — callers parse
    /// whatever output was produced (`lsof` exits 1 when nothing matches).
    static func runCollectingStandardOutput(
        executableURL: URL,
        arguments: [String]
    ) async throws -> String {
        let process = Process()
        process.executableURL = executableURL
        process.arguments = arguments
        let stdoutPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = FileHandle.nullDevice

        let exited = AsyncStream<Void> { continuation in
            process.terminationHandler = { _ in
                continuation.finish()
            }
        }
        try process.run()

        var data = Data()
        for try await byte in stdoutPipe.fileHandleForReading.bytes {
            data.append(byte)
        }
        for await _ in exited {}
        return String(decoding: data, as: UTF8.self)
    }
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
