import Darwin
import FenrirNativeShared
import Foundation
import Testing

@testable import FenrirNativeApp

@Suite("Native app no-mock smoke e2e")
struct NativeAppSmokeE2ETests {
  @Test("Recognizes Fenrir server auth session readiness response")
  func recognizesFenrirServerAuthSessionReadinessResponse() throws {
    let readyBody = Data(
      """
      {
        "authenticated": false,
        "auth": {
          "policy": "desktop-managed-local",
          "bootstrapMethods": ["desktop-bootstrap"],
          "sessionMethods": ["browser-session-cookie", "bearer-session-token"],
          "sessionCookieName": "t3_session"
        }
      }
      """.utf8)
    #expect(
      NativeAppSmokeE2E.isFenrirAuthSessionReadinessResponse(statusCode: 200, body: readyBody))
    #expect(
      !NativeAppSmokeE2E.isFenrirAuthSessionReadinessResponse(
        statusCode: 404, body: Data("not found".utf8)))
  }

  @Test(
    "Launches native app, opens workspace, projects tmux panes, opens overlay, and reconnects",
    .disabled(
      if: ProcessInfo.processInfo.environment["FENRIR_NATIVE_E2E_SMOKE"] != "1",
      "Set FENRIR_NATIVE_E2E_SMOKE=1 to run the no-mock native app smoke e2e.")
  )
  func nativeAppLaunchWorkspacePaneOverlayReconnectSmoke() async throws {
    let environment = ProcessInfo.processInfo.environment
    guard let bootstrapToken = NativeAppSmokeE2E.bootstrapToken(environment: environment) else {
      throw NativeAppSmokeE2E.SmokeError.missingPrerequisite(
        "Set FENRIR_NATIVE_BOOTSTRAP_TOKEN, FENRIR_DESKTOP_BOOTSTRAP_TOKEN, or FENRIR_BOOTSTRAP_TOKEN."
      )
    }
    guard NativeAppSmokeE2E.commandExists("tmux") else {
      throw NativeAppSmokeE2E.SmokeError.missingPrerequisite(
        "tmux is not available on PATH; install tmux 3.2+ for local native smoke e2e.")
    }
    try await NativeAppSmokeE2E.waitForServerReadiness(host: "127.0.0.1", port: 31337)

    let packageRoot = try NativeAppSmokeE2E.packageRoot()
    let workspaceID = WorkspaceID(
      rawValue:
        "native-smoke-\(ProcessInfo.processInfo.processIdentifier)-\(Int(Date().timeIntervalSince1970))"
    )
    let socketURL = try NativeAppSmokeE2E.shortControlSocketURL(prefix: "smk")
    let app = try NativeAppSmokeE2E.launchApp(
      packageRoot: packageRoot, socketPath: socketURL.path, bootstrapToken: bootstrapToken)
    defer {
      NativeAppSmokeE2E.terminate(app)
      try? FileManager.default.removeItem(at: socketURL)
    }

    let client = NativeAppSmokeE2EControlClient(socketPath: socketURL.path)
    try await NativeAppSmokeE2E.withWorkspaceCleanup(client: client, workspaceID: workspaceID) {
      try await NativeAppSmokeE2E.waitForSocket(socketURL, process: app)

      let opened = try await client.send(
        .init(
          protocolVersion: NativeHostCLIProtocol.version,
          requestID: "native-smoke-open",
          command: .open,
          parameters: [
            "workspaceID": workspaceID.rawValue,
            "path": packageRoot.path,
          ]
        ))
      #expect(opened.ok)
      #expect(opened.resultKind == "WorkspaceOpened")
      #expect(opened.payload["workspaceID"] == workspaceID.rawValue)

      let overlay = try await client.send(
        .init(
          protocolVersion: NativeHostCLIProtocol.version,
          requestID: "native-smoke-overlay",
          command: .palette,
          parameters: ["query": "README"]
        ))
      #expect(overlay.ok)
      #expect(overlay.resultKind == "PalettePresented")
      #expect(overlay.payload["workspaceID"] == workspaceID.rawValue)

      let reconnected = try await client.send(
        .init(
          protocolVersion: NativeHostCLIProtocol.version,
          requestID: "native-smoke-reconnect",
          command: .control,
          parameters: [
            "operation": "reconnect",
            "workspaceID": workspaceID.rawValue,
          ]
        ))
      #expect(reconnected.ok)
      #expect(reconnected.resultKind == "WorkspaceControlled")
      #expect(reconnected.payload["workspaceID"] == workspaceID.rawValue)
      #expect(reconnected.payload["operation"] == "reconnect")

      let projected = try await client.send(
        .init(
          protocolVersion: NativeHostCLIProtocol.version,
          requestID: "native-smoke-pane-grid",
          command: .diagnostics,
          parameters: [
            "operation": "pane-grid",
            "workspaceID": workspaceID.rawValue,
          ]
        ))
      #expect(projected.ok)
      #expect(projected.resultKind == "PaneGridProjected")
      #expect(projected.payload["workspaceID"] == workspaceID.rawValue)
      #expect(projected.payload["tmuxSessionID"]?.isEmpty == false)
      #expect(Int(projected.payload["windowCount"] ?? "0", radix: 10) ?? 0 > 0)
      #expect(Int(projected.payload["paneCount"] ?? "0", radix: 10) ?? 0 > 0)
      #expect(projected.payload["paneIDs"]?.isEmpty == false)
      #expect(projected.payload["tmuxPaneIDs"]?.isEmpty == false)
      #expect(projected.payload["activePaneID"]?.isEmpty == false)
      #expect(projected.payload["activeTmuxPaneID"]?.isEmpty == false)
      #expect(projected.payload["paneIDs"]?.contains("pane-\(workspaceID.rawValue)") == false)
      guard let tmuxPaneID = projected.payload["activeTmuxPaneID"], !tmuxPaneID.isEmpty else {
        throw NativeAppSmokeE2E.SmokeError.missingPrerequisite(
          "Native smoke did not expose the active projected tmux pane id.")
      }

      let keybindings = try await client.send(
        .init(
          protocolVersion: NativeHostCLIProtocol.version,
          requestID: "native-smoke-keybindings",
          command: .diagnostics,
          parameters: [
            "operation": "keybinding-palette-smoke",
            "workspaceID": workspaceID.rawValue,
          ]
        ))
      #expect(keybindings.ok)
      #expect(keybindings.resultKind == "KeybindingPaletteSmokeObserved")
      #expect(keybindings.payload["cmdPHandled"] == "true")
      #expect(keybindings.payload["commandPaletteVisible"] == "true")
      #expect(keybindings.payload["palettePrefixes"]?.contains("!") == true)
      #expect(Int(keybindings.payload["tmuxBindingCount"] ?? "0", radix: 10) ?? 0 > 0)
      #expect(keybindings.payload["tmuxFocusLeft"] == "true")
      #expect(keybindings.payload["tmuxFocusRight"] == "true")
      #expect(keybindings.payload["tmuxFocusUp"] == "true")
      #expect(keybindings.payload["tmuxFocusDown"] == "true")

      try await NativeAppSmokeE2E.waitForVisibleTerminalStream(
        client: client,
        workspaceID: workspaceID,
        tmuxPaneID: tmuxPaneID
      )

      let marker = "native-agent-context-\(UUID().uuidString)"
      let selectedText = "second \(marker)"
      try NativeAppSmokeE2E.sendTmuxLine("first \(marker)", toPane: tmuxPaneID)
      try NativeAppSmokeE2E.sendTmuxLine(selectedText, toPane: tmuxPaneID)
      try NativeAppSmokeE2E.sendTmuxLine("third \(marker)", toPane: tmuxPaneID)

      let lastLinesComposer = try await client.send(
        .init(
          protocolVersion: NativeHostCLIProtocol.version,
          requestID: "native-smoke-agent-last-lines",
          command: .diagnostics,
          parameters: [
            "operation": "agent-composer-context-smoke",
            "workspaceID": workspaceID.rawValue,
            "contextSource": "lastLines",
            "maxLines": "3",
            "expectedMarker": marker,
          ]
        ))
      #expect(lastLinesComposer.ok)
      #expect(lastLinesComposer.resultKind == "AgentComposerContextSmokeObserved")
      #expect(lastLinesComposer.payload["overlayVisible"] == "true")
      #expect(lastLinesComposer.payload["contextKind"] == "lastLines")
      #expect(lastLinesComposer.payload["attachmentContainsMarker"] == "true")
      #expect(lastLinesComposer.payload["paneTextUnchangedByComposer"] == "true")
      #expect(lastLinesComposer.payload["agentWroteIntoPane"] == "false")

      let selectionComposer = try await client.send(
        .init(
          protocolVersion: NativeHostCLIProtocol.version,
          requestID: "native-smoke-agent-selection",
          command: .diagnostics,
          parameters: [
            "operation": "agent-composer-context-smoke",
            "workspaceID": workspaceID.rawValue,
            "contextSource": "selection",
            "expectedMarker": marker,
            "selectionText": selectedText,
          ]
        ))
      #expect(selectionComposer.ok)
      #expect(selectionComposer.payload["contextKind"] == "selection")
      #expect(selectionComposer.payload["selectionWasApplied"] == "true")
      #expect(selectionComposer.payload["attachmentContainsMarker"] == "true")
      #expect(selectionComposer.payload["attachmentMatchesSelectedText"] == "true")
      #expect(selectionComposer.payload["agentWroteIntoPane"] == "false")
    }
  }

  @Test(
    "Observes a real server workflow run timeline through the native app",
    .disabled(
      if: ProcessInfo.processInfo.environment["FENRIR_NATIVE_E2E_WORKFLOW"] != "1",
      "Set FENRIR_NATIVE_E2E_WORKFLOW=1 and FENRIR_NATIVE_E2E_WORKFLOW_RUN_ID to run the no-mock workflow timeline e2e."
    )
  )
  func nativeAppWorkflowTimelineSmoke() async throws {
    let environment = ProcessInfo.processInfo.environment
    guard let bootstrapToken = NativeAppSmokeE2E.bootstrapToken(environment: environment) else {
      throw NativeAppSmokeE2E.SmokeError.missingPrerequisite(
        "Set FENRIR_NATIVE_BOOTSTRAP_TOKEN, FENRIR_DESKTOP_BOOTSTRAP_TOKEN, or FENRIR_BOOTSTRAP_TOKEN."
      )
    }
    guard let runID = environment["FENRIR_NATIVE_E2E_WORKFLOW_RUN_ID"], !runID.isEmpty else {
      throw NativeAppSmokeE2E.SmokeError.missingPrerequisite(
        "Set FENRIR_NATIVE_E2E_WORKFLOW_RUN_ID to an existing local server workflow run.")
    }
    try await NativeAppSmokeE2E.waitForServerReadiness(host: "127.0.0.1", port: 31337)

    let packageRoot = try NativeAppSmokeE2E.packageRoot()
    let workspaceID = WorkspaceID(
      rawValue:
        "native-workflow-\(ProcessInfo.processInfo.processIdentifier)-\(Int(Date().timeIntervalSince1970))"
    )
    let socketURL = try NativeAppSmokeE2E.shortControlSocketURL(prefix: "wfl")
    let app = try NativeAppSmokeE2E.launchApp(
      packageRoot: packageRoot, socketPath: socketURL.path, bootstrapToken: bootstrapToken)
    defer {
      NativeAppSmokeE2E.terminate(app)
      try? FileManager.default.removeItem(at: socketURL)
    }

    let client = NativeAppSmokeE2EControlClient(socketPath: socketURL.path)
    try await NativeAppSmokeE2E.withWorkspaceCleanup(client: client, workspaceID: workspaceID) {
      try await NativeAppSmokeE2E.waitForSocket(socketURL, process: app)
      _ = try await client.send(
        .init(
          protocolVersion: NativeHostCLIProtocol.version,
          requestID: "native-workflow-open",
          command: .open,
          parameters: [
            "workspaceID": workspaceID.rawValue,
            "path": packageRoot.path,
          ]
        ))

      let workflow = try await client.send(
        .init(
          protocolVersion: NativeHostCLIProtocol.version,
          requestID: "native-workflow-timeline",
          command: .diagnostics,
          parameters: [
            "operation": "workflow-timeline-smoke",
            "workspaceID": workspaceID.rawValue,
            "runID": runID,
          ]
        ))
      #expect(workflow.ok)
      #expect(workflow.resultKind == "WorkflowTimelineSmokeObserved")
      #expect(workflow.payload["overlayVisible"] == "true")
      #expect(workflow.payload["timelineRunID"] == runID)
      #expect(Int(workflow.payload["timelineEventCount"] ?? "0", radix: 10) ?? 0 > 0)
      #expect(workflow.payload["workflowError"] == "")
    }
  }
}

