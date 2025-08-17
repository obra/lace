'use client';

import React from 'react';
import { logger } from '~/utils/logger';

export default function FontTest() {
  const testCSSVariables = () => {
    const style = getComputedStyle(document.documentElement);
    const lato = style.getPropertyValue('--font-lato');
    const dmSans = style.getPropertyValue('--font-dm-sans');
    const googleSansCode = style.getPropertyValue('--font-google-sans-code');

    logger.debug('font.css.vars', { lato, dmSans, googleSansCode });

    return { lato, dmSans, googleSansCode };
  };

  const checkFontFace = async () => {
    if (typeof window !== 'undefined' && 'fonts' in document) {
      await document.fonts.ready;
      const fonts = Array.from(document.fonts).map((font) => font.family);
      const hasLato = fonts.some((font) => font.includes('Lato'));
      const hasDMSans = fonts.some((font) => font.includes('DM Sans'));
      const hasGoogleSansCode = fonts.some((font) => font.includes('Google Sans Code'));

      // Test if fonts can load
      const latoTest = document.fonts.check('16px "Lato"');
      const dmSansTest = document.fonts.check('16px "DM Sans"');
      const googleSansCodeTest = document.fonts.check('16px "Google Sans Code"');

      logger.debug('font.face.status', {
        hasLato,
        hasDMSans,
        hasGoogleSansCode,
        totalFonts: fonts.length,
        latoAvailable: latoTest,
        dmSansAvailable: dmSansTest,
        googleSansCodeAvailable: googleSansCodeTest,
        allFonts: fonts,
      });

      return {
        hasLato,
        hasDMSans,
        hasGoogleSansCode,
        allFonts: fonts,
        latoAvailable: latoTest,
        dmSansAvailable: dmSansTest,
        googleSansCodeAvailable: googleSansCodeTest,
      };
    }
  };

  const testLocalFonts = async () => {
    // Test local @fontsource fonts and CSS variables
    try {
      const rootStyles = getComputedStyle(document.documentElement);
      const fontVariables = {
        lato: rootStyles.getPropertyValue('--font-lato').trim(),
        dmSans: rootStyles.getPropertyValue('--font-dm-sans').trim(),
        googleSansCode: rootStyles.getPropertyValue('--font-google-sans-code').trim(),
      };

      // Check if CSS variables are defined
      const variablesDefined = Object.values(fontVariables).every((v) => v.length > 0);

      const result = {
        fontVariables,
        variablesDefined,
        message: variablesDefined
          ? 'All fonts loaded locally via @fontsource'
          : 'Font CSS variables not properly defined',
      };

      logger.debug('font.local.verification', result);

      return result;
    } catch (error) {
      logger.error('font.verification.error', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };

  const [variables, setVariables] = React.useState<{
    lato?: string;
    dmSans?: string;
    googleSansCode?: string;
  }>({});
  const [localStatus, setLocalStatus] = React.useState<{
    variablesDefined?: boolean;
    error?: string;
  }>({});

  React.useEffect(() => {
    const vars = testCSSVariables();
    setVariables(vars);
    void checkFontFace();
    void testLocalFonts().then(setLocalStatus);
  }, []);

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-2xl font-bold">Font Diagnostic Test</h1>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">CSS Variables</h2>
        <div className="bg-base-200 p-4 rounded font-mono text-sm">
          <div>--font-lato: {variables.lato || 'NOT SET'}</div>
          <div>--font-dm-sans: {variables.dmSans || 'NOT SET'}</div>
          <div>--font-google-sans-code: {variables.googleSansCode || 'NOT SET'}</div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Local Font Status</h2>
        <div className="bg-base-200 p-4 rounded font-mono text-sm">
          {localStatus.variablesDefined ? (
            <div className="text-success">✅ All fonts loaded locally via @fontsource</div>
          ) : localStatus.error ? (
            <div className="text-error">❌ Font verification error: {localStatus.error}</div>
          ) : localStatus.variablesDefined === false ? (
            <div className="text-warning">⚠️ Font CSS variables not properly defined</div>
          ) : (
            <div className="text-base-content/60">⏳ Testing local fonts...</div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Font Stack Tests</h2>

        <div className="space-y-2">
          <h3 className="font-semibold">font-mono class (Tailwind):</h3>
          <div className="font-mono p-4 bg-base-100 border rounded text-lg">
            The quick brown fox jumps over the lazy dog 123456789
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">.font-code class (Custom CSS):</h3>
          <div className="font-code p-4 bg-base-100 border rounded text-lg">
            The quick brown fox jumps over the lazy dog 123456789
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">Direct Google Sans Code (CSS variable):</h3>
          <div
            style={{ fontFamily: 'var(--font-google-sans-code)' }}
            className="p-4 bg-base-100 border rounded text-lg"
          >
            The quick brown fox jumps over the lazy dog 123456789
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">Direct Google Sans Code (font name):</h3>
          <div
            style={{ fontFamily: 'Google Sans Code, monospace' }}
            className="p-4 bg-base-100 border rounded text-lg"
          >
            The quick brown fox jumps over the lazy dog 123456789
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">Direct Lato (CSS variable):</h3>
          <div
            style={{ fontFamily: 'var(--font-lato)' }}
            className="p-4 bg-base-100 border rounded text-lg"
          >
            The quick brown fox jumps over the lazy dog 123456789
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">Direct DM Sans (CSS variable):</h3>
          <div
            style={{ fontFamily: 'var(--font-dm-sans)' }}
            className="p-4 bg-base-100 border rounded text-lg"
          >
            The quick brown fox jumps over the lazy dog 123456789
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">SF Mono (for comparison):</h3>
          <div
            style={{ fontFamily: 'SF Mono, monospace' }}
            className="p-4 bg-base-100 border rounded text-lg"
          >
            The quick brown fox jumps over the lazy dog 123456789
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Browser DevTools Instructions</h2>
        <div className="bg-base-200 p-4 rounded text-sm space-y-2">
          <p>
            <strong>1. Open DevTools → Network tab</strong>
          </p>
          <p>
            <strong>2. Refresh page and verify:</strong>
          </p>
          <ul className="list-disc ml-4 space-y-1">
            <li>Only local @fontsource font files are loaded (no external requests)</li>
            <li>No requests to fonts.googleapis.com or fonts.gstatic.com</li>
            <li>Font files should come from your domain or bundled assets</li>
          </ul>
          <p>
            <strong>3. Open DevTools → Elements → Computed styles</strong>
          </p>
          <ul className="list-disc ml-4 space-y-1">
            <li>Inspect any font element above</li>
            <li>Look at the font-family computed value</li>
            <li>Verify CSS variables are properly resolved</li>
          </ul>
          <p>
            <strong>4. Check Console for logged font information</strong>
          </p>
        </div>
      </div>

      <button
        onClick={() => {
          const vars = testCSSVariables();
          setVariables(vars);
          void checkFontFace();
          void testLocalFonts().then(setLocalStatus);
        }}
        className="btn btn-primary"
      >
        Re-run All Tests
      </button>
    </div>
  );
}
