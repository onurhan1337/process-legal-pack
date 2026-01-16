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
  };
}

export async function generateStructuredAnalysis(
  combinedText: string,
  urlContent?: string
): Promise<StructuredAnalysisResponse> {
  const fullText = urlContent
    ? `URL Content:\n${urlContent}\n\n---\n\nLegal Pack Documents:\n${combinedText}`
    : combinedText;
  
  const userPrompt = STRUCTURED_ANALYSIS_USER_PROMPT_TEMPLATE.replace('{content}', fullText);

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
    
    return content.trim();
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
