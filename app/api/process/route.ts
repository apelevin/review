import { NextRequest, NextResponse } from 'next/server';
import { processDocumentsPipeline } from '@/lib/pipeline';
import { readFile } from 'fs/promises';
import { join } from 'path';

export const maxDuration = 300; // 5 минут для обработки

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fileNames } = body;

    if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
      return NextResponse.json(
        { error: 'Не указаны файлы для обработки' },
        { status: 400 }
      );
    }

    // Читаем файлы из директории uploads
    const uploadsDir = join(process.cwd(), 'uploads');
    const files = await Promise.all(
      fileNames.map(async (fileName: string) => {
        try {
          const filePath = join(uploadsDir, fileName);
          const buffer = await readFile(filePath);
          return {
            fileName: fileName.replace(/^\d+-/, ''), // Убираем timestamp из имени
            buffer,
          };
        } catch (error) {
          throw new Error(
            `Не удалось прочитать файл ${fileName}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })
    );

    // Запускаем pipeline обработки
    // Для отслеживания прогресса можно использовать Server-Sent Events,
    // но для MVP используем простой подход
    const result = await processDocumentsPipeline(files);

    // Логируем детали ошибок для отладки
    if (result.error) {
      console.error('Pipeline error:', result.error);
      if (result.documents && result.documents.length > 0) {
        result.documents.forEach((doc, index) => {
          if (doc.error) {
            console.error(`Document ${index + 1} (${doc.fileName}) error:`, doc.error);
          }
        });
      }
    }

    if (result.error) {
      return NextResponse.json(
        { 
          error: result.error, 
          documents: result.documents.map((doc) => ({
            fileName: doc.fileName,
            hasError: !!doc.error,
            error: doc.error,
          })),
          costStatistics: result.costStatistics,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      documents: result.documents.map((doc) => ({
        fileName: doc.fileName,
        hasError: !!doc.error,
        error: doc.error,
      })),
      review: result.review,
      caseCards: result.caseCards,
      reviewSkeleton: result.reviewSkeleton,
      costStatistics: result.costStatistics,
    });
  } catch (error) {
    console.error('Ошибка при обработке документов:', error);
    return NextResponse.json(
      {
        error: 'Ошибка при обработке документов',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

