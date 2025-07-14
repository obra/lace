// ABOUTME: API endpoint for scraping Open Graph and meta tags from web pages

import { NextRequest, NextResponse } from 'next/server';
import { extractMetaData } from '~/lib/serverMetaScraper';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { url?: unknown };
    const { url } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required and must be a string' }, { status: 400 });
    }

    // Validate URL
    let validUrl: URL;
    try {
      validUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL provided' }, { status: 400 });
    }

    // Security: Only allow HTTPS URLs and specific domains for safety
    if (validUrl.protocol !== 'https:') {
      return NextResponse.json({ error: 'Only HTTPS URLs are allowed' }, { status: 400 });
    }

    // Allow specific domains (can be expanded)
    const allowedDomains = [
      'docs.google.com',
      'drive.google.com',
      'sheets.google.com',
      'slides.google.com',
    ];

    if (!allowedDomains.includes(validUrl.hostname)) {
      return NextResponse.json({ error: 'Domain not allowed for scraping' }, { status: 403 });
    }

    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Lace Bot/1.0)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        Connection: 'keep-alive',
      },
      // Add timeout
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch page: HTTP ${response.status}` },
        { status: response.status }
      );
    }

    const html = await response.text();
    const metaData = extractMetaData(html);

    return NextResponse.json(metaData);
  } catch (error) {
    console.error('Meta scraping error:', error);

    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json({ error: 'Request timeout while fetching page' }, { status: 408 });
    }

    return NextResponse.json(
      { error: 'Internal server error while scraping metadata' },
      { status: 500 }
    );
  }
}
