import { convertDocxBufferToMarkdown } from './docx-to-markdown';
import { callOpenAI, loadPrompt, loadPromptWithParts, TokenUsage, CostBreakdown } from './llm-client';
import fs from 'fs/promises';
import path from 'path';

export interface LegalPosition {
  level1?: {
    branch?: string;
    dispute_category?: string;
    case_number?: string; // Номер дела из судебного акта
  };
  level2?: {
    parties?: string;
    relationship_type?: string;
  };
  level3?: {
    claims_main?: string;
    claims_secondary?: string[];
  };
  level4?: {
    norms_key?: string[];
    norms_secondary?: string[];
  };
  level5?: {
    facts_key?: string[];
    facts_controversial?: string[];
  };
  level6?: {
    reasoning_steps?: string[];
    interpretation_features?: string[];
  };
  level7?: {
    holding_short?: string;
    applicability_scope?: string;
    result?: string;
  };
  level8?: {
    risks_direct?: string[];
  };
  level9?: {
    risks_analogical?: string[];
  };
  level10?: {
    risks_operational?: string[];
  };
}

export interface CaseCard {
  caseNumber?: string; // Номер дела для цитирования
  summary: string; // Краткая фабула и предмет спора (1-2 строки)
  keyFindings: string[]; // Ключевые правовые выводы (3-5 буллетов)
  appliedNorms: string; // Применённые нормы (1-2 строки)
  result: string; // Результат (исковое требование удовлетворено/отказано/частично)
}

export interface ReviewSkeleton {
  legalQuestion: string; // Правовой вопрос
  normativeBase: string[]; // Нормативная база
  approaches: Array<{
    name: string; // Название подхода
    description: string; // Суть подхода
    applicableFacts: string; // При каких фактах применяется
    caseIndices: number[]; // Индексы дел, которые иллюстрируют подход
  }>;
  discrepancies: {
    normInterpretation?: string; // Расхождения в толковании нормы
    evidenceRequirements?: string; // Расхождения в требованиях к доказательствам
    factAssessment?: string; // Расхождения в оценке фактов
  };
  trends: {
    dominantApproach?: string; // Какой подход доминирует
    timeShifts?: string; // Есть ли сдвиги во времени
    higherCourts?: string; // Роль верховных судов
  };
}

export interface DocumentProcessingResult {
  fileName: string;
  caseNumber?: string; // Номер дела, извлеченный из документа
  markdown: string;
  legalPosition: string; // JSON строка (10 уровней)
  legalPositionParsed?: LegalPosition; // Распарсенный JSON (10 уровней)
  caseCard?: CaseCard; // Карточка дела (шаг 1)
  caseCardRaw?: string; // JSON строка карточки
  error?: string;
}

export interface StepCostStatistics {
  step: number;
  stepName: string;
  model?: string; // Модель, используемая на этом шаге
  calls: number; // Количество вызовов API на этом шаге
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

export interface CostStatistics {
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

export interface PipelineResult {
  documents: DocumentProcessingResult[];
  caseCards: CaseCard[]; // Все карточки дел
  reviewSkeleton?: ReviewSkeleton; // Скелет обзора (шаг 3)
  review: string; // Финальный обзор (шаг 4)
  costStatistics?: CostStatistics; // Статистика расходов
  error?: string;
}

/**
 * Шаг 0: Преобразование документа в правовую позицию (10 уровней)
 * @param fileName - имя файла
 * @param buffer - буфер с содержимым DOCX файла
 * @returns Promise с результатом обработки документа и статистикой расходов
 */
async function processDocumentStep0(
  fileName: string,
  buffer: Buffer
): Promise<{ result: DocumentProcessingResult; cost: CostBreakdown; usage: TokenUsage }> {
  try {
    // Конвертируем DOCX в Markdown
    const markdown = await convertDocxBufferToMarkdown(buffer);

    // Загружаем промпт для шага 0 (с разделением на SYSTEM и USER)
    const { systemPrompt, userPrompt } = await loadPromptWithParts('prompts/step0-prompt.md');
    
    // Объединяем USER промпт с содержимым документа
    const userContent = userPrompt ? `${userPrompt}\n\n${markdown}` : markdown;

    // Отправляем в LLM для получения правовой позиции (JSON)
    const apiResponse = await callOpenAI(systemPrompt, userContent, 'x-ai/grok-4.1-fast');
    const legalPositionRaw = apiResponse.content;

    // Извлекаем JSON из ответа (убираем возможные markdown кодблоки и лишний текст)
    let legalPositionJson = legalPositionRaw.trim();
    
    // Убираем markdown кодблоки, если они есть
    if (legalPositionJson.includes('```json')) {
      const jsonMatch = legalPositionJson.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        legalPositionJson = jsonMatch[1].trim();
      } else {
        legalPositionJson = legalPositionJson.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
      }
    } else if (legalPositionJson.includes('```')) {
      const codeMatch = legalPositionJson.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch) {
        legalPositionJson = codeMatch[1].trim();
      } else {
        legalPositionJson = legalPositionJson.replace(/^```\s*/i, '').replace(/\s*```$/i, '');
      }
    }
    
