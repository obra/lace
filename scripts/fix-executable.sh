#!/bin/bash

# ABOUTME: Fixes common code signing and quarantine issues with lace-standalone executable
# ABOUTME: Run this script on the target machine if the executable crashes with code signing errors

EXECUTABLE="lace-standalone"

if [ ! -f "$EXECUTABLE" ]; then
    echo "❌ Error: $EXECUTABLE not found in current directory"
    echo "   Please ensure you're in the same directory as the executable"
    exit 1
fi

echo "🔧 Fixing lace-standalone executable..."

# Remove quarantine attributes (common issue when downloading)
echo "1️⃣ Removing quarantine attributes..."
if xattr -l "$EXECUTABLE" | grep -q "com.apple.quarantine"; then
    xattr -dr com.apple.quarantine "$EXECUTABLE" 2>/dev/null || true
    echo "   ✅ Quarantine attributes removed"
else
    echo "   ℹ️  No quarantine attributes found"
fi

# Fix permissions
echo "2️⃣ Setting executable permissions..."
chmod +x "$EXECUTABLE"
echo "   ✅ Permissions set"

# Re-sign the executable
echo "3️⃣ Re-signing executable..."
if command -v codesign >/dev/null 2>&1; then
    codesign --remove-signature "$EXECUTABLE" 2>/dev/null || true
    if codesign -s - --deep --force "$EXECUTABLE" 2>/dev/null; then
        echo "   ✅ Executable re-signed successfully"
    else
        echo "   ⚠️  Warning: Code signing failed, but executable may still work"
    fi
else
    echo "   ⚠️  Warning: codesign not available"
fi

# Test the executable
echo "4️⃣ Testing executable..."
if "./$EXECUTABLE" --help >/dev/null 2>&1; then
    echo "   ✅ Executable test passed"
    echo ""
    echo "🎉 Success! The executable should now work properly."
    echo "   Run: ./$EXECUTABLE"
else
    echo "   ❌ Executable test failed"
    echo ""
    echo "💡 Additional troubleshooting steps:"
    echo "   1. Check system logs: sudo log show --predicate 'subsystem contains \"com.apple.security\"' --last 5m"
    echo "   2. Try running with: sudo spctl --assess --verbose $EXECUTABLE"
    echo "   3. If still failing, try disabling SIP temporarily (not recommended for production)"
    echo ""
    echo "   Please report this issue with the error details."
fi

echo ""
echo "📋 System info:"
echo "   macOS version: $(sw_vers -productVersion)"
echo "   Architecture: $(uname -m)"
echo "   Executable size: $(ls -lh $EXECUTABLE | awk '{print $5}')"

# Show current code signing status
if command -v codesign >/dev/null 2>&1; then
    echo ""
    echo "🔏 Code signing status:"
    codesign -dv "$EXECUTABLE" 2>&1 | grep -E "(Identifier|Signature)" || true
fi