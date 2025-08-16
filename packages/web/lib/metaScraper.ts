// ABOUTME: Utility for extracting Open Graph and meta tags from web pages
// ABOUTME: Provides client-side interface to meta data scraping API

interface MetaData {
  /**
   * The title of the webpage.
   * @example A title of "My Website - Home" would be represented as "My Website - Home"
   */
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  siteName?: string;
  type?: string;
}

interface ScrapingError {
  error: string;
  details?: string;
}

export type MetaScrapingResult = MetaData | ScrapingError;

export function isScrapingError(result: MetaScrapingResult): result is ScrapingError {
  return 'error' in result;
}

export async function scrapeMetaData(url: string): Promise<MetaScrapingResult> {
  try {
    // Validate URL
    new URL(url);
  } catch {
    return { error: 'Invalid URL provided' };
  }

  try {
    const response = await fetch('/api/scrape-meta', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as { message?: string };
      return {
        error: 'Failed to scrape metadata',
        details: errorData.message || `HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as MetaScrapingResult;
    return data;
  } catch (error) {
    return {
      error: 'Network error while scraping metadata',
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
