import { SqsClientWrapper } from "./sqs/client";
import { QueueManager } from "./sqs/queue-manager";
import { MessagePoller } from "./sqs/poller";
import { LambdaInvoker } from "./lambda/invoker";
import { DockerDetector } from "./utils/docker";
import { createLogger, Logger } from "./utils/logger";
import { validateConfig } from "./config/schema";
import { mergeConfig, PluginConfig, QueueConfig } from "./config/defaults";

export interface ServerlessInstance {
  service: {
    service: string;
    provider: {
      name: string;
      region?: string;
      stage?: string;
      runtime?: string;
    };
    functions?: Record<string, any>;
    resources?: {
      Resources?: Record<string, any>;
    };
    custom?: {
      [key: string]: any;
    };
  };
  config: {
    servicePath: string;
  };
  pluginManager: {
    spawn(command: string): Promise<void>;
  };
  cli: {
    log(message: string, entity?: string): void;
    consoleLog(message: string): void;
  };
  classes?: {
    Error: any;
  };
  getProvider(name: string): any;
  utils: {
    writeFileSync(filePath: string, contents: string): void;
    readFileSync(filePath: string): string;
    fileExistsSync(filePath: string): boolean;
  };
}

export interface ServerlessOptions {
  stage?: string;
  region?: string;
  function?: string;
  [key: string]: any;
}

export default class ServerlessOfflineLocalstackSqsPlugin {
  public serverless: ServerlessInstance;
  public options: ServerlessOptions;
  public hooks: Record<string, () => Promise<void> | void>;
  public commands: Record<string, any>;

  private logger: Logger;
  private config: PluginConfig;
  private sqsClient?: SqsClientWrapper;
  private queueManager?: QueueManager;
  private messagePoller?: MessagePoller;
  private lambdaInvoker?: LambdaInvoker;
  private dockerDetector?: DockerDetector;
  private isInitialized = false;
  private isStarted = false;
  private signalHandlersRegistered = false;

  constructor(serverless: ServerlessInstance, options: ServerlessOptions) {
    this.serverless = serverless;
    this.options = options;

    // Initialize logger first (temporary, without debug flag)
    this.logger = createLogger("[serverless-offline-localstack-sqs]");

    // Initialize configuration
    this.config = this.initializeConfig();

    // Re-initialize logger with debug flag from config
    this.logger = createLogger("[serverless-offline-localstack-sqs]", this.config.debug);

    // Set up plugin lifecycle hooks
    this.hooks = {
      "before:offline:start:init": this.initialize.bind(this),
      "before:offline:start": this.start.bind(this),
      "after:offline:start": this.cleanup.bind(this),
      "offline:start:init": this.initialize.bind(this),
      "offline:start": this.start.bind(this),
    };

    // Set up custom commands
    this.commands = {
      "sqs-offline": {
        usage: "Starts the SQS offline service",
        lifecycleEvents: ["start"],
        commands: {
          start: {
            usage: "Starts polling SQS queues",
            lifecycleEvents: ["init", "create", "poll"],
          },
          stop: {
            usage: "Stops polling SQS queues",
            lifecycleEvents: ["cleanup"],
          },
        },
      },
    };

    // Add hooks for custom commands
    this.hooks["sqs-offline:start:init"] = this.initialize.bind(this);
    this.hooks["sqs-offline:start:create"] = this.createQueues.bind(this);
    this.hooks["sqs-offline:start:poll"] = this.startPolling.bind(this);
    this.hooks["sqs-offline:stop:cleanup"] = this.cleanup.bind(this);

    this.logger.debug("Plugin initialized");
  }

  private initializeConfig(): PluginConfig {
    try {
      // Get custom configuration from serverless.yml
      const customConfig =
        this.serverless.service.custom?.["serverless-offline-localstack-sqs"] || {};

      // Extract queue configurations from functions
      const queueConfigs = this.extractQueueConfigsFromFunctions();

      // Merge all configurations
      const rawConfig = {
        ...customConfig,
        queues: [...(customConfig.queues || []), ...queueConfigs],
      };

      // Validate and return merged config
      const validatedConfig = validateConfig(rawConfig);
      const finalConfig = mergeConfig(validatedConfig);

      this.logger.debug("Configuration initialized:", {
        enabled: finalConfig.enabled,
        queueCount: finalConfig.queues.length,
        endpoint: finalConfig.endpoint,
      });

      return finalConfig;
    } catch (error: any) {
      this.logger.error(`Configuration error: ${error.message}`);
      throw error;
    }
  }

