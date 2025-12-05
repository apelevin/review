import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';

// Ленивая инициализация клиента OpenAI
let openaiInstance: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiInstance) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY не установлен в переменных окружения');
    }
    openaiInstance = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiInstance;
}

// Цены для моделей (per 1M tokens)
interface ModelPricing {
  input: number;
  cached_input: number;
  output: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-5-mini': {
    input: 0.25,
    cached_input: 0.025,
    output: 2.0,
  },
  'gpt-5': {
    input: 1.25,
    cached_input: 0.125,
    output: 10.0,
  },
  'gpt-5.1': {
    input: 1.25,
    cached_input: 0.125,
    output: 10.0,
  },
  // Fallback для неизвестных моделей (используем цены gpt-5.1)
  'gpt-4o': {
    input: 1.25,
    cached_input: 0.125,
    output: 10.0,
  },
};

// Цены для Flex режима (per 1M tokens) - в 2 раза дешевле Standard
const MODEL_PRICING_FLEX: Record<string, ModelPricing> = {
  'gpt-5-mini': {
    input: 0.125,
    cached_input: 0.0125,
    output: 1.0,
  },
  'gpt-5': {
    input: 0.625,
    cached_input: 0.0625,
    output: 5.0,
  },
  'gpt-5.1': {
    input: 0.625,
    cached_input: 0.0625,
    output: 5.0,
  },
  // Fallback для неизвестных моделей (используем цены gpt-5.1)
  'gpt-4o': {
    input: 0.625,
    cached_input: 0.0625,
    output: 5.0,
  },
};

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  totalTokens: number;
}

export interface CostBreakdown {
  inputCost: number;
  cachedInputCost: number;
  outputCost: number;
  totalCost: number;
}

export interface APIResponse {
  content: string;
  usage: TokenUsage;
  cost: CostBreakdown;
  usedFlex?: boolean;
  fallbackToStandard?: boolean;
}

/**
 * Вспомогательная функция для задержки
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Отправляет запрос к OpenAI API с системным промптом и пользовательским контентом
 * @param systemPrompt - системный промпт
 * @param userContent - пользовательский контент (текст документа)
 * @param model - модель OpenAI (по умолчанию gpt-5.1)
 * @param useFlex - использовать Flex режим (дешевле, но может быть медленнее)
 * @returns Promise с ответом от модели, статистикой токенов и расходами
 */
