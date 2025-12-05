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

// Цены для gpt-5.1 (per 1M tokens)
const PRICING = {
  input: 1.25,
  cached_input: 0.125,
  output: 10.0,
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
}

/**
 * Отправляет запрос к OpenAI API с системным промптом и пользовательским контентом
 * @param systemPrompt - системный промпт
 * @param userContent - пользовательский контент (текст документа)
 * @param model - модель OpenAI (по умолчанию gpt-5.1)
 * @returns Promise с ответом от модели, статистикой токенов и расходами
 */
export async function callOpenAI(
  systemPrompt: string,
  userContent: string,
  model: string = 'gpt-5.1'
): Promise<APIResponse> {
  try {
    const openai = getOpenAIClient();
    
    // Пробуем вызвать с указанной моделью, если ошибка - пробуем fallback
    let response;
    let usedModel = model;
    
    try {
      response = await openai.chat.completions.create({
        model: model,
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
      });
    } catch (modelError: any) {
      // Если модель недоступна, пробуем fallback на gpt-4o
      if (modelError?.status === 404 || modelError?.message?.includes('model') || modelError?.code === 'model_not_found') {
        console.warn(`Модель ${model} недоступна, используем gpt-4o`);
        usedModel = 'gpt-4o';
        response = await openai.chat.completions.create({
          model: 'gpt-4o',
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
        });
      } else {
        throw modelError;
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
    // Используем цены для gpt-5.1, если модель другая - можно добавить проверку
    const inputTokens = tokenUsage.promptTokens - (tokenUsage.cachedTokens || 0);
    const cachedInputTokens = tokenUsage.cachedTokens || 0;
    const outputTokens = tokenUsage.completionTokens;

    // Определяем цены в зависимости от модели
    let pricing = PRICING;
    if (usedModel !== 'gpt-5.1') {
      // Для других моделей используем стандартные цены (можно настроить)
      // Пока используем те же цены, что указал пользователь для gpt-5.1
      pricing = PRICING;
    }

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

