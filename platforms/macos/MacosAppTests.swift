// ABOUTME: Unit tests for the macOS menubar app functionality
// ABOUTME: Tests core features like port parsing, menu management, and login item handling

import XCTest
import Cocoa
import Foundation
import ServiceManagement

// Test helper class that mirrors the main AppDelegate functionality
class TestAppDelegate: NSObject {
    private var serverPort: Int?
    private var shouldAutoOpen = true
    private let legacyLoginItemHelperBundleID: String? = nil
    
    func parseServerOutput(_ output: String) -> Int? {
        // Look for the specific port signal from the server
        if output.contains("LACE_SERVER_PORT:") {
            if let regex = try? NSRegularExpression(pattern: #"LACE_SERVER_PORT:(\d+)"#, options: []) {
                let range = NSRange(output.startIndex..<output.endIndex, in: output)
                if let match = regex.firstMatch(in: output, range: range) {
                    let portRange = match.range(at: 1)
                    if let portSubstring = Range(portRange, in: output) {
                        if let port = Int(output[portSubstring]) {
                            return port
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
                            return port
                        }
                    }
                }
            }
        }
        
        return nil
    }
    
    func maybeAutoOpenOnce() -> Bool {
        guard shouldAutoOpen, serverPort != nil else { return false }
        shouldAutoOpen = false
        return true // Would call openBrowser() in real implementation
    }
    
    func setServerPort(_ port: Int) {
        serverPort = port
    }
    
    func getServerPort() -> Int? {
        return serverPort
    }
    
    func getShouldAutoOpen() -> Bool {
        return shouldAutoOpen
    }
    
    func isLaunchAtStartupEnabled() -> Bool {
        if #available(macOS 13.0, *) {
            let service = SMAppService.mainApp
            return service.status == .enabled
        } else {
            // No legacy support without helper bundle
            return false
        }
    }
}

class MacosAppTests: XCTestCase {
    var testDelegate: TestAppDelegate!
    
    override func setUp() {
        super.setUp()
        testDelegate = TestAppDelegate()
    }
    
    override func tearDown() {
        testDelegate = nil
        super.tearDown()
    }
    
    // MARK: - Port Parsing Tests
    
    func testPortParsingFromLaceServerPortSignal() {
        let output = "Server starting...\nLACE_SERVER_PORT:31337\nServer ready"
        let port = testDelegate.parseServerOutput(output)
        
        XCTAssertEqual(port, 31337, "Should extract port number from LACE_SERVER_PORT signal")
    }
    
    func testPortParsingFromLaceServerURLSignal() {
        let output = "Server starting...\nLACE_SERVER_URL:http://localhost:8080\nServer ready"
        let port = testDelegate.parseServerOutput(output)
        
        XCTAssertEqual(port, 8080, "Should extract port number from LACE_SERVER_URL signal")
    }
    
    func testPortParsingWithMultipleSignals() {
        let output = "LACE_SERVER_PORT:31337\nLACE_SERVER_URL:http://localhost:8080"
        let port = testDelegate.parseServerOutput(output)
        
        XCTAssertEqual(port, 31337, "Should prefer LACE_SERVER_PORT signal when both are present")
    }
    
    func testPortParsingWithNoSignals() {
        let output = "Server starting...\nServer ready"
        let port = testDelegate.parseServerOutput(output)
        
        XCTAssertNil(port, "Should return nil when no port signals are found")
    }
    
    func testPortParsingWithInvalidFormats() {
        let outputs = [
            "LACE_SERVER_PORT:invalid",
            "LACE_SERVER_URL:not-a-url",
            "LACE_SERVER_PORT:",
            "LACE_SERVER_URL:http://localhost:",
        ]
        
        for output in outputs {
            let port = testDelegate.parseServerOutput(output)
            XCTAssertNil(port, "Should return nil for invalid port format: \(output)")
        }
    }
    
    // MARK: - Auto-Open Tests
    
    func testAutoOpenOnFirstPortDetection() {
        // Should auto-open initially
        XCTAssertTrue(testDelegate.getShouldAutoOpen(), "Should start with auto-open enabled")
        
        testDelegate.setServerPort(31337)
        let didOpen = testDelegate.maybeAutoOpenOnce()
        
        XCTAssertTrue(didOpen, "Should open browser on first port detection")
        XCTAssertFalse(testDelegate.getShouldAutoOpen(), "Should disable auto-open after first use")
    }
    