export async function callOpenAI(
  systemPrompt: string,
  userContent: string,
  model: string = 'gpt-5.1',
  useFlex: boolean = false
): Promise<APIResponse> {
  try {
    const openai = getOpenAIClient();
    
    let response;
    let usedModel = model;
    let actuallyUsedFlex = useFlex;
    let fallbackToStandard = false;
    
    // Функция для создания запроса
    const createRequest = (flexMode: boolean) => {
      const requestParams: any = {
        model: usedModel,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userContent,
          },
        ],
        temperature: 0.7,
      };
      
      if (flexMode) {
        requestParams.service_tier = 'flex';
      }
      
      return openai.chat.completions.create(requestParams);
    };
    
    // Если используем Flex, пробуем с retry логикой
    if (useFlex) {
      const maxRetries = 3;
      const retryDelays = [2000, 4000, 8000]; // 2s, 4s, 8s
      let lastError: any = null;
      
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          response = await createRequest(true);
          break; // Успешно, выходим из цикла
        } catch (error: any) {
          lastError = error;
          
          // Проверяем, это ли ошибка 429 Resource Unavailable
          if (
            error?.status === 429 &&
            (error?.message?.includes('Resource Unavailable') ||
             error?.message?.includes('resource_unavailable') ||
             error?.code === 'resource_unavailable')
          ) {
            // Если это не последняя попытка, ждем и повторяем
            if (attempt < maxRetries - 1) {
              console.warn(
                `Flex режим: Resource Unavailable (попытка ${attempt + 1}/${maxRetries}), повтор через ${retryDelays[attempt]}ms`
              );
              await delay(retryDelays[attempt]);
              continue;
            } else {
              // Все попытки исчерпаны, fallback на Standard
              console.warn(
                `Flex режим: все попытки исчерпаны, переключаемся на Standard режим`
              );
              actuallyUsedFlex = false;
              fallbackToStandard = true;
              break;
            }
          } else {
            // Другая ошибка, пробуем fallback на Standard
            console.warn(
              `Flex режим: получена ошибка ${error?.status || 'unknown'}, переключаемся на Standard режим`
            );
            actuallyUsedFlex = false;
            fallbackToStandard = true;
            break;
          }
        }
      }
      
      // Если все retry неудачны, пробуем Standard режим
      if (!response && fallbackToStandard) {
        try {
          response = await createRequest(false);
        } catch (standardError: any) {
          // Если Standard тоже не работает, пробуем fallback на другую модель
          if (standardError?.status === 404 || standardError?.message?.includes('model') || standardError?.code === 'model_not_found') {
            console.warn(`Модель ${model} недоступна, используем gpt-4o`);
            usedModel = 'gpt-4o';
            response = await createRequest(false);
          } else {
            throw standardError;
          }
        }
      }
    } else {
      // Standard режим, без retry логики
      try {
        response = await createRequest(false);
      } catch (modelError: any) {
        // Если модель недоступна, пробуем fallback на gpt-4o
        if (modelError?.status === 404 || modelError?.message?.includes('model') || modelError?.code === 'model_not_found') {
          console.warn(`Модель ${model} недоступна, используем gpt-4o`);
          usedModel = 'gpt-4o';
          response = await createRequest(false);
        } else {
          throw modelError;
        }
      }
    }

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Пустой ответ от OpenAI API');
    }

    // Извлекаем статистику использования токенов
    const usage = response.usage;
    if (!usage) {
      throw new Error('Не получена статистика использования токенов');
    }

    const tokenUsage: TokenUsage = {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      cachedTokens: (usage as any).cached_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    };

    // Рассчитываем расходы
    const inputTokens = tokenUsage.promptTokens - (tokenUsage.cachedTokens || 0);
    const cachedInputTokens = tokenUsage.cachedTokens || 0;
    const outputTokens = tokenUsage.completionTokens;

    // Определяем цены в зависимости от модели и режима
    // Используем Flex цены, если использовался Flex режим, иначе Standard
    const pricing = actuallyUsedFlex
      ? (MODEL_PRICING_FLEX[usedModel] || MODEL_PRICING_FLEX['gpt-5.1'])
      : (MODEL_PRICING[usedModel] || MODEL_PRICING['gpt-5.1']);

    const cost: CostBreakdown = {
      inputCost: (inputTokens / 1_000_000) * pricing.input,
      cachedInputCost: (cachedInputTokens / 1_000_000) * pricing.cached_input,
      outputCost: (outputTokens / 1_000_000) * pricing.output,
      totalCost: 0,
    };

    cost.totalCost = cost.inputCost + cost.cachedInputCost + cost.outputCost;

    return {
      content,
      usage: tokenUsage,
      cost,
      usedFlex: actuallyUsedFlex,
      fallbackToStandard,
    };
  } catch (error) {
    throw new Error(
      `Ошибка при вызове OpenAI API: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Загружает промпт из файла
 * @param promptPath - путь к файлу с промптом
 * @returns Promise с содержимым промпта
 */
export async function loadPrompt(promptPath: string): Promise<string> {
  try {
    const fullPath = path.join(process.cwd(), promptPath);
    const content = await fs.readFile(fullPath, 'utf-8');
    return content.trim();
  } catch (error) {
    throw new Error(
      `Ошибка при загрузке промпта из ${promptPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Загружает промпт из файла и разделяет на SYSTEM и USER части
 * @param promptPath - путь к файлу с промптом
 * @returns Promise с объектом, содержащим systemPrompt и userPrompt
 */
export async function loadPromptWithParts(promptPath: string): Promise<{
  systemPrompt: string;
  userPrompt: string;
}> {
  try {
    const fullPath = path.join(process.cwd(), promptPath);
    const content = await fs.readFile(fullPath, 'utf-8');
    
    // Разделяем на SYSTEM и USER части
    const systemMatch = content.match(/## 🟦\s*\*\*SYSTEM PROMPT\*\*\s*\n\n(.*?)(?=\n---|\n## 🟩|$)/s);
    const userMatch = content.match(/## 🟩\s*\*\*USER PROMPT\*\*\s*\n\n(.*?)(?=\n---|\n## 🟥|$)/s);
    
    const systemPrompt = systemMatch ? systemMatch[1].trim() : content.trim();
    const userPrompt = userMatch ? userMatch[1].trim() : '';
    
    return {
      systemPrompt,
      userPrompt: userPrompt || content.trim(), // Если USER не найден, используем весь контент
    };
  } catch (error) {
    throw new Error(
      `Ошибка при загрузке промпта из ${promptPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

