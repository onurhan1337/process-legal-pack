import { config } from '../config/env';
import { logger } from '../utils/logger';

interface EmailTemplate {
  id: string;
  variables: {
    USER_NAME: string;
    PROPERTY_ADDRESS: string;
    REPORT_URL: string;
    REPORT_ID: string;
    USER_EMAIL: string;
  };
}

interface EmailRequest {
  from: string;
  to: string;
  template: EmailTemplate;
}

interface EmailResponse {
  id?: string;
  error?: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  if (baseUrl.includes('@') || baseUrl.includes('<')) {
    const domainMatch = baseUrl.match(/@([^>@\s]+)/);
    if (domainMatch) {
      return `https://${domainMatch[1]}`;
    }
    return 'https://app.useasta.com';
  }

  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    return `https://${baseUrl}`;
  }

  return baseUrl;
}

function extractDomainFromUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').split('/')[0];
}

function buildReportUrl(baseUrl: string, reportId: string): string {
  const normalizedUrl = normalizeBaseUrl(baseUrl);
  return `${normalizedUrl}/reports/${reportId}`;
}

function buildFromEmail(baseUrl: string): string {
  const normalizedUrl = normalizeBaseUrl(baseUrl);
  const domain = extractDomainFromUrl(normalizedUrl);
  return `Asta <noreply@${domain}>`;
}

function buildEmailVariables(
  userName: string | null,
  userEmail: string,
  propertyAddress: string | null,
  reportId: string,
  reportUrl: string
) {
  return {
    USER_NAME: userName || userEmail.split('@')[0],
    PROPERTY_ADDRESS: propertyAddress || 'N/A',
    REPORT_URL: reportUrl,
    REPORT_ID: reportId,
    USER_EMAIL: userEmail,
  };
}

export async function sendAnalysisCompleteEmail(
  userEmail: string,
  userName: string | null,
  reportId: string,
  propertyAddress: string | null
): Promise<EmailResponse> {
  const reportBaseUrl = config.report.baseUrl;
  const reportUrl = buildReportUrl(reportBaseUrl, reportId);
  const fromEmail = buildFromEmail(reportBaseUrl);
  const emailVariables = buildEmailVariables(
    userName,
    userEmail,
    propertyAddress,
    reportId,
    reportUrl
  );

  logger.info('Sending email with template variables', {
    reportId,
    userEmail,
    reportUrl,
    fromEmail,
    variables: emailVariables,
  });

  const emailRequest: EmailRequest = {
    from: fromEmail,
    to: userEmail,
    template: {
      id: 'analysis-complete',
      variables: emailVariables,
    },
  };

  const edgeFunctionUrl = `${config.supabase.url}/functions/v1/send-email`;

  try {
    const response = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.supabase.serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailRequest),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      const errorMessage = errorData.error || `HTTP ${response.status}: ${response.statusText}`;
      logger.error('Failed to send email', new Error(errorMessage), {
        reportId,
        userEmail,
        status: response.status,
      });
      throw new Error(errorMessage);
    }

    const result: EmailResponse = await response.json();
    logger.info('Analysis complete email sent', {
      reportId,
      userEmail,
      emailId: result.id,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Error sending analysis complete email', error, {
      reportId,
      userEmail,
    });
    throw new Error(`Failed to send email: ${errorMessage}`);
  }
}
