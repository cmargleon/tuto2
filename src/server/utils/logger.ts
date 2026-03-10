export const logger = {
  info(message: string, context?: unknown): void {
    console.log(`[INFO] ${new Date().toISOString()} ${message}`, context ?? "");
  },
  warn(message: string, context?: unknown): void {
    console.warn(`[WARN] ${new Date().toISOString()} ${message}`, context ?? "");
  },
  error(message: string, context?: unknown): void {
    console.error(`[ERROR] ${new Date().toISOString()} ${message}`, context ?? "");
  }
};
