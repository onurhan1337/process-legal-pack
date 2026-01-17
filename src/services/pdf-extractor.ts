import mammoth from 'mammoth';
import { logger } from '../utils/logger';

const pdfParse = require('pdf-parse');

export interface ExtractedDocument {
  fileName: string;
  text: string;
  pages: number;
}

export async function extractPdfText(
  pdfBuffer: Buffer,
  fileName: string
): Promise<{ text: string; pages: number }> {
  try {
    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw new Error('PDF buffer is empty');
    }
    
    const pdfHeader = pdfBuffer.subarray(0, 4).toString();
    if (pdfHeader !== '%PDF') {
      logger.warn('Buffer does not appear to be a valid PDF', { fileName, header: pdfHeader });
    }
    
    const data = await pdfParse(pdfBuffer);
    const pageCount = data.numpages ?? data.numPages ?? 0;
    const extractedText = data.text || '';
    
    if (pageCount === 0 && extractedText && extractedText.trim().length > 0) {
      logger.warn('PDF page count is 0 but text exists', { 
        fileName, 
        textLength: extractedText.length,
        dataKeys: Object.keys(data),
        numpages: data.numpages,
        numPages: data.numPages
      });
      
      const wordCount = extractedText.trim().split(/\s+/).length;
      const estimatedPages = Math.max(1, Math.ceil(wordCount / 500));
      logger.info('Using estimated page count', { fileName, estimatedPages });
      
      return {
        text: extractedText.trim(),
        pages: estimatedPages,
      };
    }
    
    if (!extractedText || extractedText.trim().length === 0) {
      logger.warn('PDF has no extractable text', { fileName, pageCount });
      return {
        text: '',
        pages: pageCount,
      };
    }
    
    return {
      text: extractedText.trim(),
      pages: pageCount,
    };
  } catch (error) {
    logger.error('Error extracting PDF text', error, { fileName });
    throw new Error(`Failed to extract text from PDF ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function extractDocxText(
  docxBuffer: Buffer,
  fileName: string
): Promise<{ text: string; pages: number }> {
  try {
    const result = await mammoth.extractRawText({ buffer: docxBuffer });
    const text = result.value;
    const wordCount = text.split(/\s+/).length;
    const estimatedPages = Math.max(1, Math.ceil(wordCount / 500));
    
    return {
      text: text.trim(),
      pages: estimatedPages,
    };
  } catch (error) {
    logger.error('Error extracting DOCX text', error, { fileName });
    throw new Error(`Failed to extract text from DOCX ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function extractDocumentText(
  buffer: Buffer,
  fileName: string
): Promise<{ text: string; pages: number }> {
  const extension = fileName.toLowerCase().split('.').pop();
  
  switch (extension) {
    case 'pdf':
      return extractPdfText(buffer, fileName);
    case 'docx':
    case 'doc':
      return extractDocxText(buffer, fileName);
    default:
      throw new Error(`Unsupported file type: ${extension}`);
  }
}

export async function extractMultipleDocuments(
  documents: Array<{ buffer: Buffer; fileName: string }>
): Promise<ExtractedDocument[]> {
  const extractionPromises = documents.map(async (doc) => {
    try {
      const { text, pages } = await extractDocumentText(doc.buffer, doc.fileName);
      return {
        fileName: doc.fileName,
        text,
        pages,
      };
    } catch (error) {
      logger.error('Error extracting document', error, { fileName: doc.fileName });
      return {
        fileName: doc.fileName,
        text: `Error extracting text: ${error instanceof Error ? error.message : String(error)}`,
        pages: 0,
      };
    }
  });
  
  return Promise.all(extractionPromises);
}
