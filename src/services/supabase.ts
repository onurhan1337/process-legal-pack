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
      error?: string | null;
    } = {
      analysis_result: analysisResult,
      status,
    };
    
    if (error) {
      updateData.error = error;
    } else {
      updateData.error = null;
    }
    
    const { error: updateError } = await supabase
      .from('reports')
      .update(updateData)
      .eq('id', reportId);
    
    if (updateError) {
      throw new Error(`Failed to update report: ${updateError.message}`);
    }
    
    logger.info('Report updated successfully', { reportId, status });
    
    if (error) {
      logger.warn('Report processing error stored in DB', { reportId, error });
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
    const payload = {
      reportId,
      analysis_result: analysisResult,
      status,
      error,
      webhookSecret: config.webhook.secret,
    };
    
    const response = await fetch(config.supabase.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Webhook call failed: ${response.status} ${errorText}`);
    }
    
    logger.info('Webhook called successfully', { reportId, status });
  } catch (error) {
    logger.error('Error calling webhook', error, { reportId });
  }
}
