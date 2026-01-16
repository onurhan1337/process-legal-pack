import { ReportAnalysis, Document, PropertyDetails, PropertyDetailsWithCitations } from '../types/report';
import { StructuredAnalysisResponse } from './openai';

function convertFirecrawlPropertyDetails(
  firecrawlDetails: PropertyDetailsWithCitations
): PropertyDetails {
  return {
    propertyType: firecrawlDetails.lot_type,
    bedrooms: firecrawlDetails.number_of_bedrooms,
    bathrooms: firecrawlDetails.number_of_bathrooms,
    size: firecrawlDetails.size,
    tenure: firecrawlDetails.tenure,
    guidePrice: firecrawlDetails.guide_price,
    auctionDate: firecrawlDetails.auction_date,
  };
}

function mergePropertyDetails(
  openaiDetails: PropertyDetails,
  firecrawlDetails?: PropertyDetailsWithCitations
): PropertyDetails {
  if (!firecrawlDetails) {
    return openaiDetails;
  }
  
  const converted = convertFirecrawlPropertyDetails(firecrawlDetails);
  
  return {
    ...openaiDetails,
    ...converted,
    propertyType: converted.propertyType || openaiDetails.propertyType,
    bedrooms: converted.bedrooms ?? openaiDetails.bedrooms,
    bathrooms: converted.bathrooms ?? openaiDetails.bathrooms,
    size: converted.size || openaiDetails.size,
    tenure: converted.tenure || openaiDetails.tenure,
    guidePrice: converted.guidePrice || openaiDetails.guidePrice,
    auctionDate: converted.auctionDate || openaiDetails.auctionDate,
  };
}

export function transformToReportAnalysis(
  structuredAnalysis: StructuredAnalysisResponse,
  documents: Document[],
  firecrawlPropertyDetails?: PropertyDetailsWithCitations
): ReportAnalysis {
  const mergedPropertyDetails = mergePropertyDetails(
    structuredAnalysis.propertyDetails || {},
    firecrawlPropertyDetails
  );
  
  return {
    title: structuredAnalysis.title,
    ownership: structuredAnalysis.ownership,
    chargesAndMoney: structuredAnalysis.chargesAndMoney,
    covenants: structuredAnalysis.covenants || '',
    tenure: structuredAnalysis.tenure || '',
    planningAndDevelopment: structuredAnalysis.planningAndDevelopment,
    completionAndPenaltyRisks: structuredAnalysis.completionAndPenaltyRisks,
    physicalAndEnvironmentalRisks: structuredAnalysis.physicalAndEnvironmentalRisks,
    specialConditionsAndAmenities: structuredAnalysis.specialConditionsAndAmenities,
    documents,
    propertyDetails: mergedPropertyDetails,
  };
}
