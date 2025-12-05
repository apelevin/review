'use client';

interface StepCostStatistics {
  step: number;
  stepName: string;
  model?: string;
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

interface CostStatisticsProps {
  statistics: CostStatistics;
}

const formatNumber = (num: number | undefined | null): string => {
  if (num === undefined || num === null || isNaN(num)) {
    return '0';
  }
  if (num >= 1000) {
    return num.toLocaleString('ru-RU');
  }
  return num.toFixed(0);
};

const formatCost = (cost: number | undefined | null): string => {
  if (cost === undefined || cost === null || isNaN(cost)) {
    return '$0.00';
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
};

export default function CostStatistics({ statistics }: CostStatisticsProps) {
  if (!statistics || !statistics.steps || statistics.steps.length === 0) {
    return null;
  }

  // Защита от undefined значений
  const safeStatistics = {
    ...statistics,
    steps: statistics.steps.map((step) => ({
      ...step,
      cost: {
        input: step.cost?.input ?? 0,
        cachedInput: step.cost?.cachedInput ?? 0,
        output: step.cost?.output ?? 0,
        total: step.cost?.total ?? 0,
      },
      tokens: {
        input: step.tokens?.input ?? 0,
        cachedInput: step.tokens?.cachedInput ?? 0,
        output: step.tokens?.output ?? 0,
        total: step.tokens?.total ?? 0,
      },
    })),
    total: {
      tokens: {
        input: statistics.total?.tokens?.input ?? 0,
        cachedInput: statistics.total?.tokens?.cachedInput ?? 0,
        output: statistics.total?.tokens?.output ?? 0,
        total: statistics.total?.tokens?.total ?? 0,
      },
      cost: {
        input: statistics.total?.cost?.input ?? 0,
        cachedInput: statistics.total?.cost?.cachedInput ?? 0,
        output: statistics.total?.cost?.output ?? 0,
        total: statistics.total?.cost?.total ?? 0,
      },
    },
  };

  return (
    <div className="w-full mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Статистика расходов
      </h3>

      <div className="space-y-4">
        {/* Детали по каждому шагу */}
        <div className="space-y-2">
          {safeStatistics.steps.map((step) => (
            <div
              key={step.step}
              className="p-3 bg-white border border-gray-200 rounded-lg"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="text-sm font-medium text-gray-800">
                    Шаг {step.step}: {step.stepName}
                  </h4>
                  {step.model && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      Модель: {step.model}
                    </p>
                  )}
                </div>
                <span className="text-sm font-semibold text-blue-600">
                  {formatCost(step.cost.total)}
                </span>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-600">
                <div>
                  <span className="font-medium">Вызовов:</span> {step.calls}
                </div>
                <div>
                  <span className="font-medium">Input:</span>{' '}
                  {formatNumber(step.tokens.input)} токенов
                </div>
                {step.tokens.cachedInput > 0 && (
                  <div>
                    <span className="font-medium">Cached:</span>{' '}
                    {formatNumber(step.tokens.cachedInput)} токенов
                  </div>
                )}
                <div>
                  <span className="font-medium">Output:</span>{' '}
                  {formatNumber(step.tokens.output)} токенов
                </div>
              </div>

              <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div>
                  <span className="text-gray-500">Input:</span>{' '}
                  <span className="font-medium">{formatCost(step.cost.input)}</span>
                </div>
                {step.cost.cachedInput > 0 && (
                  <div>
                    <span className="text-gray-500">Cached:</span>{' '}
                    <span className="font-medium">
                      {formatCost(step.cost.cachedInput)}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-gray-500">Output:</span>{' '}
                  <span className="font-medium">{formatCost(step.cost.output)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Итого:</span>{' '}
                  <span className="font-semibold text-blue-600">
                    {formatCost(step.cost.total)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Общая статистика */}
        <div className="p-4 bg-blue-50 border-2 border-blue-200 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-base font-semibold text-gray-900">Общие расходы</h4>
            <span className="text-xl font-bold text-blue-600">
              {formatCost(safeStatistics.total.cost.total)}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-gray-600 mb-1">Всего токенов</div>
              <div className="font-semibold text-gray-900">
                {formatNumber(safeStatistics.total.tokens.total)}
              </div>
            </div>
            <div>
              <div className="text-gray-600 mb-1">Input токенов</div>
              <div className="font-semibold text-gray-900">
                {formatNumber(safeStatistics.total.tokens.input)}
              </div>
              <div className="text-xs text-gray-500">
                {formatCost(safeStatistics.total.cost.input)}
              </div>
            </div>
            {safeStatistics.total.tokens.cachedInput > 0 && (
              <div>
                <div className="text-gray-600 mb-1">Cached токенов</div>
                <div className="font-semibold text-gray-900">
                  {formatNumber(safeStatistics.total.tokens.cachedInput)}
                </div>
                <div className="text-xs text-gray-500">
                  {formatCost(safeStatistics.total.cost.cachedInput)}
                </div>
              </div>
            )}
            <div>
              <div className="text-gray-600 mb-1">Output токенов</div>
              <div className="font-semibold text-gray-900">
                {formatNumber(safeStatistics.total.tokens.output)}
              </div>
              <div className="text-xs text-gray-500">
                {formatCost(safeStatistics.total.cost.output)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

