import Firecrawl from '@mendable/firecrawl-js';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { FirecrawlResponse } from '../types/firecrawl';
import { propertyDetailsSchema } from '../types/firecrawl';
import { PROPERTY_DETAILS_EXTRACTION_PROMPT } from '../prompts/firecrawl';

function isExtractSuccessResponse<T>(response: unknown): response is { success: true; data: T[] } {
  return (
    typeof response === 'object' &&
    response !== null &&
    'success' in response &&
    response.success === true &&
    'data' in response &&
    Array.isArray((response as { data: unknown }).data)
  );
}

function isScrapeSuccessResponse(response: unknown): response is {
  success: true;
  markdown?: string;
  metadata?: Record<string, unknown>;
} {
  return (
    typeof response === 'object' &&
    response !== null &&
    'success' in response &&
    response.success === true
  );
}

export async function scrapeUrl(url: string): Promise<FirecrawlResponse | null> {
  if (!config.firecrawl.apiKey) {
    logger.warn('Firecrawl API key not configured, skipping URL scraping', { url });
    return null;
  }
  
  try {
    const firecrawl = new Firecrawl({ apiKey: config.firecrawl.apiKey });
    
    logger.info('Extracting property details with Firecrawl extract API', { url });
    
    const extractResult = await (firecrawl as unknown as {
      extract: (params: {
        urls: string[];
        prompt: string;
        schema: unknown;
      }) => Promise<{ success: boolean; data?: unknown[] }>;
    }).extract({
      urls: [url],
      prompt: PROPERTY_DETAILS_EXTRACTION_PROMPT,
      schema: propertyDetailsSchema,
    });
    
    let propertyDetails: FirecrawlResponse['propertyDetails'] | undefined;
    
    if (isExtractSuccessResponse(extractResult)) {
      propertyDetails = Array.isArray(extractResult.data) 
        ? extractResult.data[0] as FirecrawlResponse['propertyDetails'] | undefined
        : undefined;
    } else {
      logger.warn('Firecrawl extract returned error response', { url });
    }
    
    let markdown: string | undefined;
    let metadata: FirecrawlResponse['metadata'] | undefined;
    
    try {
      const scrapeResult = await firecrawl.scrapeUrl(url);
      if (isScrapeSuccessResponse(scrapeResult)) {
        markdown = scrapeResult.markdown;
        metadata = scrapeResult.metadata as FirecrawlResponse['metadata'];
      }
    } catch (scrapeError) {
      logger.warn('Failed to get markdown content', { url, error: scrapeError });
    }
    
    if (!propertyDetails) {
      logger.warn('Firecrawl extract returned no property details', { url });
      if (markdown) {
        return { markdown, metadata };
      }
      return null;
    }
    
    logger.info('Successfully extracted property details', { 
      url, 
      hasAddress: !!propertyDetails.address,
      hasPrice: !!propertyDetails.guide_price 
    });
    
    return {
      propertyDetails,
      markdown,
      metadata,
    };
  } catch (error) {
    logger.warn('Error extracting property details with Firecrawl extract API', error, { url });
    
    try {
      logger.info('Falling back to basic Firecrawl scraping', { url });
      const firecrawl = new Firecrawl({ apiKey: config.firecrawl.apiKey });
      const scrapeResult = await firecrawl.scrapeUrl(url);
      
      if (isScrapeSuccessResponse(scrapeResult)) {
        return {
          markdown: scrapeResult.markdown,
          metadata: scrapeResult.metadata as FirecrawlResponse['metadata'],
        };
      }
      
      return null;
    } catch (fallbackError) {
      logger.warn('Fallback scraping also failed', { url, error: fallbackError });
      return null;
    }
  }
}
