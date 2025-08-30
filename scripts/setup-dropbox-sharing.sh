#!/bin/bash

# ABOUTME: Script to create Dropbox sharing links and update Swift feed URLs
# ABOUTME: Run with your Dropbox refresh token to automate the complete setup

set -e

if [ -z "$DROPBOX_REFRESH_TOKEN" ]; then
    echo "❌ DROPBOX_REFRESH_TOKEN environment variable not set"
    echo "💡 Get your token from: https://www.dropbox.com/developers/apps → Your App → Generate Access Token"
    echo "💡 Then run: DROPBOX_REFRESH_TOKEN='your_token_here' ./scripts/setup-dropbox-sharing.sh"
    exit 1
fi

echo "🔍 Creating Dropbox sharing links..."

# Function to create sharing link
create_sharing_link() {
    local path="$1"
    local response=$(curl -s -X POST https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings \
        --header "Authorization: Bearer $DROPBOX_REFRESH_TOKEN" \
        --header "Content-Type: application/json" \
        --data "{\"path\": \"$path\", \"settings\": {\"requested_visibility\": \"public\"}}")
    
    echo "$response" | python3 -c "import sys, json; print(json.load(sys.stdin)['url'])" 2>/dev/null || {
        echo "⚠️  Failed to create sharing link for $path"
        echo "Response: $response" 
        return 1
    }
}

# Create sharing links
echo "📅 Creating release appcast sharing link..."
RELEASE_URL=$(create_sharing_link "/release/appcast.xml")

echo "🌙 Creating nightly appcast sharing link..."  
NIGHTLY_URL=$(create_sharing_link "/nightly/appcast.xml")

if [ -n "$RELEASE_URL" ] && [ -n "$NIGHTLY_URL" ]; then
    echo "✅ Got sharing URLs:"
    echo "   Release: $RELEASE_URL"
    echo "   Nightly: $NIGHTLY_URL"
    
    # Convert to direct download URLs (dl=1)
    RELEASE_DIRECT="${RELEASE_URL/?dl=0/?dl=1}"
    NIGHTLY_DIRECT="${NIGHTLY_URL/?dl=0/?dl=1}"
    
    echo "🔧 Updating Swift code with direct URLs..."
    bun scripts/update-feed-urls.ts "$RELEASE_DIRECT" "$NIGHTLY_DIRECT"
    
    echo "🎉 Complete! Auto-update URLs are now configured."
    echo "🚀 Ready to test: git push origin autoupdate"
else
    echo "❌ Failed to get sharing URLs"
    exit 1
fi