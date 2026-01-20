import { v4 as uuidv4 } from 'uuid';
import { ProcessingJob, JobStatus } from '../types/job';
import { ReportAnalysis, Document } from '../types/report';
import { downloadPdf, getReport, callWebhook, updateReportAnalysis } from '../services/supabase';
import { extractMultipleDocuments } from '../services/pdf-extractor';
import { generateStructuredAnalysis, generateKeyFindingsForDocuments } from '../services/openai';
import { scrapeUrl } from '../services/firecrawl';
import { transformToReportAnalysis } from '../services/transformer';
import { logger } from '../utils/logger';

const jobs = new Map<string, ProcessingJob>();

export function createJob(
  reportId: string,
  userId: string,
  url?: string
): ProcessingJob {
  const jobId = uuidv4();
  const job: ProcessingJob = {
    jobId,
    reportId,
    userId,
    url,
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  jobs.set(jobId, job);
  logger.info('Job created', { jobId, reportId, userId });
  
  return job;
}

export function getJob(jobId: string): ProcessingJob | undefined {
  return jobs.get(jobId);
}

function updateJobStatus(
  jobId: string,
  status: JobStatus,
  error?: string
): void {
  const job = jobs.get(jobId);
  if (job) {
    job.status = status;
    job.updatedAt = new Date();
    if (error) {
      job.error = error;
    }
    jobs.set(jobId, job);
  }
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | unknown;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        logger.warn(`Retry attempt ${attempt + 1}/${maxRetries}`, { delay, error });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

export async function processJob(job: ProcessingJob): Promise<void> {
  const { jobId, reportId, userId, url } = job;
  
  try {
    updateJobStatus(jobId, 'processing');
    logger.info('Starting job processing', { jobId, reportId });
    
    const report = await retryWithBackoff(() => getReport(reportId, userId));
    
    if (!report.file_paths || report.file_paths.length === 0) {
      throw new Error('No files found in report');
    }
    
    const downloadPromises = report.file_paths.map((filePath: string) =>
      retryWithBackoff(() => downloadPdf(filePath))
    );
    const pdfBuffers = await Promise.all(downloadPromises);
    
    const documents = report.file_paths.map((filePath: string, index: number) => ({
      buffer: pdfBuffers[index],
      fileName: filePath.split('/').pop() || `document-${index}.pdf`,
    }));
    
    const extractedDocs = await extractMultipleDocuments(documents);
    
    const firecrawlResult = url ? await scrapeUrl(url) : null;
    const urlContent = firecrawlResult?.markdown;
    const firecrawlPropertyDetails = firecrawlResult?.propertyDetails;
    
    const scrapedData = firecrawlResult ? {
      markdown: firecrawlResult.markdown,
      metadata: firecrawlResult.metadata,
      extract: firecrawlResult.extract || firecrawlPropertyDetails || null,
    } : undefined;
    
    const combinedText = extractedDocs
      .map(doc => `=== ${doc.fileName} ===\n${doc.text}`)
      .join('\n\n');
    
    const keyFindings = await generateKeyFindingsForDocuments(
      extractedDocs.map(doc => ({ fileName: doc.fileName, text: doc.text }))
    );
    
    const keyFindingsWithNames = extractedDocs.map((doc, index) => ({
      fileName: doc.fileName,
      findings: keyFindings[index] || 'No key findings available.',
    }));
    
    const structuredAnalysis = await retryWithBackoff(() =>
      generateStructuredAnalysis(combinedText, urlContent, keyFindingsWithNames)
    );
    
    const documentsWithFindings: Document[] = extractedDocs.map((doc, index) => ({
      name: doc.fileName,
      pages: doc.pages,
      keyFindings: keyFindings[index] || 'No key findings available.',
    }));
    
    const analysisResult = transformToReportAnalysis(
      structuredAnalysis,
      documentsWithFindings,
      firecrawlPropertyDetails
    );
    
    await Promise.all([
      callWebhook(reportId, analysisResult, 'completed'),
      updateReportAnalysis(reportId, analysisResult, 'completed', undefined, scrapedData),
    ]);
    
    updateJobStatus(jobId, 'completed');
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Job processing failed', error, { jobId, reportId });
    
    updateJobStatus(jobId, 'failed', errorMessage);
    
    try {
      await Promise.all([
        callWebhook(reportId, {} as ReportAnalysis, 'failed', errorMessage),
        updateReportAnalysis(reportId, {} as ReportAnalysis, 'failed', errorMessage),
      ]);
    } catch (updateError) {
      logger.error('Failed to update report with error status', updateError, { jobId });
    }
    
    throw error;
  }
}

export function startJobProcessor(): void {
  setInterval(() => {
    const pendingJobs = Array.from(jobs.values()).filter(
      job => job.status === 'pending'
    );
    
    pendingJobs.forEach(job => {
      processJob(job).catch(error => {
        logger.error('Background job processing error', error, { jobId: job.jobId });
      });
    });
  }, 5000);
  
  logger.info('Job processor started');
}