  private extractQueueConfigsFromFunctions(): QueueConfig[] {
    const queueConfigs: QueueConfig[] = [];
    const functions = this.serverless.service.functions || {};

    for (const [functionName, functionDef] of Object.entries(functions)) {
      if (typeof functionDef !== "object" || !functionDef.events) {
        continue;
      }

      for (const event of functionDef.events) {
        if (event.sqs) {
          const queueConfig = this.parseSqsEvent(functionName, functionDef, event.sqs);
          if (queueConfig) {
            queueConfigs.push(queueConfig);
          }
        }
      }
    }

    this.logger.debug(`Extracted ${queueConfigs.length} queue configurations from functions`);
    return queueConfigs;
  }

  private parseSqsEvent(functionName: string, functionDef: any, sqsEvent: any): QueueConfig | null {
    try {
      let queueName: string;
      let batchSize = 1;

      if (typeof sqsEvent === "string") {
        // Simple ARN format: arn:aws:sqs:region:account:queueName
        const arnParts = sqsEvent.split(":");
        queueName = arnParts[arnParts.length - 1];
      } else if (typeof sqsEvent === "object") {
        if (sqsEvent.arn) {
          if (typeof sqsEvent.arn === "string") {
            const arnParts = sqsEvent.arn.split(":");
            queueName = arnParts[arnParts.length - 1];
          } else if (typeof sqsEvent.arn === "object") {
            // Handle CloudFormation intrinsic functions
            if (sqsEvent.arn["Fn::GetAtt"]) {
              const logicalId = sqsEvent.arn["Fn::GetAtt"][0];
              queueName = this.resolveQueueNameFromResource(logicalId) || logicalId;
              this.logger.debug(
                `Resolved Fn::GetAtt for function ${functionName}: logical ID "${logicalId}" resolved to queue name "${queueName}"`,
              );
            } else if (sqsEvent.arn["Ref"]) {
              const logicalId = sqsEvent.arn["Ref"];
              queueName = this.resolveQueueNameFromResource(logicalId) || logicalId;
              this.logger.debug(
                `Resolved Ref for function ${functionName}: logical ID "${logicalId}" resolved to queue name "${queueName}"`,
              );
            } else {
              this.logger.warn(
                `Unresolvable ARN value for function ${functionName}: ${JSON.stringify(sqsEvent.arn)}`,
              );
              return null;
            }
          } else {
            this.logger.warn(
              `Unexpected ARN type for function ${functionName}: ${JSON.stringify(sqsEvent.arn)}`,
            );
            return null;
          }
        } else if (sqsEvent.queueName) {
          queueName = sqsEvent.queueName;
        } else {
          this.logger.warn(`Invalid SQS event configuration for function ${functionName}`);
          return null;
        }

        batchSize = sqsEvent.batchSize || 1;
      } else {
        this.logger.warn(`Unsupported SQS event format for function ${functionName}`);
        return null;
      }

      // Support both singular and plural forms for functionResponseType(s)
      // Singular: functionResponseType: "ReportBatchItemFailures" (string)
      // Plural: functionResponseTypes: ["ReportBatchItemFailures"] (array)
      let functionResponseTypes: string[] | undefined;
      if (sqsEvent.functionResponseTypes && Array.isArray(sqsEvent.functionResponseTypes)) {
        functionResponseTypes = sqsEvent.functionResponseTypes;
      } else if (
        sqsEvent.functionResponseType &&
        typeof sqsEvent.functionResponseType === "string"
      ) {
        functionResponseTypes = [sqsEvent.functionResponseType];
      }

      return {
        queueName,
        handler: functionDef.handler,
        batchSize,
        enabled: true,
        // Serverless Framework timeout is in seconds (e.g., timeout: 30 means 30s)
        ...(functionDef.timeout != null ? { timeout: functionDef.timeout } : {}),
        ...(functionResponseTypes ? { functionResponseTypes } : {}),
      };
    } catch (error: any) {
      this.logger.warn(`Failed to parse SQS event for function ${functionName}: ${error.message}`);
      return null;
    }
  }

