// ABOUTME: Server-side only meta scraper using simple regex parsing

export interface ServerMetaData {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
}

export function extractMetaData(html: string): ServerMetaData {
  const metaData: ServerMetaData = {};

  // Extract Open Graph tags
  const ogImageMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  if (ogImageMatch) {
    metaData.image = ogImageMatch[1];
  }

  const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (ogTitleMatch) {
    metaData.title = ogTitleMatch[1];
  }

  const ogDescriptionMatch = html.match(
    /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i
  );
  if (ogDescriptionMatch) {
    metaData.description = ogDescriptionMatch[1];
  }

  const ogUrlMatch = html.match(/<meta\s+property=["']og:url["']\s+content=["']([^"']+)["']/i);
  if (ogUrlMatch) {
    metaData.url = ogUrlMatch[1];
  }

  // Fallback to standard meta tags if OG tags not found
  if (!metaData.title) {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) {
      metaData.title = titleMatch[1].trim();
    }
  }

  if (!metaData.description) {
    const descriptionMatch = html.match(
      /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i
    );
    if (descriptionMatch) {
      metaData.description = descriptionMatch[1];
    }
  }

  return metaData;
}
