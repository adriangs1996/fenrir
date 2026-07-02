import Foundation

extension NativeDistribution {
    struct PathTmuxDependencyChecker: TmuxDependencyChecking {
        func probeTmux() async throws -> ToolProbeResult {
            guard let path = executablePath(named: "tmux") else {
                return ToolProbeResult(executablePath: nil, version: nil)
            }

            return ToolProbeResult(executablePath: path, version: try version(at: path))
        }

        private func executablePath(named name: String) -> String? {
            let path = ProcessInfo.processInfo.environment["PATH"] ?? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
            for directory in path.split(separator: ":") {
                let candidate = "\(directory)/\(name)"
                if FileManager.default.isExecutableFile(atPath: candidate) {
                    return candidate
                }
            }
            return nil
        }

        private func version(at path: String) throws -> String? {
            let process = Process()
            let pipe = Pipe()
            process.executableURL = URL(fileURLWithPath: path)
            process.arguments = ["-V"]
            process.standardOutput = pipe
            process.standardError = pipe
            try process.run()
            process.waitUntilExit()
            guard process.terminationStatus == 0 else {
                return nil
            }
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(decoding: data, as: UTF8.self)
            return output
                .split(separator: " ")
                .last
                .map(String.init)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }
}
