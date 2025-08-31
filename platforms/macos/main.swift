// ABOUTME: Swift menu bar app that manages the Lace server process with Sparkle auto-updates
// ABOUTME: Provides native macOS interface with dynamic port detection and settings window

import Cocoa
import Foundation
import ServiceManagement
import OSLog
import Sparkle

class AppDelegate: NSObject, NSApplicationDelegate, SPUUpdaterDelegate {
    private var statusBarItem: NSStatusItem!
    private var serverProcess: Process?
    private var serverPort: Int?
    private var menu: NSMenu!
    private var shouldAutoOpen = true
    private let legacyLoginItemHelperBundleID: String? = nil // No helper bundle shipped
    private var settingsWindow: SettingsWindow?
    internal var updater: SPUStandardUpdaterController!
    
    func applicationDidFinishLaunching(_ aNotification: Notification) {
        setupMenuBar()
        setupUpdater()
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
        
        // Open at login item
        let launchAtStartupItem = NSMenuItem(title: "Launch at Startup", action: #selector(toggleLaunchAtStartup), keyEquivalent: "")
        launchAtStartupItem.state = isLaunchAtStartupEnabled() ? .on : .off
        if #unavailable(macOS 13.0), legacyLoginItemHelperBundleID == nil {
            launchAtStartupItem.isEnabled = false
            launchAtStartupItem.toolTip = "Requires macOS 13+ or an embedded login item helper"
        }
        menu.addItem(launchAtStartupItem)
        
        // Settings item
        let settingsItem = NSMenuItem(title: "Settings...", action: #selector(showSettings), keyEquivalent: ",")
        menu.addItem(settingsItem)
        
        // Check for updates item
        let updateItem = NSMenuItem(title: "Check for Updates...", action: #selector(checkForUpdates), keyEquivalent: "")
        menu.addItem(updateItem)
        
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
        os_log("Server output: %{public}@", log: .default, type: .debug, output)
        
        // Look for the specific port signal from the server
        if output.contains("LACE_SERVER_PORT:") {
            if let regex = try? NSRegularExpression(pattern: #"LACE_SERVER_PORT:(\d+)"#, options: []) {
                let range = NSRange(output.startIndex..<output.endIndex, in: output)
                if let match = regex.firstMatch(in: output, range: range) {
                    let portRange = match.range(at: 1)
                    if let portSubstring = Range(portRange, in: output) {
                        if let port = Int(output[portSubstring]) {
                            os_log("Found server port signal: %d", log: .default, type: .info, port)
                            DispatchQueue.main.async { [weak self] in
                                self?.serverPort = port
                                self?.updateMenu()
                                self?.maybeAutoOpenOnce()
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
                            os_log("Found server URL signal: %d", log: .default, type: .info, port)
                            DispatchQueue.main.async { [weak self] in
                                self?.serverPort = port
                                self?.updateMenu()
                                self?.maybeAutoOpenOnce()
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
        shouldAutoOpen = false // Don't auto-open on restart
        updateMenu()
        startServer()
    }
    
    @objc private func showSettings() {
        if settingsWindow == nil {
            settingsWindow = SettingsWindow()
        }
        settingsWindow?.showWindow(nil)
        settingsWindow?.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    
    @objc private func checkForUpdates() {
        updater.checkForUpdates(nil)
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
    
    private func setupUpdater() {
        updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: self, userDriverDelegate: nil)
        
        // Configure based on user preferences
        let defaults = UserDefaults.standard
        let currentChannel = defaults.updateChannel
        print("Sparkle updater initialized for channel: \(currentChannel.displayName)")
    }
    
    func updateFeedURL(for channel: UpdateChannel) {
        // Channel switching will require app restart for full effect
        // For now, just store the preference - it will take effect on next launch
        print("Updated channel to: \(channel.displayName) - will take effect on next app launch")
    }
    
    // SPUUpdaterDelegate method to provide dynamic feed URL
    func feedURLString(for updater: SPUUpdater) -> String? {
        let defaults = UserDefaults.standard
        let currentChannel = defaults.updateChannel
        return currentChannel.feedURL
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
    
    private func showApprovalRequiredAlert() {
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.messageText = "User Approval Required"
            alert.informativeText = "Lace needs your permission to open at login. Please approve this request in System Settings."
            alert.alertStyle = .informational
            alert.addButton(withTitle: "Open System Settings")
            alert.addButton(withTitle: "Cancel")
            
            // Use sheet presentation if we have a window, otherwise fall back to modal
            if let window = NSApp.mainWindow {
                alert.beginSheetModal(for: window) { response in
                    if response == .alertFirstButtonReturn {
                        self.openSystemSettings()
                    }
                }
            } else {
                // Fallback to modal if no main window
                let response = alert.runModal()
                if response == .alertFirstButtonReturn {
                    self.openSystemSettings()
                }
            }
        }
    }
    
    private func openSystemSettings() {
        // Open System Settings - use generic URL that works across macOS versions
        let settingsURL: URL
        if #available(macOS 13.0, *) {
            // Use modern System Settings URL
            settingsURL = URL(string: "x-apple.systempreferences:com.apple.preference.security?General")!
        } else {
            // Fallback to System Preferences
            settingsURL = URL(string: "x-apple.systempreferences:com.apple.preference.security?General")!
        }
        
        NSWorkspace.shared.open(settingsURL)
    }
    
    private func maybeAutoOpenOnce() {
        guard shouldAutoOpen, serverPort != nil else { return }
        shouldAutoOpen = false
        openBrowser()
    }
    
    @objc private func toggleLaunchAtStartup() {
        if isLaunchAtStartupEnabled() {
            disableLaunchAtStartup()
        } else {
            enableLaunchAtStartup()
        }
        updateMenu()
    }
    
    private func isLaunchAtStartupEnabled() -> Bool {
        if #available(macOS 13.0, *) {
            let service = SMAppService.mainApp
            return service.status == .enabled
        } else {
            // No legacy support without helper bundle
            return false
        }
    }
    
    private func enableLaunchAtStartup() {
        if #available(macOS 13.0, *) {
            do {
                let service = SMAppService.mainApp
                try service.register()
                
                // Check the status after registration
                let status = SMAppService.mainApp.status
                switch status {
                case .requiresApproval:
                    showApprovalRequiredAlert()
                case .enabled:
                    os_log("Successfully enabled open at login", log: .default, type: .info)
                case .notRegistered:
                    showError("Failed to register for open at login")
                case .notFound:
                    showError("Login item service not found")
                @unknown default:
                    os_log("Open at login registration completed with status: %{public}@", log: .default, type: .info, String(describing: status))
                }
            } catch {
                showError("Failed to enable open at login: \(error.localizedDescription)")
            }
        } else {
            // No legacy support without helper bundle
            showError("Open at login requires macOS 13+ or an embedded login item helper")
        }
    }
    
    private func disableLaunchAtStartup() {
        if #available(macOS 13.0, *) {
            do {
                let service = SMAppService.mainApp
                try service.unregister()
                os_log("Successfully disabled open at login", log: .default, type: .info)
            } catch {
                showError("Failed to disable open at login: \(error.localizedDescription)")
            }
        } else {
            // No legacy support without helper bundle
            showError("Open at login requires macOS 13+ or an embedded login item helper")
        }
    }
    
    private func showInfo(_ message: String) {
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.messageText = "Lace"
            alert.informativeText = message
            alert.alertStyle = .informational
            alert.addButton(withTitle: "OK")
            alert.runModal()
        }
    }
}

// MARK: - User Preferences
extension UserDefaults {
    private enum Keys {
        static let updateChannel = "LaceUpdateChannel"
        static let autoUpdate = "LaceAutoUpdate"
        static let checkFrequency = "LaceUpdateCheckFrequency"
    }
    
    var updateChannel: UpdateChannel {
        get {
            let rawValue = string(forKey: Keys.updateChannel) ?? UpdateChannel.release.rawValue
            return UpdateChannel(rawValue: rawValue) ?? .release
        }
        set {
            set(newValue.rawValue, forKey: Keys.updateChannel)
        }
    }
    
    var autoUpdate: Bool {
        get { bool(forKey: Keys.autoUpdate) }
        set { set(newValue, forKey: Keys.autoUpdate) }
    }
    
    var updateCheckFrequency: UpdateFrequency {
        get {
            let rawValue = string(forKey: Keys.checkFrequency) ?? UpdateFrequency.daily.rawValue
            return UpdateFrequency(rawValue: rawValue) ?? .daily
        }
        set {
            set(newValue.rawValue, forKey: Keys.checkFrequency)
        }
    }
}

enum UpdateChannel: String, CaseIterable {
    case release = "release"
    case nightly = "nightly"
    
    var displayName: String {
        switch self {
        case .release: return "Release"
        case .nightly: return "Nightly (Development)"
        }
    }
    
    var feedURL: String {
        // fsck.com hosting - reliable and controlled
        switch self {
        case .release:
            return "https://fsck.com/lace/dist/release/appcast.xml"
        case .nightly:
            return "https://fsck.com/lace/dist/nightly/appcast.xml"
        }
    }
}

enum UpdateFrequency: String, CaseIterable {
    case manual = "manual"
    case daily = "daily"
    case weekly = "weekly"
    
    var displayName: String {
        switch self {
        case .manual: return "Manual Only"
        case .daily: return "Daily"
        case .weekly: return "Weekly"
        }
    }
}

// MARK: - Settings Window
class SettingsWindow: NSWindowController {
    private var channelPopup: NSPopUpButton!
    private var autoUpdateCheckbox: NSButton!
    private var frequencyPopup: NSPopUpButton!
    private var versionLabel: NSTextField!
    private var checkNowButton: NSButton!
    
    init() {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
                             styleMask: [.titled, .closable],
                             backing: .buffered,
                             defer: false)
        window.title = "Lace Settings"
        window.center()
        
        super.init(window: window)
        setupUI()
        loadSettings()
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    private func setupUI() {
        guard let window = window else { return }
        
        let contentView = NSView(frame: window.contentView!.bounds)
        window.contentView = contentView
        
        var yPos: CGFloat = 250
        let margin: CGFloat = 20
        let labelWidth: CGFloat = 120
        let controlWidth: CGFloat = 200
        
        // Title
        let titleLabel = NSTextField(labelWithString: "Update Settings")
        titleLabel.font = NSFont.systemFont(ofSize: 16, weight: .bold)
        titleLabel.frame = NSRect(x: margin, y: yPos, width: 360, height: 22)
        contentView.addSubview(titleLabel)
        yPos -= 40
        
        // Update Channel
        let channelLabel = NSTextField(labelWithString: "Update Channel:")
        channelLabel.frame = NSRect(x: margin, y: yPos, width: labelWidth, height: 22)
        contentView.addSubview(channelLabel)
        
        channelPopup = NSPopUpButton(frame: NSRect(x: margin + labelWidth, y: yPos - 2, width: controlWidth, height: 26))
        for channel in UpdateChannel.allCases {
            channelPopup.addItem(withTitle: channel.displayName)
            channelPopup.lastItem?.representedObject = channel
        }
        channelPopup.target = self
        channelPopup.action = #selector(channelChanged)
        contentView.addSubview(channelPopup)
        yPos -= 35
        
        // Auto Update Checkbox
        autoUpdateCheckbox = NSButton(checkboxWithTitle: "Automatically download and install updates", target: self, action: #selector(autoUpdateChanged))
        autoUpdateCheckbox.frame = NSRect(x: margin, y: yPos, width: 360, height: 22)
        contentView.addSubview(autoUpdateCheckbox)
        yPos -= 35
        
        // Check Frequency
        let frequencyLabel = NSTextField(labelWithString: "Check Frequency:")
        frequencyLabel.frame = NSRect(x: margin, y: yPos, width: labelWidth, height: 22)
        contentView.addSubview(frequencyLabel)
        
        frequencyPopup = NSPopUpButton(frame: NSRect(x: margin + labelWidth, y: yPos - 2, width: controlWidth, height: 26))
        for frequency in UpdateFrequency.allCases {
            frequencyPopup.addItem(withTitle: frequency.displayName)
            frequencyPopup.lastItem?.representedObject = frequency
        }
        frequencyPopup.target = self
        frequencyPopup.action = #selector(frequencyChanged)
        contentView.addSubview(frequencyPopup)
        yPos -= 50
        
        // Current Version
        let versionTitleLabel = NSTextField(labelWithString: "Current Version:")
        versionTitleLabel.frame = NSRect(x: margin, y: yPos, width: labelWidth, height: 22)
        contentView.addSubview(versionTitleLabel)
        
        let currentVersion = getCurrentVersion()
        versionLabel = NSTextField(labelWithString: currentVersion)
        versionLabel.frame = NSRect(x: margin + labelWidth, y: yPos, width: controlWidth, height: 22)
        contentView.addSubview(versionLabel)
        yPos -= 35
        
        // Check Now Button
        checkNowButton = NSButton(title: "Check for Updates Now", target: self, action: #selector(checkForUpdatesNow))
        checkNowButton.frame = NSRect(x: margin, y: yPos, width: 180, height: 32)
        checkNowButton.bezelStyle = .rounded
        contentView.addSubview(checkNowButton)
    }
    
    private func loadSettings() {
        let defaults = UserDefaults.standard
        
        // Set channel popup
        let currentChannel = defaults.updateChannel
        for i in 0..<channelPopup.numberOfItems {
            if let channel = channelPopup.item(at: i)?.representedObject as? UpdateChannel,
               channel == currentChannel {
                channelPopup.selectItem(at: i)
                break
            }
        }
        
        // Set auto update checkbox
        autoUpdateCheckbox.state = defaults.autoUpdate ? .on : .off
        
        // Set frequency popup
        let currentFrequency = defaults.updateCheckFrequency
        for i in 0..<frequencyPopup.numberOfItems {
            if let frequency = frequencyPopup.item(at: i)?.representedObject as? UpdateFrequency,
               frequency == currentFrequency {
                frequencyPopup.selectItem(at: i)
                break
            }
        }
    }
    
    @objc private func channelChanged() {
        if let channel = channelPopup.selectedItem?.representedObject as? UpdateChannel {
            UserDefaults.standard.updateChannel = channel
            print("Update channel changed to: \(channel.displayName)")
            
            // Update Sparkle feed URL
            if let appDelegate = NSApplication.shared.delegate as? AppDelegate {
                appDelegate.updateFeedURL(for: channel)
            }
        }
    }
    
    @objc private func autoUpdateChanged() {
        let isEnabled = autoUpdateCheckbox.state == .on
        UserDefaults.standard.autoUpdate = isEnabled
        print("Auto update changed to: \(isEnabled)")
        
        // Update Sparkle auto-update setting
        if let appDelegate = NSApplication.shared.delegate as? AppDelegate {
            appDelegate.updater.updater.automaticallyDownloadsUpdates = isEnabled
        }
    }
    
    @objc private func frequencyChanged() {
        if let frequency = frequencyPopup.selectedItem?.representedObject as? UpdateFrequency {
            UserDefaults.standard.updateCheckFrequency = frequency
            print("Update frequency changed to: \(frequency.displayName)")
            // TODO: Update Sparkle check frequency when integrated
        }
    }
    
    @objc private func checkForUpdatesNow() {
        if let appDelegate = NSApplication.shared.delegate as? AppDelegate {
            appDelegate.updater.checkForUpdates(nil)
        }
    }
    
    private func getCurrentVersion() -> String {
        if let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String,
           let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String {
            return "\(version) (\(build))"
        }
        return "Unknown"
    }
}

// Main entry point
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()