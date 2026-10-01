import AppKit
import ApplicationServices
import Foundation

func focusedOwner() -> (pid_t?, String?, Int, Int) {
    let system = AXUIElementCreateSystemWide()
    var application: CFTypeRef?
    let applicationStatus = AXUIElementCopyAttributeValue(
        system,
        kAXFocusedApplicationAttribute as CFString,
        &application
    )
    guard applicationStatus == .success, let application else {
        return (nil, nil, Int(applicationStatus.rawValue), -1)
    }

    var pid: pid_t = -1
    guard AXUIElementGetPid(application as! AXUIElement, &pid) == .success else {
        return (nil, nil, Int(applicationStatus.rawValue), -2)
    }

    var window: CFTypeRef?
    let status = AXUIElementCopyAttributeValue(
        application as! AXUIElement,
        kAXFocusedWindowAttribute as CFString,
        &window
    )
    guard status == .success, let window else {
        return (pid, nil, Int(applicationStatus.rawValue), Int(status.rawValue))
    }

    var title: CFTypeRef?
    _ = AXUIElementCopyAttributeValue(
        window as! AXUIElement,
        kAXTitleAttribute as CFString,
        &title
    )
    return (pid, title as? String, Int(applicationStatus.rawValue), Int(status.rawValue))
}

func descendantPIDs(of rootPID: Int) -> [Int] {
    let ps = Process()
    ps.executableURL = URL(fileURLWithPath: "/bin/ps")
    ps.arguments = ["-axo", "pid=,ppid="]
    let output = Pipe()
    ps.standardOutput = output
    ps.standardError = FileHandle.nullDevice
    guard (try? ps.run()) != nil else { return [] }
    let data = output.fileHandleForReading.readDataToEndOfFile()
    ps.waitUntilExit()
    guard ps.terminationStatus == 0,
          let listing = String(data: data, encoding: .utf8) else { return [] }

    var children: [Int: [Int]] = [:]
    for line in listing.split(separator: "\n") {
        let fields = line.split(whereSeparator: \.isWhitespace)
        guard fields.count == 2,
              let pid = Int(fields[0]),
              let parentPID = Int(fields[1]) else { continue }
        children[parentPID, default: []].append(pid)
    }

    var result: [Int] = []
    var pending = children[rootPID, default: []]
    while let pid = pending.popLast() {
        result.append(pid)
        pending.append(contentsOf: children[pid, default: []])
    }
    return result.sorted()
}

func sample(testPID: Int) {
    let front = NSWorkspace.shared.frontmostApplication
    let (keyPID, keyTitle, focusedApplicationStatus, keyStatus) = focusedOwner()
    let testProcessTree = [testPID] + descendantPIDs(of: testPID)
    let windows = (CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]]) ?? []
    let topWindow = windows.first { ($0[kCGWindowLayer as String] as? Int) == 0 }
    let record: [String: Any] = [
        "time": ISO8601DateFormatter().string(from: Date()),
        "testPID": testPID,
        "testProcessTree": testProcessTree,
        "frontmost": front?.localizedName ?? NSNull(),
        "frontmostPID": front.map { Int($0.processIdentifier) } ?? NSNull(),
        "frontmostBundleID": front?.bundleIdentifier ?? NSNull(),
        "keyWindowPID": keyPID.map { Int($0) } ?? NSNull(),
        "keyWindowTitle": keyTitle ?? NSNull(),
        "focusedApplicationStatus": focusedApplicationStatus,
        "keyWindowStatus": keyStatus,
        "frontWindowPID": topWindow?[kCGWindowOwnerPID as String] ?? NSNull(),
        "frontWindowTitle": topWindow?[kCGWindowName as String] ?? NSNull(),
    ]
    if let data = try? JSONSerialization.data(withJSONObject: record),
       let line = String(data: data, encoding: .utf8) {
        FileHandle.standardError.write(Data((line + "\n").utf8))
    }
}

guard CommandLine.arguments.count >= 3 else {
    fputs("Usage: swift scripts/observe-test-focus.swift <interval-seconds> -- <command> [args...]\n", stderr)
    exit(64)
}

let separator = CommandLine.arguments.firstIndex(of: "--") ?? 2
guard separator + 1 < CommandLine.arguments.count,
      let interval = Double(CommandLine.arguments[1]), interval > 0 else {
    fputs("Expected a positive sampling interval and a command after --\n", stderr)
    exit(64)
}

let process = Process()
process.executableURL = URL(fileURLWithPath: CommandLine.arguments[separator + 1])
process.arguments = Array(CommandLine.arguments.dropFirst(separator + 2))
process.currentDirectoryURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
process.standardError = FileHandle.standardOutput

do {
    try process.run()
} catch {
    fputs("Could not start test command: \(error)\n", stderr)
    exit(70)
}

while process.isRunning {
    sample(testPID: Int(process.processIdentifier))
    Thread.sleep(forTimeInterval: interval)
}
sample(testPID: Int(process.processIdentifier))
exit(process.terminationStatus)
