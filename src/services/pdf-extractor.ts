import mammoth from 'mammoth';
import { logger } from '../utils/logger';

let pdfjsLib: typeof import('pdfjs-dist') | null = null;

async function getPdfjsLib() {
  if (!pdfjsLib) {
    pdfjsLib = await import('pdfjs-dist');
    if (typeof window === 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
    }
  }
  return pdfjsLib;
}

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
    const pdfjs = await getPdfjsLib();
    const loadingTask = pdfjs.getDocument({
      data: pdfBuffer,
      useSystemFonts: true,
    });
    
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    
    const pagePromises: Promise<string>[] = [];
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      pagePromises.push(
        pdf.getPage(pageNum).then(async (page) => {
          const textContent = await page.getTextContent();
          return textContent.items
            .map((item) => {
              if ('str' in item) {
                return item.str || '';
              }
              return '';
            })
            .join(' ');
        })
      );
    }
    
    const pageTexts = await Promise.all(pagePromises);
    const fullText = pageTexts.join('\n');
    
    return {
      text: fullText.trim(),
      pages: numPages,
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
