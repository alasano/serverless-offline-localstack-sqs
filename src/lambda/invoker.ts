import { resolve } from 'path';
import { existsSync } from 'fs';
import { EventBuilder, SQSEvent, LambdaContext } from './event-builder';
import { Logger } from '../utils/logger';
import { PluginConfig } from '../config/defaults';

export interface HandlerResult {
  success: boolean;
  error?: Error;
  result?: any;
}

export interface FunctionDefinition {
  handler: string;
  timeout?: number;
  runtime?: string;
}

export class LambdaInvoker {
  private logger: Logger;
  private config: PluginConfig;
  private eventBuilder: EventBuilder;
  private servicePath: string;
  private handlerCache: Map<string, any> = new Map();

  constructor(servicePath: string, config: PluginConfig, logger: Logger) {
    this.servicePath = servicePath;
    this.config = config;
    this.logger = logger;
    this.eventBuilder = new EventBuilder(config.region);
  }

  async invokeHandler(
    handlerPath: string,
    sqsEvent: SQSEvent,
    functionDefinition: FunctionDefinition
  ): Promise<HandlerResult> {
    try {
      this.logger.debug(`Invoking handler: ${handlerPath} with ${sqsEvent.Records.length} message(s)`);

      const handler = await this.loadHandler(handlerPath);
      // Serverless Framework defines timeout in seconds; convert to ms for internal use
      const timeout = functionDefinition.timeout
        ? functionDefinition.timeout * 1000
        : this.config.lambdaTimeout;
      const context = this.eventBuilder.buildLambdaContext(
        handlerPath,
        timeout
      );

      const startTime = Date.now();
      let result: any;

      try {
        // Handle both callback and promise-based handlers
        result = await this.executeHandler(handler, sqsEvent, context);
        const duration = Date.now() - startTime;
        
        this.logger.info(`Handler ${handlerPath} completed successfully in ${duration}ms`);
        return { success: true, result };
      } catch (error: any) {
        const duration = Date.now() - startTime;
        this.logger.error(`Handler ${handlerPath} failed after ${duration}ms:`, error.message);
        return { success: false, error };
      }
    } catch (error: any) {
      this.logger.error(`Failed to invoke handler ${handlerPath}:`, error.message);
      return { success: false, error };
    }
  }

  private async loadHandler(handlerPath: string): Promise<any> {
    // Check cache first
    if (this.handlerCache.has(handlerPath)) {
      if (!this.config.skipCacheInvalidation) {
        this.handlerCache.delete(handlerPath);
        try {
          this.invalidateRequireCache(handlerPath);
        } catch (e) {
          this.logger.debug(`Cache invalidation failed for ${handlerPath}: ${e}`);
        }
      } else {
        return this.handlerCache.get(handlerPath)!;
      }
    }

    const { modulePath, handlerName } = this.parseHandlerPath(handlerPath);
    const fullPath = this.resolveHandlerPath(modulePath);

    if (!existsSync(fullPath)) {
      throw new Error(`Handler file not found: ${fullPath}`);
    }

    this.logger.debug(`Loading handler from: ${fullPath}`);

    try {
      // Clear require cache to enable hot reloading
      delete require.cache[require.resolve(fullPath)];
      
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const module = require(fullPath);
      const handler = module[handlerName];

      if (typeof handler !== 'function') {
        throw new Error(`Handler ${handlerName} is not a function in ${fullPath}`);
      }

      this.handlerCache.set(handlerPath, handler);
      return handler;
    } catch (error: any) {
      throw new Error(`Failed to load handler ${handlerPath}: ${error.message}`);
    }
  }

  private parseHandlerPath(handlerPath: string): { modulePath: string; handlerName: string } {
    const lastDotIndex = handlerPath.lastIndexOf('.');
    
    if (lastDotIndex === -1) {
      throw new Error(`Invalid handler format: ${handlerPath}. Expected format: 'file.handlerName'`);
    }

    const modulePath = handlerPath.substring(0, lastDotIndex);
    const handlerName = handlerPath.substring(lastDotIndex + 1);

    return { modulePath, handlerName };
  }

  private resolveHandlerPath(modulePath: string): string {
    // Handle absolute paths
    if (resolve(modulePath) === modulePath) {
      return modulePath;
    }

    // Handle relative paths
    const basePath = resolve(this.servicePath, modulePath);

    // Prevent path traversal outside the service directory
    if (!basePath.startsWith(this.servicePath)) {
      throw new Error(`Handler path "${modulePath}" resolves outside the service directory`);
    }
    
    // Try different extensions
    const extensions = ['.js', '.ts', '.mjs'];
    
    for (const ext of extensions) {
      const fullPath = basePath + ext;
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }

    // Try as directory with index file
    for (const ext of extensions) {
      const indexPath = resolve(basePath, 'index' + ext);
      if (existsSync(indexPath)) {
        return indexPath;
      }
    }

    // Return the original path and let the error be handled upstream
    return basePath + '.js';
  }

  private async executeHandler(handler: any, event: SQSEvent, context: LambdaContext): Promise<any> {
    return new Promise((resolve, reject) => {
      let isResolved = false;

      // Set up timeout
      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          reject(new Error(`Handler timed out after ${context.getRemainingTimeInMillis()}ms`));
        }
      }, context.getRemainingTimeInMillis());

      // Override context methods to resolve/reject the wrapping Promise
      context.done = (error?: Error, result?: any) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          error ? reject(error) : resolve(result);
        }
      };

      context.succeed = (result: any) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          resolve(result);
        }
      };

      context.fail = (error: Error | string) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          reject(error instanceof Error ? error : new Error(error));
        }
      };

      try {
        // Execute handler
        const result = handler(event, context, (error?: Error, response?: any) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeout);
            error ? reject(error) : resolve(response);
          }
        });

        // Handle promise-based handlers
        if (result && typeof result.then === 'function') {
          result
            .then((response: any) => {
              if (!isResolved) {
                isResolved = true;
                clearTimeout(timeout);
                resolve(response);
              }
            })
            .catch((error: any) => {
              if (!isResolved) {
                isResolved = true;
                clearTimeout(timeout);
                reject(error);
              }
            });
        }
      } catch (error) {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeout);
          reject(error);
        }
      }
    });
  }

  private invalidateRequireCache(handlerPath: string): void {
    const { modulePath } = this.parseHandlerPath(handlerPath);
    const fullPath = this.resolveHandlerPath(modulePath);
    
    if (require.cache[require.resolve(fullPath)]) {
      delete require.cache[require.resolve(fullPath)];
    }
  }

  clearCache(): void {
    this.handlerCache.clear();
    this.logger.debug('Handler cache cleared');
  }
}