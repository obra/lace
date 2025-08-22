// ABOUTME: Swift menu bar app that manages the Lace server process
// ABOUTME: Provides native macOS interface with dynamic port detection

import Cocoa
import Foundation

class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusBarItem: NSStatusItem!
    private var serverProcess: Process?
    private var serverPort: Int?
    private var menu: NSMenu!
    
    func applicationDidFinishLaunching(_ aNotification: Notification) {
        setupMenuBar()
        startServer()
    }
    
    func applicationWillTerminate(_ aNotification: Notification) {
        stopServer()
    }
    
    private func setupMenuBar() {
        statusBarItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        
        // Use the app icon for menu bar - load from Resources folder
        let iconPath = Bundle.main.path(forResource: "AppIcon", ofType: "icns")
        if let iconPath = iconPath, let appIcon = NSImage(contentsOfFile: iconPath) {
            let resizedIcon = NSImage(size: NSSize(width: 18, height: 18))
            resizedIcon.lockFocus()
            appIcon.draw(in: NSRect(x: 0, y: 0, width: 18, height: 18))
            resizedIcon.unlockFocus()
            statusBarItem.button?.image = resizedIcon
            statusBarItem.button?.imagePosition = .imageOnly
        } else {
            statusBarItem.button?.title = "⚡"
        }
        statusBarItem.button?.toolTip = "Lace AI Coding Assistant"
        
        menu = NSMenu()
        updateMenu()
        statusBarItem.menu = menu
    }
    
    private func updateMenu() {
        menu.removeAllItems()
        
        // Status item
        let statusItem = NSMenuItem(title: getStatusTitle(), action: nil, keyEquivalent: "")
        statusItem.isEnabled = false
        menu.addItem(statusItem)
        
        menu.addItem(NSMenuItem.separator())
        
        // Launch browser item
        let launchTitle = serverPort != nil ? "Open Lace" : "Open Lace (port unknown)"
        let launchItem = NSMenuItem(title: launchTitle, action: #selector(openBrowser), keyEquivalent: "o")
        launchItem.isEnabled = (serverPort != nil)
        menu.addItem(launchItem)
        
        // Restart server item
        let restartItem = NSMenuItem(title: "Restart Server", action: #selector(restartServer), keyEquivalent: "r")
        menu.addItem(restartItem)
        
        menu.addItem(NSMenuItem.separator())
        
        // Quit item
        let quitItem = NSMenuItem(title: "Quit Lace", action: #selector(quit), keyEquivalent: "q")
        menu.addItem(quitItem)
    }
    
    private func getStatusTitle() -> String {
        if let port = serverPort {
            return "Lace Server (port \(port))"
        } else if serverProcess?.isRunning == true {
            return "Lace Server (port unknown)"
        } else {
            return "Lace Server (stopped)"
        }
    }
    
    private func startServer() {
        stopServer() // Ensure any existing process is stopped
        
        let serverPath = getServerPath()
        guard FileManager.default.fileExists(atPath: serverPath) else {
            showError("Server binary not found at: \(serverPath)")
            return
        }
        
        serverProcess = Process()
        serverProcess?.executableURL = URL(fileURLWithPath: serverPath)
        serverProcess?.arguments = ["--host", "127.0.0.1"] // Use default port (31337 or next available)
        
        // Set up pipes to capture output
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        serverProcess?.standardOutput = outputPipe
        serverProcess?.standardError = errorPipe
        
        // Monitor output for port information
        outputPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if let output = String(data: data, encoding: .utf8) {
                self?.parseServerOutput(output)
            }
        }
        
        errorPipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if let output = String(data: data, encoding: .utf8) {
                self?.parseServerOutput(output)
            }
        }
        
        do {
            try serverProcess?.run()
            updateMenuOnMainThread()
        } catch {
            showError("Failed to start server: \(error.localizedDescription)")
        }
    }
    
    private func getServerPath() -> String {
        // Get the path to the lace-server binary inside our app bundle
        let bundlePath = Bundle.main.bundlePath
        return "\(bundlePath)/Contents/MacOS/lace-server"
    }
    
    private func parseServerOutput(_ output: String) {
        // Debug: Log all server output to help with port detection
        print("Server output: \(output)")
        
        // Look for the specific port signal from the server
        if output.contains("LACE_SERVER_PORT:") {
            if let regex = try? NSRegularExpression(pattern: #"LACE_SERVER_PORT:(\d+)"#, options: []) {
                let range = NSRange(output.startIndex..<output.endIndex, in: output)
                if let match = regex.firstMatch(in: output, range: range) {
                    let portRange = match.range(at: 1)
                    if let portSubstring = Range(portRange, in: output) {
                        if let port = Int(output[portSubstring]) {
                            print("Found server port signal: \(port)")
                            DispatchQueue.main.async { [weak self] in
                                self?.serverPort = port
                                self?.updateMenu()
                            }
                            return
                        }
                    }
                }
            }
        }
        
        // Fallback: Look for URL signal
        if output.contains("LACE_SERVER_URL:") {
            if let regex = try? NSRegularExpression(pattern: #"LACE_SERVER_URL:http://[^:]+:(\d+)"#, options: []) {
                let range = NSRange(output.startIndex..<output.endIndex, in: output)
                if let match = regex.firstMatch(in: output, range: range) {
                    let portRange = match.range(at: 1)
                    if let portSubstring = Range(portRange, in: output) {
                        if let port = Int(output[portSubstring]) {
                            print("Found server URL signal: \(port)")
                            DispatchQueue.main.async { [weak self] in
                                self?.serverPort = port
                                self?.updateMenu()
                            }
                            return
                        }
                    }
                }
            }
        }
    }
    
    private func updateMenuOnMainThread() {
        DispatchQueue.main.async { [weak self] in
            self?.updateMenu()
        }
    }
    
    @objc private func openBrowser() {
        guard let port = serverPort else {
            showError("Server port not detected. The server may not have started properly or the port signal was not received.")
            return
        }
        
        let url = URL(string: "http://localhost:\(port)")!
        NSWorkspace.shared.open(url)
    }
    
    @objc private func restartServer() {
        serverPort = nil
        updateMenu()
        startServer()
    }
    
    @objc private func quit() {
        stopServer()
        NSApplication.shared.terminate(nil)
    }
    
    private func stopServer() {
        serverProcess?.terminate()
        serverProcess?.waitUntilExit()
        serverProcess = nil
        serverPort = nil
        updateMenuOnMainThread()
    }
    
    private func showError(_ message: String) {
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.messageText = "Lace Error"
            alert.informativeText = message
            alert.alertStyle = .warning
            alert.addButton(withTitle: "OK")
            alert.runModal()
        }
    }
}

// Main entry point
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()