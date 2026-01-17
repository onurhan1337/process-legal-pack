export interface ReportIssue {
  severity: 'critical' | 'warning' | 'info';
  description: string;
  recommendation?: string;
}

export interface Charge {
  type: string;
  amount?: string;
  description: string;
}

export interface PropertyDetails {
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  size?: string;
  tenure?: string;
  guidePrice?: string;
  auctionDate?: string;
  auctionDateNote?: string;
  epcRating?: string;
  councilTax?: string;
  buyersCharge?: string;
  administrationCharge?: string;
}

export interface PropertyDetailsWithCitations {
  address?: string;
  address_citation?: string;
  guide_price?: string;
  guide_price_citation?: string;
  auction_date?: string;
  auction_date_citation?: string;
  catalog_number?: string;
  catalog_number_citation?: string;
  tenure?: string;
  tenure_citation?: string;
  description?: string;
  description_citation?: string;
  number_of_bedrooms?: number;
  number_of_bedrooms_citation?: string;
  number_of_bathrooms?: number;
  number_of_bathrooms_citation?: string;
  size?: string;
  size_citation?: string;
  lot_type?: string;
  lot_type_citation?: string;
  epc_rating?: string;
  epc_rating_citation?: string;
  council_tax?: string;
  council_tax_citation?: string;
  buyers_charge?: string;
  buyers_charge_citation?: string;
  administration_charge_band?: string;
  administration_charge_band_citation?: string;
}

export interface Document {
  name: string;
  pages: number;
  keyFindings: string;
}

export interface ASTAScore {
  score: number;
  maxScore: number;
  description: string;
}

export interface ReportAnalysis {
  title: {
    issues: ReportIssue[];
    description: string;
  };
  ownership: {
    issues: ReportIssue[];
  };
  chargesAndMoney: {
    charges: Charge[];
    issues: ReportIssue[];
  };
  covenants: string;
  tenure: string;
  planningAndDevelopment: {
    issues: ReportIssue[];
  };
  completionAndPenaltyRisks: {
    issues: ReportIssue[];
  };
  physicalAndEnvironmentalRisks: {
    issues: ReportIssue[];
  };
  specialConditionsAndAmenities: {
    issues: ReportIssue[];
  };
  documents: Document[];
  propertyDetails: PropertyDetails;
  astaScore?: ASTAScore;
}

export interface WebhookPayload {
  reportId: string;
  analysis_result: ReportAnalysis;
  status: 'completed' | 'failed';
  error?: string;
  webhookSecret: string;
}
