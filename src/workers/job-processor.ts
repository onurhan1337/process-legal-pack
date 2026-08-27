import { v4 as uuidv4 } from 'uuid';
import { ProcessingJob, JobStatus } from '../types/job';
import { ReportAnalysis, Document } from '../types/report';
import { downloadPdf, getReport, callWebhook, updateReportAnalysis, getUserProfile } from '../services/supabase';
import { refundConsumedCredit } from '../services/billing';
import { extractMultipleDocuments } from '../services/pdf-extractor';
import { generateStructuredAnalysis, generateKeyFindingsForDocuments } from '../services/openai';
import { scrapeUrl } from '../services/firecrawl';
import { transformToReportAnalysis } from '../services/transformer';
import { sendAnalysisCompleteEmail } from '../services/email';
import { logger } from '../utils/logger';

const jobs = new Map<string, ProcessingJob>();

const FINISHED_JOB_RETENTION_MS = 60 * 60 * 1000;

function pruneFinishedJobs(): void {
  const cutoff = Date.now() - FINISHED_JOB_RETENTION_MS;
  for (const [jobId, job] of jobs) {
    if (
      (job.status === 'completed' || job.status === 'failed') &&
      job.updatedAt.getTime() < cutoff
    ) {
      jobs.delete(jobId);
    }
  }
}

export function createJob(
  reportId: string,
  userId: string,
  url?: string,
  consumedCredit?: 'trial' | 'usage'
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
    consumedCredit,
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

let activeJobCount = 0;

export async function waitForActiveJobs(timeoutMs: number = 25000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (activeJobCount > 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

export async function processJob(job: ProcessingJob): Promise<void> {
  const { jobId, reportId, userId, url } = job;

  activeJobCount++;
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
    
    const keyFindingsResult = await generateKeyFindingsForDocuments(
      extractedDocs.map(doc => ({ fileName: doc.fileName, text: doc.text }))
    );
    
    logger.info('Key findings extraction complete', {
      reportId,
      documentCount: extractedDocs.length,
      processingTimeMs: keyFindingsResult.processingTimeMs,
      avgTimePerDoc: Math.round(keyFindingsResult.processingTimeMs / extractedDocs.length),
    });
    
    if (keyFindingsResult.failedCount > 0) {
      logger.warn('Key findings extraction had failures', {
        reportId,
        failedCount: keyFindingsResult.failedCount,
        failedDocuments: keyFindingsResult.failedDocuments,
      });
    }
    
    const keyFindingsWithNames = extractedDocs.map((doc, index) => ({
      fileName: doc.fileName,
      findings: keyFindingsResult.findings[index] || 'No key findings available.',
    }));
    
    const structuredAnalysis = await retryWithBackoff(() =>
      generateStructuredAnalysis(combinedText, urlContent, keyFindingsWithNames)
    );
    
    const documentsWithFindings: Document[] = extractedDocs.map((doc, index) => ({
      name: doc.fileName,
      pages: doc.pages,
      keyFindings: keyFindingsResult.findings[index] || 'No key findings available.',
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
    
    try {
      const profile = await getUserProfile(userId);
      if (profile?.email) {
        await sendAnalysisCompleteEmail(
          profile.email,
          profile.full_name,
          reportId,
          report.property_address || null
        );
      } else {
        logger.warn('Cannot send email: user profile not found or missing email', {
          reportId,
          userId,
        });
      }
    } catch (emailError) {
      logger.error('Failed to send completion email', emailError, {
        reportId,
        userId,
      });
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Job processing failed', error, { jobId, reportId });

    updateJobStatus(jobId, 'failed', errorMessage);

    if (job.consumedCredit) {
      await refundConsumedCredit(userId, reportId, job.consumedCredit);
    }

    try {
      await Promise.all([
        callWebhook(reportId, {} as ReportAnalysis, 'failed', errorMessage),
        updateReportAnalysis(reportId, {} as ReportAnalysis, 'failed', errorMessage),
      ]);
    } catch (updateError) {
      logger.error('Failed to update report with error status', updateError, { jobId });
    }

    throw error;
  } finally {
    activeJobCount--;
  }
}

// Jobs are processed inline by the /process route the moment they are
// created; this interval only prunes finished jobs from the in-memory map.
// Note the queue is in-memory only — jobs do not survive a restart.
export function startJobProcessor(): void {
  setInterval(pruneFinishedJobs, 60_000);
  logger.info('Job processor started (in-memory, prune-only)');
}
