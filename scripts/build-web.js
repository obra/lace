#!/usr/bin/env node

// ABOUTME: Silent web build script that redirects Vite output to logging system
// ABOUTME: Used by npm scripts to build web assets without cluttering CLI stdout

import { build } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Import our Vite config
const viteConfig = await import('../vite.config.js')

async function buildWeb() {
  const startTime = Date.now()
  
  try {
    // Suppress Vite's console output by overriding console methods temporarily
    const originalConsole = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error
    }

    // Redirect console output to stderr (for potential logging) or suppress completely
    const silent = process.env.VITE_SILENT === 'true'
    
    if (silent) {
      console.log = () => {}
      console.info = () => {}
      console.warn = (...args) => {
        // Send warnings to stderr so they can be captured by logging systems
        process.stderr.write(`[Vite] ${args.join(' ')}\n`)
      }
      console.error = (...args) => {
        process.stderr.write(`[Vite Error] ${args.join(' ')}\n`)
      }
    }

    // Build with Vite
    await build(viteConfig.default)

    // Restore console
    Object.assign(console, originalConsole)

    const duration = Date.now() - startTime
    
    if (!silent) {
      console.log(`✅ Web assets built successfully (${duration}ms)`)
    }
    // In silent mode, don't output anything at all
    
  } catch (error) {
    console.error('❌ Web build failed:', error.message)
    process.exit(1)
  }
}

buildWeb()