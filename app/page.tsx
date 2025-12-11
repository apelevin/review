'use client';

import { useState } from 'react';
import DocumentUpload from './components/DocumentUpload';
import ProcessingStatus from './components/ProcessingStatus';
import ReviewDisplay from './components/ReviewDisplay';

interface ProcessedDocument {
  fileName: string;
  hasError: boolean;
  error?: string;
}

export default function Home() {
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [review, setReview] = useState<string>('');
  const [documents, setDocuments] = useState<ProcessedDocument[]>([]);
  const [costStatistics, setCostStatistics] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ 
    step: 0, 
    current: 0, 
    total: 0, 
    message: '' 
  });

  const handleUploadComplete = async (fileNames: string[]) => {
    setUploadedFiles(fileNames);
    setError(null);
    setReview('');
    setDocuments([]);

    // Автоматически запускаем обработку после загрузки
    if (fileNames.length > 0) {
      await handleProcess(fileNames);
    }
  };

  const handleProcess = async (fileNames: string[]) => {
    setIsProcessing(true);
    setError(null);
    setProgress({ step: 0, current: 0, total: fileNames.length, message: 'Начало обработки...' });

    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileNames }),
      });

      const data = await response.json();

      // Всегда устанавливаем документы, даже если есть ошибка, чтобы показать детали
      if (data.documents && Array.isArray(data.documents)) {
        setDocuments(data.documents);
      }
      
      if (data.costStatistics) {
        setCostStatistics(data.costStatistics);
      }

      if (!response.ok) {
        // Если есть документы с ошибками, показываем их
        const errorMessage = data.error || 'Ошибка при обработке документов';
        setError(errorMessage);
        setProgress({ step: 4, current: 1, total: 1, message: 'Обработка завершена с ошибками' });
        return;
      }

      setReview(data.review || '');
      setProgress({ step: 4, current: 1, total: 1, message: 'Обработка завершена' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка при обработке документов');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = () => {
    setUploadedFiles([]);
    setReview('');
    setDocuments([]);
    setCostStatistics(null);
    setError(null);
    setProgress({ step: 0, current: 0, total: 0, message: '' });
  };

  return (
    <main className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-sm p-6 md:p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Обзор судебной практики
            </h1>
            <p className="text-gray-600">
              Загрузите документы в формате DOCX для автоматического создания обзора
            </p>
          </div>

          {!review && (
            <DocumentUpload
              onUploadComplete={handleUploadComplete}
              disabled={isProcessing}
            />
          )}

          <ProcessingStatus
            isProcessing={isProcessing}
            currentStep={progress.step}
            stepMessage={progress.message}
            progress={progress.current}
            total={progress.total}
            error={error}
          />

          {(review || (documents.length > 0 && !isProcessing)) && (
            <>
              {review && (
                <ReviewDisplay review={review} documents={documents} costStatistics={costStatistics} />
              )}
              {!review && documents.length > 0 && (
                <div className="w-full mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <h3 className="text-lg font-semibold text-red-900 mb-3">
                    Обработанные документы:
                  </h3>
                  <ul className="space-y-2">
                    {documents.map((doc, index) => (
                      <li key={index} className="text-sm flex items-start">
                        {doc.hasError ? (
                          <>
                            <span className="text-red-500 mr-2 mt-0.5">✗</span>
                            <div className="flex-1">
                              <span className="font-medium text-red-700">{doc.fileName}</span>
                              {doc.error && (
                                <div className="text-red-600 mt-1 ml-4 text-xs">
                                  {doc.error}
                                </div>
                              )}
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="text-green-500 mr-2 mt-0.5">✓</span>
                            <span className="text-gray-700">{doc.fileName}</span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-6">
                <button
                  onClick={handleReset}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  Загрузить новые документы
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