    // Пытаемся найти JSON объект в тексте (начинается с { и заканчивается })
    const jsonObjectMatch = legalPositionJson.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      legalPositionJson = jsonObjectMatch[0];
    }

    // Парсим и валидируем JSON
    let legalPositionParsed: LegalPosition;
    try {
      legalPositionParsed = JSON.parse(legalPositionJson) as LegalPosition;
      
      // Базовая валидация структуры
      if (!legalPositionParsed || typeof legalPositionParsed !== 'object') {
        throw new Error('JSON не является объектом');
      }
    } catch (parseError) {
      const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
      console.error('Ошибка парсинга JSON:', errorMessage);
      console.error('Полученный текст:', legalPositionJson.substring(0, 500));
      throw new Error(
        `Не удалось распарсить JSON из ответа LLM: ${errorMessage}. Первые 500 символов ответа: ${legalPositionJson.substring(0, 500)}`
      );
    }

    // Извлекаем номер дела из правовой позиции
    const caseNumber = legalPositionParsed?.level1?.case_number || '';

    return {
      result: {
        fileName,
        caseNumber,
        markdown,
        legalPosition: legalPositionJson, // Сохраняем оригинальную JSON строку
        legalPositionParsed, // Сохраняем распарсенный объект
      },
      cost: apiResponse.cost,
      usage: apiResponse.usage,
    };
  } catch (error) {
    return {
      result: {
        fileName,
        markdown: '',
        legalPosition: '',
        error: error instanceof Error ? error.message : String(error),
      },
      cost: { inputCost: 0, cachedInputCost: 0, outputCost: 0, totalCost: 0 },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
}

/**
 * Шаг 1: Сжатие 10-уровневой позиции в карточку дела
 * @param document - документ с 10-уровневой позицией
 * @returns Promise с обновленным документом, содержащим карточку, и статистикой расходов
 */
async function processStep1(
  document: DocumentProcessingResult
): Promise<{ result: DocumentProcessingResult; cost: CostBreakdown; usage: TokenUsage }> {
  if (!document.legalPositionParsed) {
    return {
      result: { ...document, error: 'Нет правовой позиции для создания карточки' },
      cost: { inputCost: 0, cachedInputCost: 0, outputCost: 0, totalCost: 0 },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  try {
    // Загружаем промпт для шага 1
    const { systemPrompt, userPrompt } = await loadPromptWithParts('prompts/step1-prompt.md');
    
    // Форматируем 10-уровневую позицию для передачи в LLM
    const positionJson = JSON.stringify(document.legalPositionParsed, null, 2);
    const userContent = userPrompt ? `${userPrompt}\n\n\`\`\`json\n${positionJson}\n\`\`\`` : positionJson;

    // Отправляем в LLM для создания карточки дела
    const apiResponse = await callOpenAI(systemPrompt, userContent, 'google/gemini-2.5-flash-lite-preview-09-2025');
    const caseCardRaw = apiResponse.content;

    // Извлекаем JSON из ответа
    let caseCardJson = caseCardRaw.trim();
    if (caseCardJson.includes('```json')) {
      const jsonMatch = caseCardJson.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        caseCardJson = jsonMatch[1].trim();
      }
    } else if (caseCardJson.includes('```')) {
      const codeMatch = caseCardJson.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch) {
        caseCardJson = codeMatch[1].trim();
      }
    }
    
    const jsonObjectMatch = caseCardJson.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      caseCardJson = jsonObjectMatch[0];
    }

    // Парсим карточку дела
    const caseCard = JSON.parse(caseCardJson) as CaseCard;
    
    // Убеждаемся, что номер дела передан в карточку
    if (!caseCard.caseNumber && document.caseNumber) {
      caseCard.caseNumber = document.caseNumber;
    }

    return {
      result: {
        ...document,
        caseCard,
        caseCardRaw: caseCardJson,
      },
      cost: apiResponse.cost,
      usage: apiResponse.usage,
    };
  } catch (error) {
    return {
      result: {
        ...document,
        error: `Ошибка при создании карточки дела: ${error instanceof Error ? error.message : String(error)}`,
      },
      cost: { inputCost: 0, cachedInputCost: 0, outputCost: 0, totalCost: 0 },
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }
}

/**
 * Шаг 2: Группировка карточек (формальный шаг - все в один кластер)
 * @param caseCards - массив карточек дел
 * @returns Promise с массивом карточек (без изменений, т.к. формальный шаг)
 */
async function processStep2(caseCards: CaseCard[]): Promise<CaseCard[]> {
  // Формальный шаг - просто возвращаем все карточки как один кластер
  return caseCards;
}

/**
 * Шаг 3: Агрегация карточек в скелет обзора
 * @param caseCards - массив карточек дел
 * @param documents - исходные документы для привязки
 * @returns Promise со скелетом обзора и статистикой расходов
 */
async function processStep3(
  caseCards: CaseCard[],
  documents: DocumentProcessingResult[]
): Promise<{ skeleton: ReviewSkeleton; cost: CostBreakdown; usage: TokenUsage }> {
  if (caseCards.length === 0) {
    throw new Error('Нет карточек для создания скелета обзора');
  }

  try {
    // Загружаем промпт для шага 3
    const { systemPrompt, userPrompt } = await loadPromptWithParts('prompts/step3-prompt.md');
    
    // Форматируем карточки для передачи в LLM
    const cardsData = caseCards.map((card, index) => ({
      index: index + 1,
      fileName: documents[index]?.fileName || `Документ ${index + 1}`,
      caseNumber: documents[index]?.caseNumber || card.caseNumber || '',
      ...card,
    }));
    
    const cardsJson = JSON.stringify(cardsData, null, 2);
    const userContent = userPrompt ? `${userPrompt}\n\n\`\`\`json\n${cardsJson}\n\`\`\`` : cardsJson;

    // Отправляем в LLM для создания скелета
    const apiResponse = await callOpenAI(systemPrompt, userContent, 'deepseek/deepseek-v3.2');
    const skeletonRaw = apiResponse.content;

    // Извлекаем JSON из ответа
    let skeletonJson = skeletonRaw.trim();
    if (skeletonJson.includes('```json')) {
      const jsonMatch = skeletonJson.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        skeletonJson = jsonMatch[1].trim();
      }
    } else if (skeletonJson.includes('```')) {
      const codeMatch = skeletonJson.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch) {
        skeletonJson = codeMatch[1].trim();
      }
    }
    
    const jsonObjectMatch = skeletonJson.match(/\{[\s\S]*\}/);
    if (jsonObjectMatch) {
      skeletonJson = jsonObjectMatch[0];
    }

    // Парсим скелет обзора
    const skeleton = JSON.parse(skeletonJson) as ReviewSkeleton;

    return {
      skeleton,
      cost: apiResponse.cost,
      usage: apiResponse.usage,
    };
  } catch (error) {
    throw new Error(
      `Ошибка при создании скелета обзора: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Шаг 4: Генерация финального обзора из скелета
 * @param skeleton - скелет обзора
 * @param caseCards - карточки дел для контекста
 * @param documents - исходные документы
 * @returns Promise с финальным обзором и статистикой расходов
 */
async function processStep4(
  skeleton: ReviewSkeleton,
  caseCards: CaseCard[],
  documents: DocumentProcessingResult[]
): Promise<{ review: string; cost: CostBreakdown; usage: TokenUsage }> {
  try {
    // Загружаем промпт для шага 4
    const { systemPrompt, userPrompt } = await loadPromptWithParts('prompts/step4-prompt.md');
    
    // Форматируем данные для передачи в LLM
    const skeletonJson = JSON.stringify(skeleton, null, 2);
    const cardsContext = caseCards.map((card, index) => ({
      index: index + 1,
      fileName: documents[index]?.fileName || `Документ ${index + 1}`,
      caseNumber: documents[index]?.caseNumber || card.caseNumber || '',
      ...card,
    }));
    const cardsJson = JSON.stringify(cardsContext, null, 2);
    
    const userContent = userPrompt
      ? `${userPrompt}\n\n## Скелет обзора:\n\`\`\`json\n${skeletonJson}\n\`\`\`\n\n## Карточки дел:\n\`\`\`json\n${cardsJson}\n\`\`\``
      : `Скелет обзора:\n${skeletonJson}\n\nКарточки дел:\n${cardsJson}`;

    // Отправляем в LLM для создания финального обзора
    const apiResponse = await callOpenAI(systemPrompt, userContent, 'google/gemini-2.5-flash-preview-09-2025');
    const review = apiResponse.content;

    return {
      review,
      cost: apiResponse.cost,
      usage: apiResponse.usage,
    };
  } catch (error) {
    throw new Error(
      `Ошибка при создании финального обзора: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Полный pipeline обработки документов
 * @param files - массив объектов с именем файла и буфером
 * @param onProgress - callback для отслеживания прогресса
 * @returns Promise с результатом обработки
 */
export async function processDocumentsPipeline(
  files: Array<{ fileName: string; buffer: Buffer }>,
  onProgress?: (step: number, current: number, total: number, message: string) => void
): Promise<PipelineResult> {
  const costStatistics: CostStatistics = {
    steps: [],
    total: {
      tokens: { input: 0, cachedInput: 0, output: 0, total: 0 },
      cost: { input: 0, cachedInput: 0, output: 0, total: 0 },
    },
  };

  try {
    // Шаг 0: Обрабатываем все документы параллельно - извлекаем 10-уровневые позиции
    if (onProgress) {
      onProgress(0, 0, files.length, 'Извлечение правовых позиций...');
    }
    
    const step0Promises = files.map((file, index) => {
      if (onProgress) {
        onProgress(0, index + 1, files.length, `Обработка ${file.fileName}...`);
      }
      return processDocumentStep0(file.fileName, file.buffer);
    });

    const step0Results = await Promise.all(step0Promises);
    const documents = step0Results.map((r) => r.result);

    // Собираем статистику шага 0
    const step0Stats: StepCostStatistics = {
      step: 0,
      stepName: 'Извлечение правовых позиций',
      model: 'x-ai/grok-4.1-fast',
      calls: step0Results.length,
      tokens: { input: 0, cachedInput: 0, output: 0, total: 0 },
      cost: { input: 0, cachedInput: 0, output: 0, total: 0 },
    };

    step0Results.forEach((r) => {
      const usage = r.usage || { promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0 };
      const cost = r.cost || { inputCost: 0, cachedInputCost: 0, outputCost: 0, totalCost: 0 };
      
      const inputTokens = (usage.promptTokens || 0) - (usage.cachedTokens || 0);
      const cachedInputTokens = usage.cachedTokens || 0;
      step0Stats.tokens.input += inputTokens;
      step0Stats.tokens.cachedInput += cachedInputTokens;
      step0Stats.tokens.output += usage.completionTokens || 0;
      step0Stats.tokens.total += usage.totalTokens || 0;
      step0Stats.cost.input += cost.inputCost || 0;
      step0Stats.cost.cachedInput += cost.cachedInputCost || 0;
      step0Stats.cost.output += cost.outputCost || 0;
      step0Stats.cost.total += cost.totalCost || 0;
    });

    costStatistics.steps.push(step0Stats);

    // Проверяем, есть ли хотя бы один успешный документ
    const hasValidDocuments = documents.some((doc) => !doc.error && doc.legalPositionParsed);
    if (!hasValidDocuments) {
      return {
        documents,
        caseCards: [],
        review: '',
        costStatistics: {
          steps: [step0Stats],
          total: {
            tokens: {
              input: step0Stats.tokens.input,
              cachedInput: step0Stats.tokens.cachedInput,
              output: step0Stats.tokens.output,
              total: step0Stats.tokens.total,
            },
            cost: step0Stats.cost,
          },
        },
        error: 'Все документы обработаны с ошибками',
      };
    }

    // Шаг 1: Создаем карточки дел из 10-уровневых позиций
    if (onProgress) {
      onProgress(1, 0, documents.length, 'Создание карточек дел...');
    }
    
    const step1Promises = documents
      .filter((doc) => !doc.error && doc.legalPositionParsed)
      .map((doc, index) => {
        if (onProgress) {
          onProgress(1, index + 1, documents.length, `Карточка для ${doc.fileName}...`);
        }
        return processStep1(doc);
      });

    const step1Results = await Promise.all(step1Promises);
    const documentsWithCards = step1Results.map((r) => r.result);
    
    // Обновляем исходные документы с карточками
    const updatedDocuments = documents.map((doc) => {
      const withCard = documentsWithCards.find((d) => d.fileName === doc.fileName);
      return withCard || doc;
    });

    // Собираем статистику шага 1
    const step1Stats: StepCostStatistics = {
      step: 1,
      stepName: 'Создание карточек дел',
      model: 'google/gemini-2.5-flash-lite-preview-09-2025',
      calls: step1Results.length,
      tokens: { input: 0, cachedInput: 0, output: 0, total: 0 },
      cost: { input: 0, cachedInput: 0, output: 0, total: 0 },
    };

    step1Results.forEach((r) => {
      const usage = r.usage || { promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0 };
      const cost = r.cost || { inputCost: 0, cachedInputCost: 0, outputCost: 0, totalCost: 0 };
      
      const inputTokens = (usage.promptTokens || 0) - (usage.cachedTokens || 0);
      const cachedInputTokens = usage.cachedTokens || 0;
      step1Stats.tokens.input += inputTokens;
      step1Stats.tokens.cachedInput += cachedInputTokens;
      step1Stats.tokens.output += usage.completionTokens || 0;
      step1Stats.tokens.total += usage.totalTokens || 0;
      step1Stats.cost.input += cost.inputCost || 0;
      step1Stats.cost.cachedInput += cost.cachedInputCost || 0;
      step1Stats.cost.output += cost.outputCost || 0;
      step1Stats.cost.total += cost.totalCost || 0;
    });

    costStatistics.steps.push(step1Stats);

    const caseCards = updatedDocuments
      .filter((doc) => doc.caseCard)
      .map((doc) => doc.caseCard!);

    if (caseCards.length === 0) {
      return {
        documents: updatedDocuments,
        caseCards: [],
        review: '',
        costStatistics: {
          steps: costStatistics.steps,
          total: {
            tokens: {
              input: step0Stats.tokens.input + step1Stats.tokens.input,
              cachedInput: step0Stats.tokens.cachedInput + step1Stats.tokens.cachedInput,
              output: step0Stats.tokens.output + step1Stats.tokens.output,
              total: step0Stats.tokens.total + step1Stats.tokens.total,
            },
            cost: {
              input: step0Stats.cost.input + step1Stats.cost.input,
              cachedInput: step0Stats.cost.cachedInput + step1Stats.cost.cachedInput,
              output: step0Stats.cost.output + step1Stats.cost.output,
              total: step0Stats.cost.total + step1Stats.cost.total,
            },
          },
        },
        error: 'Не удалось создать карточки дел',
      };
    }

    // Шаг 2: Группировка (формальный шаг)
    if (onProgress) {
      onProgress(2, 1, 1, 'Группировка карточек...');
    }
    const groupedCards = await processStep2(caseCards);

    // Шаг 3: Агрегация в скелет обзора
    if (onProgress) {
      onProgress(3, 1, 1, 'Создание скелета обзора...');
    }
    const step3Result = await processStep3(groupedCards, updatedDocuments);
    const skeleton = step3Result.skeleton;

    // Собираем статистику шага 3
    const step3Usage = step3Result.usage || { promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0 };
    const step3Cost = step3Result.cost || { inputCost: 0, cachedInputCost: 0, outputCost: 0, totalCost: 0 };
    
    const step3Stats: StepCostStatistics = {
      step: 3,
      stepName: 'Создание скелета обзора',
      model: 'deepseek/deepseek-v3.2',
      calls: 1,
      tokens: {
        input: (step3Usage.promptTokens || 0) - (step3Usage.cachedTokens || 0),
        cachedInput: step3Usage.cachedTokens || 0,
        output: step3Usage.completionTokens || 0,
        total: step3Usage.totalTokens || 0,
      },
      cost: {
        input: step3Cost.inputCost || 0,
        cachedInput: step3Cost.cachedInputCost || 0,
        output: step3Cost.outputCost || 0,
        total: step3Cost.totalCost || 0,
      },
    };
    costStatistics.steps.push(step3Stats);

    // Шаг 4: Генерация финального обзора
    if (onProgress) {
      onProgress(4, 1, 1, 'Генерация финального обзора...');
    }
    const step4Result = await processStep4(skeleton, groupedCards, updatedDocuments);
    const review = step4Result.review;

    // Собираем статистику шага 4
    const step4Usage = step4Result.usage || { promptTokens: 0, completionTokens: 0, cachedTokens: 0, totalTokens: 0 };
    const step4Cost = step4Result.cost || { inputCost: 0, cachedInputCost: 0, outputCost: 0, totalCost: 0 };
    
    const step4Stats: StepCostStatistics = {
      step: 4,
      stepName: 'Генерация финального обзора',
      model: 'google/gemini-2.5-flash-preview-09-2025',
      calls: 1,
      tokens: {
        input: (step4Usage.promptTokens || 0) - (step4Usage.cachedTokens || 0),
        cachedInput: step4Usage.cachedTokens || 0,
        output: step4Usage.completionTokens || 0,
        total: step4Usage.totalTokens || 0,
      },
      cost: {
        input: step4Cost.inputCost || 0,
        cachedInput: step4Cost.cachedInputCost || 0,
        output: step4Cost.outputCost || 0,
        total: step4Cost.totalCost || 0,
      },
    };
    costStatistics.steps.push(step4Stats);

    // Вычисляем общую статистику
    costStatistics.steps.forEach((step) => {
      costStatistics.total.tokens.input += step.tokens.input;
      costStatistics.total.tokens.cachedInput += step.tokens.cachedInput;
      costStatistics.total.tokens.output += step.tokens.output;
      costStatistics.total.tokens.total += step.tokens.total;
      costStatistics.total.cost.input += step.cost.input;
      costStatistics.total.cost.cachedInput += step.cost.cachedInput;
      costStatistics.total.cost.output += step.cost.output;
      costStatistics.total.cost.total += step.cost.total;
    });

    // Сохраняем результаты
    await saveResults(updatedDocuments, skeleton, review);

    return {
      documents: updatedDocuments,
      caseCards: groupedCards,
      reviewSkeleton: skeleton,
      review,
      costStatistics,
    };
  } catch (error) {
    return {
      documents: [],
      caseCards: [],
      review: '',
      costStatistics: {
        steps: [],
        total: {
          tokens: { input: 0, cachedInput: 0, output: 0, total: 0 },
          cost: { input: 0, cachedInput: 0, output: 0, total: 0 },
        },
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Сохраняет результаты обработки в файлы
 */
async function saveResults(
  documents: DocumentProcessingResult[],
  skeleton: ReviewSkeleton,
  review: string
): Promise<void> {
  const processedDir = path.join(process.cwd(), 'processed');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const sessionDir = path.join(processedDir, timestamp);

  await fs.mkdir(sessionDir, { recursive: true });

  // Сохраняем каждый документ
  for (const doc of documents) {
    if (doc.error) continue;

    const docDir = path.join(sessionDir, doc.fileName.replace(/\.docx?$/i, ''));
    await fs.mkdir(docDir, { recursive: true });

    await fs.writeFile(
      path.join(docDir, 'markdown.md'),
      doc.markdown,
      'utf-8'
    );
    
    // Сохраняем 10-уровневую позицию
    const legalPositionFormatted = doc.legalPositionParsed
      ? JSON.stringify(doc.legalPositionParsed, null, 2)
      : doc.legalPosition;
    
    await fs.writeFile(
      path.join(docDir, 'legal-position.json'),
      legalPositionFormatted,
      'utf-8'
    );

    // Сохраняем карточку дела, если есть
    if (doc.caseCard) {
      await fs.writeFile(
        path.join(docDir, 'case-card.json'),
        JSON.stringify(doc.caseCard, null, 2),
        'utf-8'
      );
    }
  }

  // Сохраняем скелет обзора
  await fs.writeFile(
    path.join(sessionDir, 'review-skeleton.json'),
    JSON.stringify(skeleton, null, 2),
    'utf-8'
  );

  // Сохраняем финальный обзор
  await fs.writeFile(
    path.join(sessionDir, 'review.md'),
    review,
    'utf-8'
  );
}

