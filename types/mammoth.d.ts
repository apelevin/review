declare module 'mammoth' {
  interface ConversionResult {
    value: string;
    messages: Array<{
      type: string;
      message: string;
    }>;
  }

  interface ConversionOptions {
    buffer: Buffer;
  }

  function convertToMarkdown(options: ConversionOptions): Promise<ConversionResult>;
  function convertToHtml(options: ConversionOptions): Promise<ConversionResult>;

  export default {
    convertToMarkdown,
    convertToHtml,
  };
}

