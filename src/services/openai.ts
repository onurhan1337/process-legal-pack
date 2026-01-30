import OpenAI from 'openai';
import pLimit from 'p-limit';
import { config } from '../config/env';
import { ReportIssue, Charge } from '../types/report';
import { logger } from '../utils/logger';
import {
  STRUCTURED_ANALYSIS_SYSTEM_PROMPT,
  STRUCTURED_ANALYSIS_USER_PROMPT_TEMPLATE,
  KEY_FINDINGS_SYSTEM_PROMPT,
  KEY_FINDINGS_USER_PROMPT_TEMPLATE,
} from '../prompts/openai';

interface LLMConfig {
  client: OpenAI;
  model: string;
  fastModel: string;
  temperature: number;
  fastTemperature: number;
  maxTokensStructured: number;
  maxTokensKeyFindings: number;
}

export interface KeyFindingsResult {
  findings: string[];
  failedCount: number;
  failedDocuments: string[];
  processingTimeMs: number;
}

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

function createLLMConfig(): LLMConfig {
  const provider = config.llm.provider;

  if (provider === 'kimi') {
    if (!config.moonshot.apiKey) {
      throw new Error('MOONSHOT_API_KEY is required when LLM_PROVIDER is set to kimi');
    }

    return {
      client: new OpenAI({
        apiKey: config.moonshot.apiKey,
        baseURL: 'https://api.moonshot.ai/v1',
      }),
      model: 'kimi-k2-thinking',
      fastModel: config.llm.useFastModelForKeyFindings ? 'moonshot-v1-128k' : 'kimi-k2-thinking',
      temperature: 1.0,
      fastTemperature: 0.3,
      maxTokensStructured: 16000,
      maxTokensKeyFindings: 2000,
    };
  }

  return {
    client: new OpenAI({
      apiKey: config.openai.apiKey,
    }),
    model: 'gpt-4o-mini',
    fastModel: 'gpt-4o-mini',
    temperature: 0.3,
    fastTemperature: 0.3,
    maxTokensStructured: 4096,
    maxTokensKeyFindings: 500,
  };
}

const llmConfig = createLLMConfig();

