interface LogContext {
  jobId?: string;
  reportId?: string;
  userId?: string;
  [key: string]: unknown;
}

export const logger = {
  info: (message: string, context?: LogContext): void => {
    console.log(JSON.stringify({
      level: 'info',
      message,
      timestamp: new Date().toISOString(),
      ...context,
    }));
  },
  
  error: (message: string, error?: Error | unknown, context?: LogContext): void => {
    const errorDetails = error instanceof Error
      ? {
          error: error.message,
          stack: error.stack,
        }
      : { error: String(error) };
    
    console.error(JSON.stringify({
      level: 'error',
      message,
      timestamp: new Date().toISOString(),
      ...errorDetails,
      ...context,
    }));
  },
  
  warn: (message: string, error?: Error | unknown, context?: LogContext): void => {
    const errorDetails = error instanceof Error
      ? {
          error: error.message,
          stack: error.stack,
        }
      : error ? { error: String(error) } : {};
    console.warn(JSON.stringify({
      level: 'warn',
      message,
      timestamp: new Date().toISOString(),
      ...errorDetails,
      ...context,
    }));
  },
  
  debug: (message: string, context?: LogContext): void => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(JSON.stringify({
        level: 'debug',
        message,
        timestamp: new Date().toISOString(),
        ...context,
      }));
    }
  },
};
