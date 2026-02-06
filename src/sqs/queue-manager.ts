import { SqsClientWrapper, QueueInfo } from "./client";
import { Logger } from "../utils/logger";
import { PluginConfig, QueueConfig } from "../config/defaults";

export interface QueueResource {
  logicalId: string;
  queueName: string;
  attributes: Record<string, string>;
  dlqName?: string;
}

export class QueueManager {
  private sqsClient: SqsClientWrapper;
  private logger: Logger;
  private config: PluginConfig;
  private createdQueues: Map<string, QueueInfo> = new Map();

  constructor(sqsClient: SqsClientWrapper, config: PluginConfig, logger: Logger) {
    this.sqsClient = sqsClient;
    this.config = config;
    this.logger = logger;
  }

  async createQueuesFromConfig(): Promise<void> {
    if (!this.config.autoCreate) {
      this.logger.debug("Queue auto-creation disabled");
      return;
    }

    this.logger.info("Creating queues from configuration...");

    for (const queueConfig of this.config.queues) {
      try {
        await this.createQueueFromConfig(queueConfig);
      } catch (error: any) {
        this.logger.error(`Failed to create queue ${queueConfig.queueName}: ${error.message}`);
      }
    }
  }

  async createQueuesFromCloudFormation(resources: any): Promise<void> {
    if (!this.config.autoCreate) {
      this.logger.debug("Queue auto-creation disabled");
      return;
    }

    const sqsResources = this.extractSqsResources(resources);
    if (sqsResources.length === 0) {
      this.logger.debug("No SQS queues found in CloudFormation resources");
      return;
    }

    this.logger.info(`Found ${sqsResources.length} SQS queue(s) in CloudFormation resources`);

    for (const resource of sqsResources) {
      try {
        await this.createQueueFromResource(resource);
      } catch (error: any) {
        this.logger.error(`Failed to create queue ${resource.queueName}: ${error.message}`);
      }
    }
  }

  private async createQueueFromConfig(queueConfig: QueueConfig): Promise<void> {
    const { queueName: rawQueueName, dlq } = queueConfig;
    const queueName = this.sanitizeQueueName(rawQueueName);

    // Create DLQ first if enabled
    let dlqUrl: string | undefined;
    if (dlq?.enabled) {
      const dlqName = this.sanitizeQueueName(
        dlq.queueName || `${queueName}${this.config.deadLetterQueueSuffix}`,
      );
      const dlqInfo = await this.sqsClient.createQueue(dlqName);
      dlqUrl = dlqInfo.queueUrl;
      this.createdQueues.set(dlqName, dlqInfo);
    }

    // Create main queue
    const attributes = this.buildQueueAttributes(queueConfig, dlqUrl);
    const queueInfo = await this.sqsClient.createQueue(queueName, attributes);
    this.createdQueues.set(queueName, queueInfo);

    this.logger.info(`Created queue: ${queueName} with handler: ${queueConfig.handler}`);
  }

  private async createQueueFromResource(resource: QueueResource): Promise<void> {
    const { queueName, attributes, dlqName } = resource;

    // Create DLQ first if specified
    let dlqUrl: string | undefined;
    if (dlqName) {
      const dlqInfo = await this.sqsClient.createQueue(dlqName);
      dlqUrl = dlqInfo.queueUrl;
      this.createdQueues.set(dlqName, dlqInfo);
    }

    // Update attributes with DLQ ARN if needed
    const finalAttributes = { ...attributes };
    if (dlqUrl && !finalAttributes.RedrivePolicy) {
      finalAttributes.RedrivePolicy = JSON.stringify({
        deadLetterTargetArn: this.buildQueueArn(dlqName!),
        maxReceiveCount: this.config.maxReceiveCount,
      });
    }

    // Create main queue
    const queueInfo = await this.sqsClient.createQueue(queueName, finalAttributes);
    this.createdQueues.set(queueName, queueInfo);

    this.logger.info(`Created queue from CloudFormation: ${queueName}`);
  }

  private buildQueueAttributes(queueConfig: QueueConfig, dlqUrl?: string): Record<string, string> {
    const attributes: Record<string, string> = {
      VisibilityTimeout: (
        queueConfig.visibilityTimeout || this.config.visibilityTimeout
      ).toString(),
      ReceiveMessageWaitTimeSeconds: (
        queueConfig.waitTimeSeconds || this.config.waitTimeSeconds
      ).toString(),
    };

    if (dlqUrl && queueConfig.dlq?.enabled) {
      const dlqName = this.sanitizeQueueName(
        queueConfig.dlq.queueName || `${queueConfig.queueName}${this.config.deadLetterQueueSuffix}`,
      );
      attributes.RedrivePolicy = JSON.stringify({
        deadLetterTargetArn: this.buildQueueArn(dlqName),
        maxReceiveCount: queueConfig.dlq.maxReceiveCount || this.config.maxReceiveCount,
      });
    }

    return attributes;
  }

