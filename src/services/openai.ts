import OpenAI from 'openai';
import { config } from '../config/env';
import { ReportIssue, Charge } from '../types/report';
import { logger } from '../utils/logger';
import {
  STRUCTURED_ANALYSIS_SYSTEM_PROMPT,
  STRUCTURED_ANALYSIS_USER_PROMPT_TEMPLATE,
  KEY_FINDINGS_SYSTEM_PROMPT,
  KEY_FINDINGS_USER_PROMPT_TEMPLATE,
} from '../prompts/openai';

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

export interface StructuredAnalysisResponse {
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
  propertyDetails: {
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
  };
}

export async function generateStructuredAnalysis(
  combinedText: string,
  urlContent?: string,
  keyFindings?: Array<{ fileName: string; findings: string }>
): Promise<StructuredAnalysisResponse> {
  const fullText = urlContent
    ? `URL Content:\n${urlContent}\n\n---\n\nLegal Pack Documents:\n${combinedText}`
    : combinedText;
  
  let keyFindingsSection = '';
  if (keyFindings && keyFindings.length > 0) {
    const findingsText = keyFindings
      .map(kf => `=== Key Findings: ${kf.fileName} ===\n${kf.findings}`)
      .join('\n\n');
    keyFindingsSection = `\n\n---\n\nKEY FINDINGS FROM INDIVIDUAL DOCUMENTS:\n\nCRITICAL INSTRUCTIONS:\n1. The following key findings contain IMPORTANT information that MUST be extracted and categorized\n2. Go through EACH numbered point, bullet point, or distinct finding\n3. For EACH finding, create a separate issue entry in the appropriate section\n4. DO NOT summarize or combine multiple findings into one issue - break them down\n5. If key findings contain 10 important points, extract ALL 10 into structured sections\n6. Be COMPREHENSIVE - extract every relevant piece of information\n7. Do not leave important information only in key findings - it MUST appear in structured sections\n\n${findingsText}\n\nRemember: Extract comprehensively. Each distinct risk, obligation, charge, or concern should be its own entry in the appropriate section.`;
  }
  
  const userPrompt = STRUCTURED_ANALYSIS_USER_PROMPT_TEMPLATE
    .replace('{content}', fullText)
    .replace('{keyFindingsSection}', keyFindingsSection);

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: STRUCTURED_ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });
    
    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content returned from OpenAI');
    }
    
    const parsed = JSON.parse(content) as StructuredAnalysisResponse;
    logger.info('Structured analysis generated successfully');
    return parsed;
  } catch (error) {
    logger.error('Error generating structured analysis', error);
    throw new Error(`Failed to generate structured analysis: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function generateKeyFindings(
  fileName: string,
  extractedText: string
): Promise<string> {
  if (!extractedText || extractedText.trim().length === 0) {
    return 'No text content available for analysis.';
  }

  if (extractedText.startsWith('Error extracting text:')) {
    return `Unable to extract text from ${fileName}. ${extractedText}`;
  }

  const userPrompt = KEY_FINDINGS_USER_PROMPT_TEMPLATE
    .replace('{fileName}', fileName)
    .replace('{content}', extractedText);

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: KEY_FINDINGS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });
    
    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No content returned from OpenAI');
    }
    
    const trimmedContent = content.trim();
    
    if (trimmedContent.toLowerCase().includes('i am unable to extract text') || 
        trimmedContent.toLowerCase().includes('i am unable to access') ||
        trimmedContent.toLowerCase().includes('unable to extract text from the provided pdf')) {
      return `Unable to extract meaningful text from ${fileName}. The document may be image-based or corrupted.`;
    }
    
    return trimmedContent;
  } catch (error) {
    logger.error('Error generating key findings', error, { fileName });
    return `Error generating key findings: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function generateKeyFindingsForDocuments(
  documents: Array<{ fileName: string; text: string }>
): Promise<string[]> {
  const promises = documents.map(doc => generateKeyFindings(doc.fileName, doc.text));
  return Promise.all(promises);
}
