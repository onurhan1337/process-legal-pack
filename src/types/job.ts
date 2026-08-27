export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ProcessingJob {
  jobId: string;
  reportId: string;
  userId: string;
  url?: string;
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
  consumedCredit?: 'trial' | 'usage';
}

export interface ProcessRequest {
  reportId: string;
  userId: string;
  url?: string;
}

export interface ProcessResponse {
  jobId: string;
  status: JobStatus;
  message: string;
}
