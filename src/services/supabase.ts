import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/env';
import { ReportAnalysis } from '../types/report';
import { logger } from '../utils/logger';

const supabase: SupabaseClient = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey
);

export interface ReportRecord {
  id: string;
  user_id: string;
  status: string;
  file_paths?: string[];
  [key: string]: unknown;
}

export async function downloadPdf(filePath: string): Promise<Buffer> {
  try {
    const { data, error } = await supabase.storage
      .from('legal-packs')
      .download(filePath);
    
    if (error) {
      throw new Error(`Failed to download PDF: ${error.message}`);
    }
    
    if (!data) {
      throw new Error('No data returned from storage');
    }
    
    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    logger.error('Error downloading PDF', error, { filePath });
    throw error;
  }
}

export async function getReport(reportId: string, userId: string): Promise<ReportRecord> {
  try {
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .eq('id', reportId)
      .eq('user_id', userId)
      .single();
    
    if (error) {
      throw new Error(`Failed to fetch report: ${error.message}`);
    }
    
    if (!data) {
      throw new Error('Report not found');
    }
    
    return data as ReportRecord;
  } catch (error) {
    logger.error('Error fetching report', error, { reportId, userId });
    throw error;
  }
}

export async function updateReportAnalysis(
  reportId: string,
  analysisResult: ReportAnalysis,
  status: 'completed' | 'failed',
  error?: string
): Promise<void> {
  try {
    const updateData: {
      analysis_result: ReportAnalysis;
      status: string;
    } = {
      analysis_result: analysisResult,
      status,
    };
    
    const { error: updateError } = await supabase
      .from('reports')
      .update(updateData)
      .eq('id', reportId);
    
    if (updateError) {
      throw new Error(`Failed to update report: ${updateError.message}`);
    }
    
    logger.info('Report updated successfully', { reportId, status });
    
    if (error) {
      logger.warn('Report processing error (logged separately)', { reportId, error, status });
    }
  } catch (error) {
    logger.error('Error updating report', error, { reportId });
    throw error;
  }
}

export async function callWebhook(
  reportId: string,
  analysisResult: ReportAnalysis,
  status: 'completed' | 'failed',
  error?: string
): Promise<void> {
  try {
    if (!config.supabase.webhookUrl || config.supabase.webhookUrl.trim() === '') {
      logger.warn('Webhook URL not configured, skipping webhook call', { reportId });
      return;
    }
    
    const payload: {
      reportId: string;
      analysis_result: ReportAnalysis;
      status: 'completed' | 'failed';
      error?: string;
      webhookSecret?: string;
    } = {
      reportId,
      analysis_result: analysisResult,
      status,
      error,
    };
    
    if (config.webhook.secret) {
      payload.webhookSecret = config.webhook.secret;
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    try {
      const response = await fetch(config.supabase.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorText = await response.text();
        logger.warn('Webhook call returned non-OK status', {
          reportId,
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        return;
      }
      
      logger.info('Webhook called successfully', { reportId, status });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    logger.warn('Webhook call failed (non-blocking)', {
      reportId,
      error: errorMessage,
      isTimeout,
      ...(config.nodeEnv === 'development' && { stack: error instanceof Error ? error.stack : undefined }),
    });
  }
}
