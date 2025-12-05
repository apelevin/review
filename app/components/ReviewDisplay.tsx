'use client';

import { useState } from 'react';
import CostStatistics from './CostStatistics';

interface StepCostStatistics {
  step: number;
  stepName: string;
  calls: number;
  tokens: {
    input: number;
    cachedInput: number;
    output: number;
    total: number;
  };
  cost: {
    input: number;
    cachedInput: number;
    output: number;
    total: number;
  };
}

interface CostStatistics {
  steps: StepCostStatistics[];
  total: {
    tokens: {
      input: number;
      cachedInput: number;
      output: number;
      total: number;
    };
    cost: {
      input: number;
      cachedInput: number;
      output: number;
      total: number;
    };
  };
}

interface ReviewDisplayProps {
  review: string;
  documents?: Array<{
    fileName: string;
    hasError: boolean;
    error?: string;
  }>;
  costStatistics?: CostStatistics;
}

export default function ReviewDisplay({ review, documents, costStatistics }: ReviewDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(review);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Ошибка при копировании:', err);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([review], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `обзор-судебной-практики-${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!review) {
    return null;
  }

  return (
    <div className="w-full mt-6 space-y-4">
      {costStatistics && <CostStatistics statistics={costStatistics} />}
      
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">Обзор судебной практики</h2>
        <div className="flex space-x-2">
          <button
            onClick={handleCopy}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
          >
            {copied ? 'Скопировано!' : 'Копировать'}
          </button>
          <button
            onClick={handleDownload}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
          >
            Скачать
          </button>
        </div>
      </div>

      {documents && documents.length > 0 && (
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="text-sm font-medium text-gray-700 mb-2">
            Обработанные документы:
          </h3>
          <ul className="space-y-1">
            {documents.map((doc, index) => (
              <li key={index} className="text-sm text-gray-600 flex items-center">
                {doc.hasError ? (
                  <>
                    <span className="text-red-500 mr-2">✗</span>
                    <span className="text-red-600">
                      {doc.fileName} - {doc.error}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-green-500 mr-2">✓</span>
                    <span>{doc.fileName}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="prose prose-sm max-w-none">
          <div
            className="text-gray-800 leading-relaxed"
            dangerouslySetInnerHTML={{
              __html: (() => {
                const lines = review.split('\n');
                let inList = false;
                let listType: 'ul' | 'ol' | null = null;
                const result: string[] = [];

                lines.forEach((line, index) => {
                  const trimmed = line.trim();
                  
                  // Заголовки
                  if (trimmed.startsWith('# ')) {
                    if (inList) {
                      result.push(`</${listType}>`);
                      inList = false;
                      listType = null;
                    }
                    result.push(`<h1 class="text-2xl font-bold mt-6 mb-4">${trimmed.substring(2)}</h1>`);
                    return;
                  }
                  if (trimmed.startsWith('## ')) {
                    if (inList) {
                      result.push(`</${listType}>`);
                      inList = false;
                      listType = null;
                    }
                    result.push(`<h2 class="text-xl font-bold mt-5 mb-3">${trimmed.substring(3)}</h2>`);
                    return;
                  }
                  if (trimmed.startsWith('### ')) {
                    if (inList) {
                      result.push(`</${listType}>`);
                      inList = false;
                      listType = null;
                    }
                    result.push(`<h3 class="text-lg font-semibold mt-4 mb-2">${trimmed.substring(4)}</h3>`);
                    return;
                  }

                  // Списки
                  if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
                    if (!inList || listType !== 'ul') {
                      if (inList && listType === 'ol') {
                        result.push('</ol>');
                      }
                      result.push('<ul class="list-disc list-inside mb-3 space-y-1 ml-4">');
                      inList = true;
                      listType = 'ul';
                    }
                    result.push(`<li>${trimmed.substring(2)}</li>`);
                    return;
                  }
                  
                  if (/^\d+\.\s/.test(trimmed)) {
                    if (!inList || listType !== 'ol') {
                      if (inList && listType === 'ul') {
                        result.push('</ul>');
                      }
                      result.push('<ol class="list-decimal list-inside mb-3 space-y-1 ml-4">');
                      inList = true;
                      listType = 'ol';
                    }
                    result.push(`<li>${trimmed.replace(/^\d+\.\s/, '')}</li>`);
                    return;
                  }

                  // Пустая строка
                  if (trimmed === '') {
                    if (inList) {
                      result.push(`</${listType}>`);
                      inList = false;
                      listType = null;
                    }
                    result.push('<br />');
                    return;
                  }

                  // Обычный текст
                  if (inList) {
                    result.push(`</${listType}>`);
                    inList = false;
                    listType = null;
                  }
                  result.push(`<p class="mb-3">${line}</p>`);
                });

                // Закрываем список, если он остался открытым
                if (inList && listType) {
                  result.push(`</${listType}>`);
                }

                return result.join('');
              })(),
            }}
          />
        </div>
      </div>
    </div>
  );
}