private enum NativeAppSmokeE2E {
  static func bootstrapToken(environment: [String: String]) -> String? {
    [
      "FENRIR_NATIVE_BOOTSTRAP_TOKEN",
      "FENRIR_DESKTOP_BOOTSTRAP_TOKEN",
      "FENRIR_BOOTSTRAP_TOKEN",
    ]
    .compactMap { environment[$0]?.trimmingCharacters(in: .whitespacesAndNewlines) }
    .first { !$0.isEmpty }
  }

  static func packageRoot(filePath: String = #filePath) throws -> URL {
    var url = URL(fileURLWithPath: filePath)
    while url.lastPathComponent != "FenrirNative" {
      let next = url.deletingLastPathComponent()
      guard next.path != url.path else {
        throw SmokeError.packageRootNotFound
      }
      url = next
    }
    return url
  }

  static func shortControlSocketURL(prefix: String) throws -> URL {
    let uniqueSuffix = UUID().uuidString.prefix(8)
    let socketURL = URL(fileURLWithPath: "/tmp", isDirectory: true)
      .appendingPathComponent(
        "fnr-\(prefix)-\(ProcessInfo.processInfo.processIdentifier)-\(uniqueSuffix).sock")
    try validateSocketPath(socketURL.path)
    try? FileManager.default.removeItem(at: socketURL)
    return socketURL
  }

