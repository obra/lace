// ABOUTME: React hook for fetching Open Graph images from URLs
// ABOUTME: Handles async loading and error states for meta data scraping

import { useState, useEffect } from 'react';
import { scrapeMetaData, isScrapingError, type MetaScrapingResult } from '@/lib/metaScraper';

interface UseOgImageResult {
  imageUrl: string | null;
  isLoading: boolean;
  error: string | null;
  metaData: MetaScrapingResult | null;
}

export function useOgImage(url: string | undefined): UseOgImageResult {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [metaData, setMetaData] = useState<MetaScrapingResult | null>(null);

  useEffect(() => {
    if (!url) {
      setImageUrl(null);
      setIsLoading(false);
      setError(null);
      setMetaData(null);
      return;
    }

    const fetchOgImage = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await scrapeMetaData(url);
        setMetaData(result);

        if (isScrapingError(result)) {
          setError(result.error);
          setImageUrl(null);
        } else {
          setImageUrl(result.image || null);
          if (!result.image) {
            setError('No OG image found for this URL');
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
        setError(errorMessage);
        setImageUrl(null);
        setMetaData(null);
      } finally {
        setIsLoading(false);
      }
    };

    // Debounce the fetch to avoid excessive API calls
    const timeoutId = setTimeout(() => {
      void fetchOgImage();
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [url]);

  return {
    imageUrl,
    isLoading,
    error,
    metaData,
  };
}