function extractContent(message: OpenAI.Chat.Completions.ChatCompletionMessage): string | null {
  const content = message.content;

  const reasoningContent = (message as { reasoning_content?: string }).reasoning_content;
  if (reasoningContent) {
    logger.debug('LLM reasoning', {
      provider: config.llm.provider,
      reasoning: reasoningContent.slice(0, 500) + (reasoningContent.length > 500 ? '...' : ''),
    });
  }

  return content;
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

async function generateKeyFindingsSingle(
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
    const completion = await llmConfig.client.chat.completions.create({
      model: llmConfig.fastModel,
      messages: [
        { role: 'system', content: KEY_FINDINGS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: llmConfig.fastTemperature,
      max_tokens: llmConfig.maxTokensKeyFindings,
    });

    const message = completion.choices[0]?.message;
    if (!message) {
      throw new Error('No message returned from LLM');
    }

    const content = extractContent(message);
    if (!content) {
      throw new Error('No content returned from LLM');
    }

    const trimmedContent = content.trim();

    if (
      trimmedContent.toLowerCase().includes('i am unable to extract text') ||
      trimmedContent.toLowerCase().includes('i am unable to access') ||
      trimmedContent.toLowerCase().includes('unable to extract text from the provided pdf')
    ) {
      return `Unable to extract meaningful text from ${fileName}. The document may be image-based or corrupted.`;
    }

    return trimmedContent;
  } catch (error) {
    logger.error('Error generating key findings', error, {
      fileName,
      provider: config.llm.provider,
      model: llmConfig.fastModel,
    });
    return `Error generating key findings: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function generateKeyFindingsBatch(
  documents: Array<{ fileName: string; text: string }>
): Promise<{ findings: string[]; failed: string[] }> {
  const failed: string[] = [];

  const batchPrompt = documents
    .map((doc, index) => {
      if (!doc.text || doc.text.trim().length === 0) {
        return `[DOCUMENT ${index + 1}: ${doc.fileName}]\nNo text content available.`;
      }
      if (doc.text.startsWith('Error extracting text:')) {
        return `[DOCUMENT ${index + 1}: ${doc.fileName}]\n${doc.text}`;
      }
      return `[DOCUMENT ${index + 1}: ${doc.fileName}]\n${doc.text}`;
    })
    .join('\n\n---\n\n');

  const systemPrompt = `${KEY_FINDINGS_SYSTEM_PROMPT}

IMPORTANT: You are analyzing MULTIPLE documents. For EACH document, provide key findings in the following JSON format:
{
  "documents": [
    { "fileName": "document1.pdf", "findings": "key findings for document 1..." },
    { "fileName": "document2.pdf", "findings": "key findings for document 2..." }
  ]
}

Ensure you provide findings for ALL documents in the batch. If a document has no extractable content, indicate that in its findings.`;

  const userPrompt = `Analyze the following ${documents.length} documents and extract key findings for each:\n\n${batchPrompt}`;

  try {
    const completion = await llmConfig.client.chat.completions.create({
      model: llmConfig.fastModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: llmConfig.fastTemperature,
      max_tokens: Math.min(llmConfig.maxTokensKeyFindings * documents.length, 8000),
    });

    const message = completion.choices[0]?.message;
    if (!message) {
      throw new Error('No message returned from LLM');
    }

    const content = extractContent(message);
    if (!content) {
      throw new Error('No content returned from LLM');
    }

    const parsed = JSON.parse(content) as {
      documents: Array<{ fileName: string; findings: string }>;
    };

    const findings = documents.map((doc) => {
      const result = parsed.documents.find(
        (d) => d.fileName === doc.fileName || d.fileName.includes(doc.fileName)
      );
      if (result) {
        return result.findings;
      }
      failed.push(doc.fileName);
      return 'No key findings available.';
    });

    return { findings, failed };
  } catch (error) {
    logger.error('Error in batch key findings generation', error, {
      documentCount: documents.length,
      provider: config.llm.provider,
    });

    return {
      findings: documents.map(
        () => `Error generating key findings: ${error instanceof Error ? error.message : String(error)}`
      ),
      failed: documents.map((d) => d.fileName),
    };
  }
}

export async function generateKeyFindingsForDocuments(
  documents: Array<{ fileName: string; text: string }>
): Promise<KeyFindingsResult> {
  const startTime = Date.now();
  const batchSize = config.llm.batchSize;
  const concurrency = config.llm.concurrency;

  logger.info('Starting key findings generation', {
    documentCount: documents.length,
    batchSize,
    concurrency,
    model: llmConfig.fastModel,
  });

  if (documents.length === 0) {
    return {
      findings: [],
      failedCount: 0,
      failedDocuments: [],
      processingTimeMs: Date.now() - startTime,
    };
  }

  if (documents.length <= 2) {
    const limit = pLimit(concurrency);
    const promises = documents.map((doc) =>
      limit(() => generateKeyFindingsSingle(doc.fileName, doc.text))
    );

    const findings = await Promise.all(promises);
    const failedDocuments = documents
      .filter((_, i) => findings[i].startsWith('Error') || findings[i].includes('Unable to'))
      .map((doc) => doc.fileName);

    return {
      findings,
      failedCount: failedDocuments.length,
      failedDocuments,
      processingTimeMs: Date.now() - startTime,
    };
  }

  const batches = chunkArray(documents, batchSize);
  const limit = pLimit(concurrency);
  const allFailed: string[] = [];

  logger.info('Processing documents in batches', {
    totalBatches: batches.length,
    documentsPerBatch: batchSize,
  });

  const batchPromises = batches.map((batch, batchIndex) =>
    limit(async () => {
      logger.debug(`Processing batch ${batchIndex + 1}/${batches.length}`, {
        documentCount: batch.length,
        documents: batch.map((d) => d.fileName),
      });

      const result = await generateKeyFindingsBatch(batch);

      logger.debug(`Completed batch ${batchIndex + 1}/${batches.length}`, {
        failedCount: result.failed.length,
      });

      return result;
    })
  );

  const batchResults = await Promise.all(batchPromises);

  const findings: string[] = [];
  for (const result of batchResults) {
    findings.push(...result.findings);
    allFailed.push(...result.failed);
  }

  const processingTimeMs = Date.now() - startTime;

  logger.info('Key findings generation complete', {
    documentCount: documents.length,
    failedCount: allFailed.length,
    processingTimeMs,
    avgTimePerDoc: Math.round(processingTimeMs / documents.length),
  });

  return {
    findings,
    failedCount: allFailed.length,
    failedDocuments: allFailed,
    processingTimeMs,
  };
}

export async function generateStructuredAnalysis(
  combinedText: string,
  urlContent?: string,
  keyFindings?: Array<{ fileName: string; findings: string }>
): Promise<StructuredAnalysisResponse> {
  const startTime = Date.now();

  logger.info('Starting structured analysis', {
    hasUrlContent: !!urlContent,
    keyFindingsCount: keyFindings?.length || 0,
    model: llmConfig.model,
  });

  const fullText = urlContent
    ? `URL Content:\n${urlContent}\n\n---\n\nLegal Pack Documents:\n${combinedText}`
    : combinedText;

  let keyFindingsSection = '';
  if (keyFindings && keyFindings.length > 0) {
    const findingsText = keyFindings
      .map((kf) => `=== Key Findings: ${kf.fileName} ===\n${kf.findings}`)
      .join('\n\n');

    keyFindingsSection = `\n\n---\n\nKEY FINDINGS FROM INDIVIDUAL DOCUMENTS:

CRITICAL INSTRUCTIONS:
1. The following key findings contain IMPORTANT information that MUST be extracted and categorized
2. Go through EACH numbered point, bullet point, or distinct finding
3. For EACH finding, create a separate issue entry in the appropriate section
4. DO NOT summarize or combine multiple findings into one issue - break them down
5. If key findings contain 10 important points, extract ALL 10 into structured sections
6. Be COMPREHENSIVE - extract every relevant piece of information
7. Do not leave important information only in key findings - it MUST appear in structured sections

${findingsText}

Remember: Extract comprehensively. Each distinct risk, obligation, charge, or concern should be its own entry in the appropriate section.`;
  }

  const userPrompt = STRUCTURED_ANALYSIS_USER_PROMPT_TEMPLATE
    .replace('{content}', fullText)
    .replace('{keyFindingsSection}', keyFindingsSection);

  try {
    const completion = await llmConfig.client.chat.completions.create({
      model: llmConfig.model,
      messages: [
        { role: 'system', content: STRUCTURED_ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: llmConfig.temperature,
      max_tokens: llmConfig.maxTokensStructured,
    });

    const message = completion.choices[0]?.message;
    if (!message) {
      throw new Error('No message returned from LLM');
    }

    const content = extractContent(message);
    if (!content) {
      throw new Error('No content returned from LLM');
    }

    const parsed = JSON.parse(content) as StructuredAnalysisResponse;

    logger.info('Structured analysis generated successfully', {
      provider: config.llm.provider,
      model: llmConfig.model,
      processingTimeMs: Date.now() - startTime,
    });

    return parsed;
  } catch (error) {
    logger.error('Error generating structured analysis', error, {
      provider: config.llm.provider,
      model: llmConfig.model,
    });
    throw new Error(
      `Failed to generate structured analysis: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function generateKeyFindings(
  fileName: string,
  extractedText: string
): Promise<string> {
  return generateKeyFindingsSingle(fileName, extractedText);
}
