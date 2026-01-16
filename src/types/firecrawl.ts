import { z } from 'zod';
import { PropertyDetailsWithCitations } from './report';

export const propertyDetailsSchema = z.object({
  address: z.string(),
  address_citation: z.string(),
  guide_price: z.string(),
  guide_price_citation: z.string(),
  auction_date: z.string(),
  auction_date_citation: z.string(),
  catalog_number: z.string().optional(),
  catalog_number_citation: z.string().optional(),
  tenure: z.string().optional(),
  tenure_citation: z.string().optional(),
  description: z.string().optional(),
  description_citation: z.string().optional(),
  number_of_bedrooms: z.number().optional(),
  number_of_bedrooms_citation: z.string().optional(),
  number_of_bathrooms: z.number().optional(),
  number_of_bathrooms_citation: z.string().optional(),
  size: z.string().optional(),
  size_citation: z.string().optional(),
  lot_type: z.string().optional(),
  lot_type_citation: z.string().optional(),
  epc_rating: z.string().optional(),
  epc_rating_citation: z.string().optional(),
  council_tax: z.string().optional(),
  council_tax_citation: z.string().optional(),
  buyers_charge: z.string().optional(),
  buyers_charge_citation: z.string().optional(),
  administration_charge_band: z.string().optional(),
  administration_charge_band_citation: z.string().optional(),
});

export interface FirecrawlResponse {
  propertyDetails?: PropertyDetailsWithCitations;
  markdown?: string;
  metadata?: {
    title?: string;
    description?: string;
    [key: string]: unknown;
  };
}