  private extractSqsResources(resources: any): QueueResource[] {
    const sqsResources: QueueResource[] = [];

    if (!resources || typeof resources !== "object") {
      return sqsResources;
    }

    for (const [logicalId, resource] of Object.entries(resources)) {
      if (this.isSqsQueue(resource)) {
        const queueResource = this.parseQueueResource(logicalId, resource as any);
        if (queueResource) {
          sqsResources.push(queueResource);
        }
      }
    }

    return sqsResources;
  }

  private isSqsQueue(resource: any): boolean {
    return resource?.Type === "AWS::SQS::Queue";
  }

  private parseQueueResource(logicalId: string, resource: any): QueueResource | null {
    try {
      const properties = resource.Properties || {};
      const queueName = this.sanitizeQueueName(properties.QueueName || logicalId);
      const attributes: Record<string, string> = {};

      // Map CloudFormation properties to SQS attributes
      if (properties.VisibilityTimeout !== undefined) {
        attributes.VisibilityTimeout = properties.VisibilityTimeout.toString();
      }
      if (properties.ReceiveMessageWaitTimeSeconds !== undefined) {
        attributes.ReceiveMessageWaitTimeSeconds =
          properties.ReceiveMessageWaitTimeSeconds.toString();
      }
      if (properties.MessageRetentionPeriod !== undefined) {
        attributes.MessageRetentionPeriod = properties.MessageRetentionPeriod.toString();
      }
      if (properties.DelaySeconds !== undefined) {
        attributes.DelaySeconds = properties.DelaySeconds.toString();
      }

      // Map FIFO-specific CloudFormation properties
      if (properties.FifoQueue != null) {
        attributes.FifoQueue = properties.FifoQueue.toString();
      }
      if (properties.ContentBasedDeduplication != null) {
        attributes.ContentBasedDeduplication = properties.ContentBasedDeduplication.toString();
      }
      if (properties.DeduplicationScope != null) {
        attributes.DeduplicationScope = properties.DeduplicationScope;
      }
      if (properties.FifoThroughputLimit != null) {
        attributes.FifoThroughputLimit = properties.FifoThroughputLimit;
      }

      // Handle redrive policy
      let dlqName: string | undefined;
      if (properties.RedrivePolicy) {
        attributes.RedrivePolicy = JSON.stringify(properties.RedrivePolicy);

        // Try to extract DLQ name from the policy
        if (
          properties.RedrivePolicy.deadLetterTargetArn &&
          typeof properties.RedrivePolicy.deadLetterTargetArn === "string"
        ) {
          const arnParts = properties.RedrivePolicy.deadLetterTargetArn.split(":");
          dlqName = this.sanitizeQueueName(arnParts[arnParts.length - 1]);
        }
      }

      return {
        logicalId,
        queueName,
        attributes,
        dlqName,
      };
    } catch (error) {
      this.logger.warn(`Failed to parse SQS resource ${logicalId}:`, error);
      return null;
    }
  }

  private buildQueueArn(queueName: string): string {
    // LocalStack uses a simplified ARN format
    return `arn:aws:sqs:${this.config.region}:000000000000:${queueName}`;
  }

  private sanitizeQueueName(queueName: string): string {
    // Detect and preserve .fifo suffix — FIFO queues must end with .fifo
    const isFifo = queueName.endsWith(".fifo");
    const baseName = isFifo ? queueName.slice(0, -5) : queueName;

    // SQS queue names can only contain alphanumeric characters, hyphens, and underscores
    // Replace dots and other invalid characters with hyphens
    let sanitized = baseName.replace(/[^a-zA-Z0-9_-]/g, "-");

    // Ensure length is between 1 and 80 characters
    // For FIFO queues, the .fifo suffix takes 5 chars, so base name max is 75
    const maxLength = isFifo ? 75 : 80;
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }

    // Remove trailing hyphens that might have been added
    sanitized = sanitized.replace(/-+$/, "");

    // Ensure we don't have an empty string
    if (sanitized.length === 0) {
      sanitized = "queue";
    }

    // Re-append .fifo suffix if originally present
    if (isFifo) {
      sanitized += ".fifo";
    }

    return sanitized;
  }

  getCreatedQueues(): Map<string, QueueInfo> {
    return this.createdQueues;
  }

  async getQueueInfo(queueName: string): Promise<QueueInfo | undefined> {
    try {
      if (this.createdQueues.has(queueName)) {
        return this.createdQueues.get(queueName);
      }

      const queueInfo = await this.sqsClient.getQueueInfo(queueName);
      this.createdQueues.set(queueName, queueInfo);
      return queueInfo;
    } catch (error: any) {
      this.logger.debug(`Queue ${queueName} not found: ${error.message}`);
      return undefined;
    }
  }
}
