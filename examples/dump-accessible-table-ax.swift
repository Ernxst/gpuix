// Dump the live macOS accessibility subtree for the table example.
// Run: swift dump-accessible-table-ax.swift <pid>

import ApplicationServices
import AppKit
import CoreGraphics
import Foundation

let arguments = Array(CommandLine.arguments.dropFirst())
let tabCount = arguments.first(where: { $0.hasPrefix("--tabs=") })
    .flatMap { Int($0.dropFirst("--tabs=".count)) } ?? 0
let summaryOnly = arguments.contains("--summary")
let tabDelay = arguments.first(where: { $0.hasPrefix("--tab-delay=") })
    .flatMap { Double($0.dropFirst("--tab-delay=".count)) } ?? 0.06
let pid: pid_t
if let suppliedPID = arguments.first(where: { !$0.hasPrefix("--") }).flatMap(pid_t.init) {
    pid = suppliedPID
} else {
    let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
    guard let match = windows.first(where: {
        ($0[kCGWindowName as String] as? String)?.contains("GPUIX Accessible Windowed Table") == true
    }), let ownerPID = match[kCGWindowOwnerPID as String] as? pid_t else {
        let summary = windows.map { "\($0[kCGWindowOwnerPID as String] ?? "?"):\($0[kCGWindowName as String] ?? "<untitled>")" }
        fputs("could not find the GPUIX accessible table window; visible windows: \(summary.joined(separator: ", "))\n", stderr)
        exit(2)
    }
    pid = ownerPID
}

let app = AXUIElementCreateApplication(pid)
_ = AXUIElementSetAttributeValue(app, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
NSRunningApplication(processIdentifier: pid)?.activate(options: [])
Thread.sleep(forTimeInterval: 0.35)
for _ in 0..<max(0, tabCount) {
    CGEvent(keyboardEventSource: nil, virtualKey: 48, keyDown: true)?.postToPid(pid)
    CGEvent(keyboardEventSource: nil, virtualKey: 48, keyDown: false)?.postToPid(pid)
    Thread.sleep(forTimeInterval: tabDelay)
}
Thread.sleep(forTimeInterval: 0.25)

let rowKeys = ["AXRowCount", "AXRowIndex", "AXARIARowCount", "AXARIARowIndex", "AXIndex"]
var visited = 0
var roleCounts: [String: Int] = [:]
var rowTitles: [String] = []
var tableRelevantAttributes: [String] = []
var rowRelevantAttributes: [String] = []

func value(_ element: AXUIElement, _ attribute: String) -> Any? {
    var result: CFTypeRef?
    let status = AXUIElementCopyAttributeValue(element, attribute as CFString, &result)
    return status == .success ? result : nil
}

func describe(_ value: Any?) -> String {
    guard let value else { return "-" }
    if let string = value as? String { return string }
    return String(describing: value)
}

func walk(_ element: AXUIElement, depth: Int) {
    guard visited < 5_000, depth < 24 else { return }
    visited += 1

    let role = describe(value(element, kAXRoleAttribute as String))
    roleCounts[role, default: 0] += 1
    let title = describe(value(element, kAXTitleAttribute as String))
    let description = describe(value(element, kAXDescriptionAttribute as String))
    if role == "AXRow", title != "-" { rowTitles.append(title) }
    var details: [String] = []
    for key in rowKeys {
        if let item = value(element, key) { details.append("\(key)=\(describe(item))") }
    }
    var names: CFArray?
    if AXUIElementCopyAttributeNames(element, &names) == .success, let names {
        let attributeNames = names as? [String] ?? []
        let relevant = attributeNames.filter { attribute in
            ["row", "index", "count"].contains(where: { attribute.lowercased().contains($0) })
        }
        if role == "AXTable" || role == "AXRow" {
            if role == "AXTable" { tableRelevantAttributes = relevant }
            if role == "AXRow" { rowRelevantAttributes = relevant }
            if !summaryOnly { details.append("attributes=[\(attributeNames.joined(separator: ","))]") }
        }
        for key in attributeNames where ["row", "index", "count", "focus"].contains(where: { key.lowercased().contains($0) }) && !rowKeys.contains(key) {
            if let item = value(element, key) { details.append("\(key)=\(describe(item))") }
        }
    }
    let indent = String(repeating: "  ", count: depth)
    let detailsText = details.isEmpty ? "" : " " + details.joined(separator: " ")
    if !summaryOnly { print("\(indent)\(role) title=\(title) description=\(description)\(detailsText)") }

    guard let children = value(element, kAXChildrenAttribute as String) as? [AXUIElement] else { return }
    for child in children { walk(child, depth: depth + 1) }
}

guard let windows = value(app, kAXWindowsAttribute as String) as? [AXUIElement] else {
    fputs("AXUIElementCopyAttributeValue(AXWindows) failed for pid \(pid)\n", stderr)
    exit(1)
}
print("pid=\(pid) axWindows=\(windows.count)")
for window in windows { walk(window, depth: 0) }
if summaryOnly {
    print("visited=\(visited) roleCounts=\(roleCounts) firstRows=\(rowTitles.prefix(3)) lastRows=\(rowTitles.suffix(3)) tableRowAttributes=\(tableRelevantAttributes) rowIndexAttributes=\(rowRelevantAttributes)")
} else {
    print("visited=\(visited) roleCounts=\(roleCounts)")
}
