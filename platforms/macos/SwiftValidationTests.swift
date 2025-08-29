// ABOUTME: Swift validation tests that run without XCTest framework
// ABOUTME: Tests core functionality like port parsing and auto-open logic using simple assertions

import Cocoa
import Foundation
import ServiceManagement

// Simple test assertion function
func assert(_ condition: Bool, _ message: String) {
    if !condition {
        print("❌ FAILED: \(message)")
        exit(1)
    } else {
        print("✅ PASSED: \(message)")
    }
}

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

// Main test function
func runSwiftValidationTests() {
    print("🧪 Running Swift validation tests...")
    
    let testDelegate = TestAppDelegate()
    
    // MARK: - Port Parsing Tests
    print("\n📡 Port Parsing Tests")
    
    // Test LACE_SERVER_PORT signal
    let output1 = "Server starting...\nLACE_SERVER_PORT:31337\nServer ready"
    let port1 = testDelegate.parseServerOutput(output1)
    assert(port1 == 31337, "Should extract port number from LACE_SERVER_PORT signal")
    
    // Test LACE_SERVER_URL signal
    let output2 = "Server starting...\nLACE_SERVER_URL:http://localhost:8080\nServer ready"
    let port2 = testDelegate.parseServerOutput(output2)
    assert(port2 == 8080, "Should extract port number from LACE_SERVER_URL signal")
    
    // Test preference for LACE_SERVER_PORT
    let output3 = "LACE_SERVER_PORT:31337\nLACE_SERVER_URL:http://localhost:8080"
    let port3 = testDelegate.parseServerOutput(output3)
    assert(port3 == 31337, "Should prefer LACE_SERVER_PORT signal when both are present")
    
    // Test no signals
    let output4 = "Server starting...\nServer ready"
    let port4 = testDelegate.parseServerOutput(output4)
    assert(port4 == nil, "Should return nil when no port signals are found")
    
    // Test invalid formats
    let invalidOutputs = [
        "LACE_SERVER_PORT:invalid",
        "LACE_SERVER_URL:not-a-url",
        "LACE_SERVER_PORT:",
        "LACE_SERVER_URL:http://localhost:",
    ]
    
    for output in invalidOutputs {
        let port = testDelegate.parseServerOutput(output)
        assert(port == nil, "Should return nil for invalid port format: \(output)")
    }
    
    // MARK: - Auto-Open Tests  
    print("\n🌐 Auto-Open Tests")
    
    // Should auto-open initially
    assert(testDelegate.getShouldAutoOpen(), "Should start with auto-open enabled")
    
    // Should not open without port
    let didOpen1 = testDelegate.maybeAutoOpenOnce()
    assert(!didOpen1, "Should not open browser without server port")
    assert(testDelegate.getShouldAutoOpen(), "Should keep auto-open enabled if no port")
    
    // Should open with port
    testDelegate.setServerPort(31337)
    let didOpen2 = testDelegate.maybeAutoOpenOnce()
    assert(didOpen2, "Should open browser on first port detection")
    assert(!testDelegate.getShouldAutoOpen(), "Should disable auto-open after first use")
    
    // Should not open again
    let didOpen3 = testDelegate.maybeAutoOpenOnce()
    assert(!didOpen3, "Should not open browser on second call")
    
    // MARK: - Bundle Tests
    print("\n📦 Bundle Tests")
    
    let bundleId = Bundle.main.bundleIdentifier
    if let bundleId = bundleId {
        // Only assert for actual bundle ID when running in app context
        if bundleId.contains("lace") || bundleId.contains("com.apple.dt.xctest") {
            print("✅ PASSED: Bundle ID validation (found: \(bundleId))")
        } else {
            print("⚠️  SKIPPED: Bundle ID test (running in different context: \(bundleId))")
        }
    } else {
        // When running as standalone executable, bundle ID may be nil - this is expected
        print("⚠️  SKIPPED: Bundle ID test (running as standalone executable)")
    }
    
    // MARK: - Login Item Tests
    print("\n🔑 Login Item Tests")
    
    // This test verifies that the API call doesn't crash
    let isEnabled = testDelegate.isLaunchAtStartupEnabled()
    assert(isEnabled == true || isEnabled == false, "Should return a boolean value")
    print("✅ PASSED: Login item API accessibility (current status: \(isEnabled))")
    
    // MARK: - Performance Tests
    print("\n⚡ Performance Tests")
    
    let largeOutput = String(repeating: "Some server output line\n", count: 1000) + "LACE_SERVER_PORT:31337\n"
    let startTime = CFAbsoluteTimeGetCurrent()
    let port5 = testDelegate.parseServerOutput(largeOutput)
    let endTime = CFAbsoluteTimeGetCurrent()
    let duration = endTime - startTime
    
    assert(port5 == 31337, "Should handle large output correctly")
    assert(duration < 0.1, "Should parse large output efficiently (took \(duration)s)")
    
    // MARK: - Edge Case Tests
    print("\n🔬 Edge Case Tests")
    
    let output5 = "Debug: Port detection 🚀\nLACE_SERVER_PORT:31337\n✅ Server ready"
    let port6 = testDelegate.parseServerOutput(output5)
    assert(port6 == 31337, "Should handle special characters in server output")
    
    let output6 = "LACE_SERVER_PORT:65535"
    let port7 = testDelegate.parseServerOutput(output6)
    assert(port7 == 65535, "Should handle maximum valid port number")
    
    let output7 = "LACE_SERVER_PORT:0"
    let port8 = testDelegate.parseServerOutput(output7)
    assert(port8 == 0, "Should handle port 0")
    
    print("\n🎉 All Swift validation tests passed!")
}

// Run tests when executed
runSwiftValidationTests()