  static func validateSocketPath(_ socketPath: String) throws {
    let address = sockaddr_un()
    let maxPathLength = MemoryLayout.size(ofValue: address.sun_path)
    guard socketPath.utf8.count < maxPathLength else {
      throw SmokeError.missingPrerequisite(
        "Native control socket path is too long for AF_UNIX sockaddr_un (\(socketPath.utf8.count) bytes, max \(maxPathLength - 1)): \(socketPath)"
      )
    }
  }

  static func launchApp(packageRoot: URL, socketPath: String, bootstrapToken: String) throws
    -> Process
  {
    let executable = packageRoot.appendingPathComponent(".build/debug/FenrirNativeApp")
    guard FileManager.default.isExecutableFile(atPath: executable.path) else {
      throw SmokeError.missingPrerequisite(
        "FenrirNativeApp executable was not built at \(executable.path); run swift build first.")
    }
    try validateSocketPath(socketPath)

    let process = Process()
    process.executableURL = executable
    process.currentDirectoryURL = packageRoot
    var environment = ProcessInfo.processInfo.environment
    environment["FENRIR_NATIVE_CONTROL_SOCKET"] = socketPath
    environment["FENRIR_NATIVE_BOOTSTRAP_TOKEN"] = bootstrapToken
    process.environment = environment
    process.standardOutput = Pipe()
    process.standardError = FileHandle.standardError
    try process.run()
    return process
  }

