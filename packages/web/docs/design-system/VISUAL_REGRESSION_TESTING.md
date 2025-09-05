# Visual Regression Testing Workflow

This document outlines the visual regression testing setup and workflow for the
Lace project using Chromatic and Lighthouse CI.

## Overview

Our visual regression testing infrastructure includes:

- **Chromatic**: Automated visual regression testing for Storybook components
- **Lighthouse CI**: Performance monitoring and regression detection
- **Bundle Analysis**: Automated bundle size tracking and optimization alerts
- **CI/CD Integration**: Automated testing on every PR and push

## Chromatic Setup

### Configuration

The Chromatic configuration is defined in `.chromatic.config.json`:

```json
{
  "projectId": "PROJECT_ID_PLACEHOLDER",
  "buildScriptName": "build-storybook",
  "storybookBuildDir": "storybook-static",
  "exitZeroOnChanges": true,
  "onlyChanged": true,
  "modes": {
    "light": { "globals": { "theme": "light" } },
    "dark": { "globals": { "theme": "dark" } }
  },
  "threshold": {
    "anti-aliasing": 0.1,
    "color": 0.1,
    "layout": 0.1
  }
}
```

### Key Features

- **Multi-theme Testing**: Automatically tests both light and dark themes
- **Optimized Performance**: Only tests changed components (`onlyChanged: true`)
- **Threshold Configuration**: Tolerates minor visual differences
  (anti-aliasing, color, layout)
- **File Hashing**: Efficient change detection using file hashing
- **Compression**: Uploads compressed snapshots for faster processing

### Running Chromatic

```bash
# Run locally
npm run chromatic

# Run in CI mode
npm run chromatic:ci
```

## Lighthouse CI Performance Monitoring

### Configuration

Performance monitoring is configured in `.lighthouserc.json`:

```json
{
  "ci": {
    "assert": {
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.8 }],
        "categories:accessibility": ["error", { "minScore": 0.9 }],
        "first-contentful-paint": ["error", { "maxNumericValue": 2000 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 4000 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }]
      }
    }
  }
}
```

### Performance Thresholds

- **Performance Score**: Minimum 80%
- **Accessibility Score**: Minimum 90%
- **First Contentful Paint**: Maximum 2000ms
- **Largest Contentful Paint**: Maximum 4000ms
- **Cumulative Layout Shift**: Maximum 0.1

## GitHub Actions Workflow

The automated testing workflow (`.github/workflows/chromatic.yml`) includes
three jobs:

### 1. Chromatic Job

- Builds Storybook
- Runs Chromatic visual regression testing
- Uploads Storybook artifacts
- Tests both light and dark themes

### 2. Lighthouse Job

- Runs performance analysis on key stories
- Tests multiple story endpoints
- Generates performance reports
- Uploads artifacts to temporary public storage

### 3. Bundle Analysis Job

- Analyzes bundle size and composition
- Identifies files over 100KB
- Generates bundle analysis report
- Comments results on pull requests

## Performance Optimizations

### Storybook Configuration

The Storybook configuration includes several performance optimizations:

#### Code Splitting (`.storybook/main.ts`)

```typescript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        vendor: ['react', 'react-dom', '@storybook/react'],
        ui: ['@headlessui/react', '@heroicons/react'],
        icons: ['@fortawesome/fontawesome-svg-core'],
        'syntax-highlighting': ['highlight.js', 'cli-highlight']
      }
    }
  }
}
```

#### Lazy Loading (`.storybook/preview.ts`)

```typescript
const lazyImports = {
  syntaxHighlighting: () => import('highlight.js'),
  framerMotion: () => import('framer-motion'),
};
```

### Bundle Size Results

Current optimized bundle sizes:

- **vendor**: 11.80kb (React core)
- **ui**: 158.30kb (UI components)
- **icons**: 82.66kb (FontAwesome icons)
- **syntax-highlighting**: 969.36kb (Code highlighting)

## Workflow Integration

### Pull Request Process

1. **Automatic Triggers**: Visual regression tests run on every PR
2. **Bundle Analysis**: Automated bundle size analysis with PR comments
3. **Performance Monitoring**: Lighthouse CI checks performance regressions
4. **Visual Diff Review**: Chromatic provides visual diff interface for review

### Local Development

```bash
# Run Storybook with performance optimizations
npm run storybook

# Build optimized Storybook
npm run build-storybook

# Run visual regression tests locally
npm run chromatic
```

### CI/CD Integration

The workflow automatically:

- Runs on `main` and `develop` branches
- Executes on all pull requests
- Uploads artifacts for 30-day retention
- Provides PR comments with bundle analysis
- Integrates with GitHub status checks

## Monitoring and Alerts

### Performance Regression Detection

- **Lighthouse CI**: Automatically fails builds if performance thresholds are
  exceeded
- **Bundle Analysis**: Tracks bundle size changes and alerts on significant
  increases
- **Visual Regression**: Chromatic detects and flags visual changes

### Artifact Management

- **Storybook Builds**: Retained for 30 days
- **Bundle Reports**: Available as downloadable artifacts
- **Performance Reports**: Uploaded to Lighthouse CI temporary storage

## Best Practices

### Story Development

1. **Performance Awareness**: Consider lazy loading for heavy components
2. **Theme Testing**: Ensure components work in both light and dark themes
3. **Accessibility**: Maintain 90%+ accessibility scores
4. **Visual Stability**: Avoid components that cause layout shifts

### Chromatic Optimization

1. **Skip Complex Stories**: Use `chromatic.skip` for interactive demos
2. **Delay Configuration**: 300ms delay reduces visual diff noise
3. **Threshold Tuning**: Adjust thresholds for anti-aliasing and color
   differences

### CI/CD Optimization

1. **Caching**: Node.js dependencies are cached between runs
2. **Parallel Execution**: Jobs run in parallel where possible
3. **Artifact Cleanup**: 30-day retention prevents storage bloat

## Troubleshooting

### Common Issues

1. **Project ID Setup**: Update `PROJECT_ID_PLACEHOLDER` in
   `.chromatic.config.json`
2. **Secret Configuration**: Ensure `CHROMATIC_PROJECT_TOKEN` is set in GitHub
   secrets
3. **Bundle Size Alerts**: Check for unexpectedly large dependencies
4. **Performance Failures**: Review Lighthouse CI reports for specific issues

### Debug Commands

```bash
# Build and analyze bundle locally
npm run build-storybook
find storybook-static -name "*.js" -size +100k -exec ls -lh {} \;

# Run Lighthouse locally
npx lighthouse-ci autorun
```

This comprehensive visual regression testing setup ensures consistent visual
quality and performance across all components while providing automated feedback
during development.