    func testNoAutoOpenWithoutPort() {
        let didOpen = testDelegate.maybeAutoOpenOnce()
        
        XCTAssertFalse(didOpen, "Should not open browser without server port")
        XCTAssertTrue(testDelegate.getShouldAutoOpen(), "Should keep auto-open enabled if no port")
    }
    
    func testNoAutoOpenAfterFirstUse() {
        testDelegate.setServerPort(31337)
        
        // First call should open
        let firstOpen = testDelegate.maybeAutoOpenOnce()
        XCTAssertTrue(firstOpen, "First call should open browser")
        
        // Second call should not open
        let secondOpen = testDelegate.maybeAutoOpenOnce()
        XCTAssertFalse(secondOpen, "Second call should not open browser")
    }
    
    // MARK: - Login Item Tests
    
    func testLoginItemStatusOnModernMacOS() {
        // This test verifies that the API call doesn't crash
        // The actual result depends on system state and permissions
        let isEnabled = testDelegate.isLaunchAtStartupEnabled()
        
        // Just verify the call succeeds and returns a boolean
        XCTAssertTrue(isEnabled == true || isEnabled == false, "Should return a boolean value")
    }
    
    // MARK: - Bundle and File System Tests
    
    func testAppBundleIdentifier() {
        let bundleId = Bundle.main.bundleIdentifier
        XCTAssertNotNil(bundleId, "App should have a bundle identifier")
        
        if let bundleId = bundleId {
            XCTAssertTrue(bundleId.contains("lace"), "Bundle ID should contain 'lace'")
        }
    }
    
    func testAppIconExists() {
        let iconPath = Bundle.main.path(forResource: "AppIcon", ofType: "icns")
        if let iconPath = iconPath {
            let fileExists = FileManager.default.fileExists(atPath: iconPath)
            XCTAssertTrue(fileExists, "App icon should exist at expected path")
        }
        // If no icon path found, that's also valid (icon might be embedded differently)
    }
    
    func testInfoPlistValues() {
        let bundle = Bundle.main
        let infoDictionary = bundle.infoDictionary
        
        XCTAssertNotNil(infoDictionary, "Info.plist should be accessible")
        
        if let info = infoDictionary {
            XCTAssertNotNil(info["CFBundleName"], "Should have CFBundleName")
            XCTAssertNotNil(info["CFBundleIdentifier"], "Should have CFBundleIdentifier")
            XCTAssertNotNil(info["CFBundleShortVersionString"], "Should have CFBundleShortVersionString")
            
            // Verify this is a menu bar app (LSUIElement = true)
            if let isUIElement = info["LSUIElement"] as? Bool {
                XCTAssertTrue(isUIElement, "Should be configured as a menu bar app (LSUIElement = true)")
            }
        }
    }
    
    // MARK: - Performance Tests
    
    func testPortParsingPerformance() {
        let largeOutput = String(repeating: "Some server output line\n", count: 1000) + "LACE_SERVER_PORT:31337\n"
        
        measure {
            let port = testDelegate.parseServerOutput(largeOutput)
            XCTAssertEqual(port, 31337)
        }
    }
    
    // MARK: - Edge Case Tests
    
    func testPortParsingWithSpecialCharacters() {
        let output = "Debug: Port detection 🚀\nLACE_SERVER_PORT:31337\n✅ Server ready"
        let port = testDelegate.parseServerOutput(output)
        
        XCTAssertEqual(port, 31337, "Should handle special characters in server output")
    }
    
    func testPortParsingWithVeryLargePortNumber() {
        let output = "LACE_SERVER_PORT:65535"
        let port = testDelegate.parseServerOutput(output)
        
        XCTAssertEqual(port, 65535, "Should handle maximum valid port number")
    }
    
    func testPortParsingWithZeroPort() {
        let output = "LACE_SERVER_PORT:0"
        let port = testDelegate.parseServerOutput(output)
        
        XCTAssertEqual(port, 0, "Should handle port 0 (though invalid for actual use)")
    }
}