  static func terminate(_ process: Process) {
    guard process.isRunning else {
      return
    }
    process.terminate()
    for _ in 0..<20 where process.isRunning {
      Thread.sleep(forTimeInterval: 0.05)
    }
    if process.isRunning {
      kill(process.processIdentifier, SIGKILL)
    }
  }

  static func withWorkspaceCleanup(
    client: NativeAppSmokeE2EControlClient,
    workspaceID: WorkspaceID,
    operation: () async throws -> Void
  ) async throws {
    do {
      try await operation()
    } catch {
      await cleanupWorkspace(client: client, workspaceID: workspaceID)
      throw error
    }
    await cleanupWorkspace(client: client, workspaceID: workspaceID)
  }

  static func cleanupWorkspace(client: NativeAppSmokeE2EControlClient, workspaceID: WorkspaceID)
    async
  {
    _ = try? await client.send(
      .init(
        protocolVersion: NativeHostCLIProtocol.version,
        requestID: RequestID(rawValue: "native-smoke-cleanup-\(UUID().uuidString)"),
        command: .remove,
        parameters: ["workspaceID": workspaceID.rawValue]
      ))
    killTmuxSession(named: "fenrir-ws-\(workspaceID.rawValue)")
  }

  private static func killTmuxSession(named sessionName: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["tmux", "kill-session", "-t", "=\(sessionName)"]
    process.standardOutput = Pipe()
    process.standardError = Pipe()
    do {
      try process.run()
      process.waitUntilExit()
    } catch {
      // best effort cleanup
    }
  }

