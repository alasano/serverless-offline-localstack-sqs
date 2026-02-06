export interface Logger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

export class ConsoleLogger implements Logger {
  private readonly prefix: string;
  private readonly debugEnabled: boolean;

  constructor(prefix = "[serverless-offline-localstack-sqs]", debug = false) {
    this.prefix = prefix;
    this.debugEnabled = debug || process.env.SLS_DEBUG === "true" || process.env.DEBUG === "true";
  }

  info(message: string, ...args: any[]): void {
    console.log(`${this.prefix} ${message}`, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`${this.prefix} ⚠️  ${message}`, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(`${this.prefix} ❌ ${message}`, ...args);
  }

  debug(message: string, ...args: any[]): void {
    if (this.debugEnabled) {
      console.log(`${this.prefix} 🐛 ${message}`, ...args);
    }
  }
}

export const createLogger = (prefix?: string, debug?: boolean): Logger => {
  return new ConsoleLogger(prefix, debug);
};
