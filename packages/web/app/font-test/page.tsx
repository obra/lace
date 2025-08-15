'use client';

import React from 'react';

export default function FontTest() {
  const testCSSVariables = () => {
    const style = getComputedStyle(document.documentElement);
    const googleSansCode = style.getPropertyValue('--font-google-sans-code');
    const sourceCodePro = style.getPropertyValue('--font-source-code-pro');

    // eslint-disable-next-line no-console
    console.log('CSS Variables:', { googleSansCode, sourceCodePro });

    return { googleSansCode, sourceCodePro };
  };

  const checkFontFace = async () => {
    if (typeof window !== 'undefined' && 'fonts' in document) {
      await document.fonts.ready;
      const fonts = Array.from(document.fonts).map((font) => font.family);
      const hasGoogleSansCode = fonts.some((font) => font.includes('Google Sans Code'));
      const hasSourceCodePro = fonts.some((font) => font.includes('Source Code Pro'));

      // Test if Google Sans Code can load
      const googleSansCodeTest = document.fonts.check('16px "Google Sans Code"');

      // eslint-disable-next-line no-console
      console.log('Font status:', {
        hasGoogleSansCode,
        hasSourceCodePro,
        totalFonts: fonts.length,
        googleSansCodeAvailable: googleSansCodeTest,
        allFonts: fonts,
      });

      return {
        hasGoogleSansCode,
        hasSourceCodePro,
        allFonts: fonts,
        googleSansCodeAvailable: googleSansCodeTest,
      };
    }
  };

  const testNetworkFetch = async () => {
    const googleFontsUrl =
      'https://fonts.googleapis.com/css2?family=Google+Sans+Code:ital,wght@0,300..800;1,300..800&display=swap';
    try {
      const response = await fetch(googleFontsUrl);
      const cssText = await response.text();

      // eslint-disable-next-line no-console
      console.log('Google Fonts CSS response:', {
        status: response.status,
        ok: response.ok,
        cssLength: cssText.length,
        preview: cssText.substring(0, 200) + '...',
      });

      return { status: response.status, ok: response.ok, css: cssText };
    } catch (error) {
      console.error('Failed to fetch Google Fonts CSS:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };

  const [variables, setVariables] = React.useState<{
    googleSansCode?: string;
    sourceCodePro?: string;
  }>({});
  const [networkStatus, setNetworkStatus] = React.useState<{
    status?: number;
    ok?: boolean;
    error?: string;
  }>({});

  React.useEffect(() => {
    const vars = testCSSVariables();
    setVariables(vars);
    void checkFontFace();
    void testNetworkFetch().then(setNetworkStatus);
  }, []);

  return (
    <div className="p-8 space-y-8">
      <h1 className="text-2xl font-bold">Font Diagnostic Test</h1>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">CSS Variables</h2>
        <div className="bg-base-200 p-4 rounded font-mono text-sm">
          <div>--font-google-sans-code: {variables.googleSansCode || 'NOT SET'}</div>
          <div>--font-source-code-pro: {variables.sourceCodePro || 'NOT SET'}</div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Network Status</h2>
        <div className="bg-base-200 p-4 rounded font-mono text-sm">
          {networkStatus.ok ? (
            <div className="text-green-600">
              ✅ Google Fonts CSS loaded successfully (Status: {networkStatus.status})
            </div>
          ) : networkStatus.error ? (
            <div className="text-red-600">❌ Network error: {networkStatus.error}</div>
          ) : networkStatus.status ? (
            <div className="text-yellow-600">⚠️ HTTP {networkStatus.status} response</div>
          ) : (
            <div className="text-gray-500">⏳ Testing network access...</div>
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
          <h3 className="font-semibold">Direct Source Code Pro (CSS variable):</h3>
          <div
            style={{ fontFamily: 'var(--font-source-code-pro)' }}
            className="p-4 bg-base-100 border rounded text-lg"
          >
            The quick brown fox jumps over the lazy dog 123456789
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">Direct Source Code Pro (font name):</h3>
          <div
            style={{ fontFamily: 'Source Code Pro, monospace' }}
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
            <strong>2. Refresh page and look for:</strong>
          </p>
          <ul className="list-disc ml-4 space-y-1">
            <li>Google Sans Code font files from fonts.googleapis.com</li>
            <li>Source Code Pro font files (if any)</li>
          </ul>
          <p>
            <strong>3. Open DevTools → Elements → Computed styles</strong>
          </p>
          <ul className="list-disc ml-4 space-y-1">
            <li>Inspect any .font-mono element above</li>
            <li>Look at the font-family computed value</li>
            <li>See which font is actually being used</li>
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
          void testNetworkFetch().then(setNetworkStatus);
        }}
        className="btn btn-primary"
      >
        Re-run All Tests
      </button>
    </div>
  );
}