  static func waitForSocket(_ socketURL: URL, process: Process) async throws {
    for _ in 0..<100 {
      if FileManager.default.fileExists(atPath: socketURL.path) {
        return
      }
      if !process.isRunning {
        throw SmokeError.appExitedBeforeSocket
      }
      try await Task.sleep(nanoseconds: 100_000_000)
    }
    throw SmokeError.socketTimedOut
  }

  static func commandExists(_ command: String) -> Bool {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["sh", "-lc", "command -v \(command) >/dev/null 2>&1"]
    process.standardOutput = Pipe()
    process.standardError = Pipe()
    do {
      try process.run()
      process.waitUntilExit()
      return process.terminationStatus == 0
    } catch {
      return false
    }
  }

  static func waitForServerReadiness(
    host: String,
    port: UInt16,
    timeout: TimeInterval = 15
  ) async throws {
    let url = URL(string: "http://\(host):\(port)/api/auth/session")!
    let deadline = Date().addingTimeInterval(timeout)
    var lastFailure: String?

    while Date() < deadline {
      do {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 1
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
          lastFailure = "non-HTTP response"
          try await Task.sleep(nanoseconds: 100_000_000)
          continue
        }
        if isFenrirAuthSessionReadinessResponse(statusCode: httpResponse.statusCode, body: data) {
          return
        }
        let body = String(data: data.prefix(200), encoding: .utf8) ?? "<non-utf8>"
        lastFailure = "status=\(httpResponse.statusCode) body=\(body)"
      } catch {
        lastFailure = "\(error)"
      }
      try await Task.sleep(nanoseconds: 100_000_000)
    }

    let suffix = lastFailure.map { " Last response: \($0)" } ?? ""
    throw SmokeError.missingPrerequisite(
      "Local Fenrir server did not become ready at \(url.absoluteString); start it before running the native smoke e2e.\(suffix)"
    )
  }

  static func isFenrirAuthSessionReadinessResponse(statusCode: Int, body: Data) -> Bool {
    guard statusCode == 200,
      let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
      json["authenticated"] as? Bool == false,
      let auth = json["auth"] as? [String: Any],
      auth["policy"] as? String == "desktop-managed-local",
      let bootstrapMethods = auth["bootstrapMethods"] as? [String],
      bootstrapMethods.contains("desktop-bootstrap")
    else {
      return false
    }
    return true
  }

  static func waitForVisibleTerminalStream(
    client: NativeAppSmokeE2EControlClient,
    workspaceID: WorkspaceID,
    tmuxPaneID: String
  ) async throws {
    for attempt in 1...20 {
      let marker = "native-smoke-stream-ready-\(attempt)-\(UUID().uuidString)"
      try sendTmuxLine(marker, toPane: tmuxPaneID)
      let observed = try await client.send(
        .init(
          protocolVersion: NativeHostCLIProtocol.version,
          requestID: RequestID(rawValue: "native-smoke-stream-ready-\(attempt)"),
          command: .diagnostics,
          parameters: [
            "operation": "terminal-text-smoke",
            "workspaceID": workspaceID.rawValue,
            "expectedMarker": marker,
          ]
        ))
      if observed.ok, observed.payload["expectedTextObserved"] == "true" {
        return
      }
      try await Task.sleep(nanoseconds: 100_000_000)
    }
    throw SmokeError.missingPrerequisite(
      "Native terminal stream did not expose readiness markers in the real terminal view.")
  }

  static func sendTmuxLine(_ line: String, toPane paneID: String) throws {
    try sendTmuxKeys(["send-keys", "-t", paneID, "-l", line], toPane: paneID)
    try sendTmuxKeys(["send-keys", "-t", paneID, "Enter"], toPane: paneID)
  }

  private static func sendTmuxKeys(_ arguments: [String], toPane paneID: String) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["tmux"] + arguments
    process.standardOutput = Pipe()
    let standardError = Pipe()
    process.standardError = standardError
    try process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
      let error =
        String(data: standardError.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)
        ?? ""
      throw SmokeError.missingPrerequisite("tmux send-keys failed for pane \(paneID): \(error)")
    }
  }

  enum SmokeError: Error {
    case appExitedBeforeSocket
    case missingPrerequisite(String)
    case packageRootNotFound
    case socketTimedOut
  }
}

