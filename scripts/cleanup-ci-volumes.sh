#!/bin/bash
# ABOUTME: Emergency cleanup script for CI runners with accumulated mounted Lace volumes
# ABOUTME: Safely unmounts all Lace-related volumes and cleans up temporary files

set -e

echo "🧹 Emergency CI cleanup - unmounting all Lace volumes..."

# Get list of all mounted volumes
echo "📋 Current mounted volumes:"
hdiutil info | grep -E "(Lace|/Volumes)" || true

# Unmount all Lace volumes (handles both mounted DMGs and mounted volumes)
echo ""
echo "🔧 Unmounting Lace volumes..."

# Method 1: Unmount by volume path
for volume_path in /Volumes/Lace*; do
    if [ -d "$volume_path" ]; then
        echo "📤 Unmounting: $volume_path"
        diskutil unmount "$volume_path" 2>/dev/null || \
        hdiutil detach "$volume_path" -force 2>/dev/null || \
        echo "   ⚠️  Could not unmount $volume_path"
    fi
done

# Method 2: Unmount by device identifier
echo ""
echo "🔍 Checking for remaining Lace-related mounts..."
hdiutil info | grep -i lace | while read -r line; do
    # Extract device identifier (e.g., /dev/disk2s1)
    device=$(echo "$line" | grep -o '/dev/disk[0-9][a-z]*[0-9]*' | head -1)
    if [ -n "$device" ]; then
        echo "📤 Force detaching device: $device"
        hdiutil detach "$device" -force 2>/dev/null || true
    fi
done

# Clean up temporary files
echo ""
echo "🗑️  Cleaning up temporary files..."
find /tmp -name "*Lace*.dmg" -type f -delete 2>/dev/null || true
find /tmp -name "*lace*.dmg" -type f -delete 2>/dev/null || true
find /tmp -name "dmg-temp*" -type d -exec rm -rf {} + 2>/dev/null || true

# Final verification
echo ""
echo "✅ Cleanup completed! Remaining Lace-related mounts:"
df | grep -i lace || echo "   (none found - good!)"

echo ""
echo "🎉 CI runner cleaned up successfully!"