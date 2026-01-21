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
  property_address?: string | null;
  [key: string]: unknown;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
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
  errorMessage?: string,
  scrapedData?: { markdown?: string; metadata?: Record<string, unknown>; extract?: unknown }
): Promise<void> {
  try {
    const updateData: {
      analysis_result: ReportAnalysis;
      status: string;
      error?: string;
      scraped_data?: { markdown?: string; metadata?: Record<string, unknown>; extract?: unknown };
    } = {
      analysis_result: analysisResult,
      status,
    };
    
    if (errorMessage) {
      updateData.error = errorMessage;
    }
    
    if (scrapedData) {
      updateData.scraped_data = scrapedData;
    }
    
    const { error: updateError } = await supabase
      .from('reports')
      .update(updateData)
      .eq('id', reportId);
    
    if (updateError) {
      throw new Error(`Failed to update report: ${updateError.message}`);
    }
  } catch (error) {
    logger.error('Error updating report', error, { reportId });
    throw error;
  }
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .eq('id', userId)
      .single();
    
    if (error) {
      logger.error('Error fetching user profile', error, { userId });
      return null;
    }
    
    if (!data || !data.email) {
      logger.warn('User profile not found or missing email', { userId });
      return null;
    }
    
    return data as UserProfile;
  } catch (error) {
    logger.error('Error fetching user profile', error, { userId });
    return null;
  }
}

export async function callWebhook(
  reportId: string,
  analysisResult: ReportAnalysis,
  status: 'completed' | 'failed',
  error?: string
): Promise<void> {
  if (!config.supabase.webhookUrl?.trim()) {
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
      logger.warn('Webhook call failed', {
        reportId,
        status: response.status,
        error: errorText,
      });
    }
  } catch (error) {
    clearTimeout(timeoutId);
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn('Webhook call failed', {
      reportId,
      error: errorMessage,
      isTimeout: error instanceof Error && error.name === 'AbortError',
    });
  }
}
