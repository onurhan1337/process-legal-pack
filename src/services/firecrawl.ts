import Firecrawl from '@mendable/firecrawl-js';
import { config } from '../config/env';
import { logger } from '../utils/logger';
import { FirecrawlResponse } from '../types/firecrawl';
import { propertyDetailsSchema } from '../types/firecrawl';
import { PROPERTY_DETAILS_EXTRACTION_PROMPT } from '../prompts/firecrawl';

function isScrapeUrlResponse(response: unknown): response is {
  success: true;
  markdown?: string;
  metadata?: Record<string, unknown>;
  extract?: unknown;
  json?: unknown;
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
    logger.warn('Firecrawl API key not configured', { url });
    return null;
  }
  
  try {
    const firecrawl = new Firecrawl({ apiKey: config.firecrawl.apiKey });
    const result = await firecrawl.scrapeUrl(url, {
      formats: ['markdown', 'extract'],
      extract: {
        schema: propertyDetailsSchema,
        prompt: PROPERTY_DETAILS_EXTRACTION_PROMPT,
      },
    });
    
    if (!isScrapeUrlResponse(result)) {
      return null;
    }
    
    const { markdown, metadata } = result;
    const extractData = result.extract || result.json;
    
    if (!extractData) {
      return markdown ? { markdown, metadata: metadata as FirecrawlResponse['metadata'] } : null;
    }
    
    const parseResult = propertyDetailsSchema.safeParse(extractData);
    
    if (!parseResult.success) {
      logger.warn('Failed to parse extracted property details', { 
        url, 
        error: parseResult.error.message 
      });
      return markdown ? { markdown, metadata: metadata as FirecrawlResponse['metadata'], extract: extractData } : null;
    }
    
    return {
      propertyDetails: parseResult.data,
      markdown,
      metadata: metadata as FirecrawlResponse['metadata'],
      extract: extractData,
    };
  } catch (error) {
    logger.warn('Error scraping with Firecrawl, attempting fallback', error, { url });
    
    try {
      const firecrawl = new Firecrawl({ apiKey: config.firecrawl.apiKey });
      const scrapeResult = await firecrawl.scrapeUrl(url, {
        formats: ['markdown'],
      });
      
      if (isScrapeUrlResponse(scrapeResult)) {
        return {
          markdown: scrapeResult.markdown,
          metadata: scrapeResult.metadata as FirecrawlResponse['metadata'],
        };
      }
      
      return null;
    } catch {
      return null;
    }
  }
}