private struct NativeAppSmokeE2EControlClient {
  let socketPath: String

  func send(_ request: NativeHostCLIProtocol.WireRequest) async throws
    -> NativeHostCLIProtocol.WireResponse
  {
    try await Task.detached(priority: .userInitiated) {
      let payload = try JSONEncoder().encode(request)
      let frame = try NativeHostCLIProtocol.encodeFrame(payload)
      let fd = try connect()
      defer {
        close(fd)
      }
      try writeAll(frame, to: fd)
      let responseFrame = try readFrame(from: fd)
      let responsePayload = try NativeHostCLIProtocol.decodeFrame(responseFrame)
      return try JSONDecoder().decode(
        NativeHostCLIProtocol.WireResponse.self, from: responsePayload)
    }.value
  }

  private func connect() throws -> Int32 {
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else {
      throw SocketError.posix("socket", errno)
    }
    do {
      var address = sockaddr_un()
      address.sun_family = sa_family_t(AF_UNIX)
      let maxPathLength = MemoryLayout.size(ofValue: address.sun_path)
      guard socketPath.utf8.count < maxPathLength else {
        throw SocketError.pathTooLong
      }
      socketPath.withCString { pathPointer in
        withUnsafeMutablePointer(to: &address.sun_path) { sunPathPointer in
          sunPathPointer.withMemoryRebound(to: CChar.self, capacity: maxPathLength) { destination in
            _ = strncpy(destination, pathPointer, maxPathLength - 1)
          }
        }
      }
      let result = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
          Darwin.connect(fd, socketAddress, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
      }
      guard result == 0 else {
        throw SocketError.posix("connect", errno)
      }
      return fd
    } catch {
      close(fd)
      throw error
    }
  }

  private func readFrame(from fd: Int32) throws -> Data {
    let header = try readExact(byteCount: 4, from: fd)
    let length = header.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    guard length <= NativeHostCLIProtocol.maxPayloadBytes else {
      throw SocketError.payloadTooLarge
    }
    let payload = try readExact(byteCount: Int(length), from: fd)
    var frame = Data(header)
    frame.append(payload)
    return frame
  }

  private func readExact(byteCount: Int, from fd: Int32) throws -> Data {
    var data = Data(count: byteCount)
    var offset = 0
    while offset < byteCount {
      let readCount = data.withUnsafeMutableBytes { buffer in
        read(fd, buffer.baseAddress!.advanced(by: offset), byteCount - offset)
      }
      guard readCount > 0 else {
        throw SocketError.posix("read", errno)
      }
      offset += readCount
    }
    return data
  }

  private func writeAll(_ data: Data, to fd: Int32) throws {
    var offset = 0
    while offset < data.count {
      let written = data.withUnsafeBytes { buffer in
        write(fd, buffer.baseAddress!.advanced(by: offset), data.count - offset)
      }
      guard written > 0 else {
        throw SocketError.posix("write", errno)
      }
      offset += written
    }
  }

  enum SocketError: Error {
    case pathTooLong
    case payloadTooLarge
    case posix(String, Int32)
  }
}
