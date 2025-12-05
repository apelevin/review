import mammoth from 'mammoth';
import fs from 'fs/promises';
import path from 'path';

/**
 * Конвертирует DOCX файл в Markdown
 * @param filePath - путь к DOCX файлу
 * @returns Promise с содержимым в формате Markdown
 */
export async function convertDocxToMarkdown(filePath: string): Promise<string> {
  try {
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.convertToMarkdown({ buffer });
    
    if (result.messages.length > 0) {
      console.warn('Предупреждения при конвертации:', result.messages);
    }
    
    return result.value;
  } catch (error) {
    throw new Error(`Ошибка при конвертации DOCX в Markdown: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Конвертирует DOCX файл из буфера в Markdown
 * @param buffer - буфер с содержимым DOCX файла
 * @returns Promise с содержимым в формате Markdown
 */
export async function convertDocxBufferToMarkdown(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.convertToMarkdown({ buffer });
    
    if (result.messages.length > 0) {
      console.warn('Предупреждения при конвертации:', result.messages);
    }
    
    return result.value;
  } catch (error) {
    throw new Error(`Ошибка при конвертации DOCX буфера в Markdown: ${error instanceof Error ? error.message : String(error)}`);
  }
}


