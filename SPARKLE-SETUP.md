# Sparkle Auto-Update Setup Guide

This guide walks through setting up the complete Sparkle auto-update system with Dropbox hosting and GitHub Actions automation.

## 🏗️ Architecture Overview

- **Swift Menu Bar App**: Includes Sparkle framework and settings UI
- **Dual Channels**: `release` and `nightly` update streams
- **Dropbox Hosting**: Simple, reliable file hosting for DMGs and appcasts
- **GitHub Actions**: Automated build and deployment pipeline

## 📋 Prerequisites

### 1. Apple Developer Account
- Developer ID Application certificate for code signing
- Developer ID Installer certificate (if needed)

### 2. Dropbox Setup
Create a Dropbox app at https://www.dropbox.com/developers/apps:
1. Choose "Scoped access"
2. Choose "Full Dropbox" 
3. Name your app (e.g., "Lace Updates")
4. Generate App Key, App Secret, and Refresh Token

### 3. GitHub Repository Secrets
Add these secrets to your GitHub repository:

```
APPLE_DEVELOPER_ID=Your Developer ID
APPLE_CERTIFICATE_PASSWORD=Certificate password
DROPBOX_REFRESH_TOKEN=Your Dropbox refresh token
DROPBOX_APP_KEY=Your Dropbox app key
DROPBOX_APP_SECRET=Your Dropbox app secret
```

## 🚀 Deployment Structure

### Dropbox Folder Structure
```
/lace-updates/
  ├── release/
  │   ├── appcast.xml
  │   └── Lace-1.0.0-abc1234.dmg
  └── nightly/
      ├── appcast.xml
      └── Lace-0.0.1-def5678.dmg
```

### Update Feed URLs
Once set up, your Dropbox URLs will be:
- **Release**: `https://dl.dropboxusercontent.com/s/[TOKEN]/lace-updates/release/appcast.xml`
- **Nightly**: `https://dl.dropboxusercontent.com/s/[TOKEN]/lace-updates/nightly/appcast.xml`

## ⚙️ Configuration Steps

### 1. Update Feed URLs in Code
Replace placeholder URLs in `platforms/macos/main.swift`:

```swift
var feedURL: String {
    switch self {
    case .release:
        return "https://dl.dropboxusercontent.com/s/YOUR_TOKEN_HERE/lace-updates/release/appcast.xml"
    case .nightly:
        return "https://dl.dropboxusercontent.com/s/YOUR_TOKEN_HERE/lace-updates/nightly/appcast.xml"
    }
}
```

### 2. Configure EdDSA Signing
The Sparkle keys are already generated. To use them:
1. Keep `sparkle_private_key` secure (never commit it)
2. The public key is already in `Info.plist` as `SUPublicEDKey`
3. For production, use proper key management

### 3. Test Local Build
```bash
# Test nightly build with appcast
bun scripts/build-macos-app.ts --dmg --channel nightly --generate-appcast

# Test release build  
bun scripts/build-macos-app.ts --dmg --channel release --generate-appcast --sign
```

## 🔄 Automated Workflows

### Push to `main` → Nightly Deployment
- Builds app with nightly channel
- Uploads to `/lace-updates/nightly/`
- Users on nightly channel get updates

### Create Release → Release Deployment  
- Builds app with release channel
- Uploads to `/lace-updates/release/`
- Users on release channel get updates

## 🎛️ User Controls

Users can control updates via the **Settings** menu:

- **Update Channel**: Switch between Release/Nightly
- **Automatic Updates**: Enable/disable auto-installation
- **Check Frequency**: Manual/Daily/Weekly
- **Check Now**: Immediate update check

## 🔐 Security Notes

### Code Signing
- All builds are code signed with your Developer ID
- Sparkle framework is also signed during build
- EdDSA signatures verify update authenticity

### Update Verification
- EdDSA signatures prevent tampering
- HTTPS delivery ensures transport security
- Channel isolation prevents accidental updates

## 🧪 Testing Updates

### Local Testing
1. Build with different version numbers
2. Test channel switching in settings
3. Verify update notifications work

### Production Testing
1. Deploy to nightly channel first
2. Test with nightly users
3. Promote stable builds to release channel

## 🐛 Troubleshooting

### Common Issues

**"Update check failed"**
- Check feed URLs are correct and accessible
- Verify Dropbox files are publicly accessible
- Check network connectivity

**"Invalid signature"**
- Ensure EdDSA keys match between build and app
- Verify DMG wasn't corrupted during upload
- Check signing process completed successfully

**"No updates found"**
- Verify version numbers in appcast are newer
- Check channel configuration matches expectations
- Ensure appcast XML is valid

### Debug Logging
Enable debug logging to troubleshoot:
```bash
LACE_LOG_LEVEL=debug LACE_LOG_STDERR=true ./build/lace
```

## 📈 Monitoring

Track update metrics by monitoring:
- Download counts from Dropbox analytics
- GitHub Actions build success rates
- User feedback on update experience

## 🔮 Future Enhancements

Potential improvements:
- Delta updates for faster downloads
- Rollback capability for problematic releases
- Update analytics and crash reporting
- Staged rollouts for release builds

---

## Quick Start Checklist

- [ ] Set up Dropbox app and get tokens
- [ ] Add GitHub secrets for signing and Dropbox
- [ ] Update feed URLs in Swift code
- [ ] Test local builds with both channels
- [ ] Push to `main` to test nightly deployment
- [ ] Create release to test release deployment
- [ ] Verify users can switch channels and receive updates

The auto-update system is now ready! 🚀