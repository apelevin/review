import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Обзор судебной практики",
  description: "Сервис для обработки документов судебной практики",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Подавляем несущественные ошибки от расширений браузера
              if (typeof window !== 'undefined') {
                const originalError = console.error;
                console.error = function(...args) {
                  const message = args[0]?.toString() || '';
                  // Игнорируем ошибки расширений браузера
                  if (
                    message.includes('runtime.lastError') ||
                    message.includes('No tab with id') ||
                    message.includes('service-worker-loader') ||
                    message.includes('Could not establish connection')
                  ) {
                    return;
                  }
                  originalError.apply(console, args);
                };
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