  private resolveQueueNameFromResource(logicalId: string): string | undefined {
    const resource = this.serverless.service.resources?.Resources?.[logicalId];
    if (resource && resource.Type === "AWS::SQS::Queue" && resource.Properties?.QueueName) {
      return resource.Properties.QueueName;
    }
    return undefined;
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized || !this.config.enabled) {
      return;
    }

    try {
      this.logger.info("Initializing serverless-offline-localstack-sqs plugin...");

      // Initialize Docker detector
      this.dockerDetector = new DockerDetector(this.logger);

      // Get LocalStack endpoint
      const endpoint = await this.dockerDetector.getEndpointUrl(this.config.endpoint);
      this.logger.info(`Using LocalStack endpoint: ${endpoint}`);

      // Initialize SQS client
      this.sqsClient = new SqsClientWrapper(this.config, this.logger, endpoint);

      // Initialize queue manager
      this.queueManager = new QueueManager(this.sqsClient, this.config, this.logger);

      // Initialize Lambda invoker
      this.lambdaInvoker = new LambdaInvoker(
        this.serverless.config.servicePath,
        this.config,
        this.logger,
      );

      // Initialize message poller
      this.messagePoller = new MessagePoller(
        this.sqsClient,
        this.lambdaInvoker,
        this.config,
        this.logger,
      );

      this.isInitialized = true;
      this.logger.info("Plugin initialization completed");
    } catch (error: any) {
      this.logger.error(`Initialization failed: ${error.message}`);
      throw error;
    }
  }

  private async createQueues(): Promise<void> {
    if (!this.isInitialized || !this.queueManager) {
      return;
    }

    try {
      this.logger.info("Creating SQS queues...");

      // Create queues from configuration
      await this.queueManager.createQueuesFromConfig();

      // Create queues from CloudFormation resources if present
      const resources = this.serverless.service.resources?.Resources;
      if (resources) {
        await this.queueManager.createQueuesFromCloudFormation(resources);
      }

      this.logger.info("Queue creation completed");
    } catch (error: any) {
      this.logger.error(`Queue creation failed: ${error.message}`);
      throw error;
    }
  }

  private async start(): Promise<void> {
    if (this.isStarted) return;

    if (!this.config.enabled) {
      this.logger.info("Plugin disabled, skipping SQS polling");
      return;
    }

    this.isStarted = true;

    await this.initialize();
    await this.createQueues();
    await this.startPolling();
  }

  private async startPolling(): Promise<void> {
    if (!this.messagePoller || this.config.queues.length === 0) {
      this.logger.info("No queues configured for polling");
      return;
    }

    try {
      this.logger.info("Starting SQS message polling...");
      this.messagePoller.startPolling(this.config.queues);

      // Set up graceful shutdown
      this.setupGracefulShutdown();

      this.logger.info(`SQS polling started for ${this.config.queues.length} queue(s)`);
    } catch (error: any) {
      this.logger.error(`Failed to start polling: ${error.message}`);
      throw error;
    }
  }

  private setupGracefulShutdown(): void {
    if (this.signalHandlersRegistered) return;

    const shutdown = async () => {
      this.logger.info("Shutting down SQS polling...");
      const forceExit = setTimeout(() => process.exit(1), 5000);
      forceExit.unref();
      await this.cleanup();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    this.signalHandlersRegistered = true;
  }

  private async cleanup(): Promise<void> {
    if (this.messagePoller?.isPolling()) {
      this.logger.info("Stopping SQS message polling...");
      this.messagePoller.stopPolling();
    }

    if (this.lambdaInvoker) {
      this.lambdaInvoker.clearCache();
    }

    this.isStarted = false;
    this.logger.info("Cleanup completed");
  }

  // Public API methods for external access
  public getPollerStates() {
    return this.messagePoller?.getPollerStates() || new Map();
  }

  public isPolling(): boolean {
    return this.messagePoller?.isPolling() || false;
  }

  public async restart(): Promise<void> {
    await this.cleanup();
    await this.start();
  }
}

// Export for CommonJS compatibility
module.exports = ServerlessOfflineLocalstackSqsPlugin;
