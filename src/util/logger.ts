export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

function stamp(): string {
  return new Date().toISOString();
}

export const consoleLogger: Logger = {
  info(message, meta) {
    console.log(`[${stamp()}] INFO  ${message}`, meta ?? "");
  },
  warn(message, meta) {
    console.warn(`[${stamp()}] WARN  ${message}`, meta ?? "");
  },
  error(message, meta) {
    console.error(`[${stamp()}] ERROR ${message}`, meta ?? "");
  },
};
