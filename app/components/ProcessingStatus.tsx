'use client';

interface ProcessingStatusProps {
  isProcessing: boolean;
  currentStep?: number; // 0, 1, 2, 3, 4
  stepMessage?: string;
  progress?: number;
  total?: number;
  error?: string | null;
}

const stepNames = [
  'Извлечение правовых позиций',
  'Создание карточек дел',
  'Группировка карточек',
  'Создание скелета обзора',
  'Генерация финального обзора',
];

export default function ProcessingStatus({
  isProcessing,
  currentStep,
  stepMessage,
  progress = 0,
  total = 0,
  error,
}: ProcessingStatusProps) {
  if (!isProcessing && !error) {
    return null;
  }

  const percentage = total > 0 ? Math.round((progress / total) * 100) : 0;
  const currentStepName = currentStep !== undefined ? stepNames[currentStep] : undefined;

  return (
    <div className="w-full mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
      {isProcessing && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-blue-900">
              {currentStepName || 'Обработка документов...'}
            </h3>
            {total > 0 && (
              <span className="text-sm text-blue-700">
                {progress} / {total}
              </span>
            )}
          </div>
          
          {stepMessage && (
            <p className="text-sm text-blue-800">{stepMessage}</p>
          )}

          {currentStep !== undefined && (
            <div className="flex space-x-2 text-xs text-blue-600">
              {stepNames.map((name, index) => (
                <span
                  key={index}
                  className={`px-2 py-1 rounded ${
                    index === currentStep
                      ? 'bg-blue-200 font-semibold'
                      : index < currentStep
                      ? 'bg-blue-100 line-through'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {index + 1}. {name}
                </span>
              ))}
            </div>
          )}

          <div className="w-full bg-blue-200 rounded-full h-2.5">
            <div
              className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>

          <div className="flex items-center space-x-2 text-sm text-blue-700">
            <svg
              className="animate-spin h-4 w-4"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            <span>Обработка может занять несколько минут...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          <strong>Ошибка:</strong> {error}
        </div>
      )}
    </div>
  );
}

