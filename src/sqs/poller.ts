import { Message } from '@aws-sdk/client-sqs';
import { SqsClientWrapper, QueueInfo } from './client';
import { LambdaInvoker, FunctionDefinition, HandlerResult } from '../lambda/invoker';
import { EventBuilder } from '../lambda/event-builder';
import { Logger } from '../utils/logger';
import { PluginConfig, QueueConfig } from '../config/defaults';

export interface PollerState {
  isPolling: boolean;
  messageCount: number;
  errorCount: number;
  lastPollTime?: Date;
  lastError?: string;
}

export class MessagePoller {
  private sqsClient: SqsClientWrapper;
  private lambdaInvoker: LambdaInvoker;
  private eventBuilder: EventBuilder;
  private logger: Logger;
  private config: PluginConfig;
  private pollers: Map<string, AbortController> = new Map();
  private pollerStates: Map<string, PollerState> = new Map();

  constructor(
    sqsClient: SqsClientWrapper,
    lambdaInvoker: LambdaInvoker,
    config: PluginConfig,
    logger: Logger
  ) {
    this.sqsClient = sqsClient;
    this.lambdaInvoker = lambdaInvoker;
    this.config = config;
    this.logger = logger;
    this.eventBuilder = new EventBuilder(config.region);
  }

  startPolling(queueConfigs: QueueConfig[]): void {
    this.logger.info(`Starting SQS polling for ${queueConfigs.length} queue(s)`);

    for (const queueConfig of queueConfigs) {
      if (queueConfig.enabled !== false) {
        this.startQueuePoller(queueConfig);
      } else {
        this.logger.debug(`Skipping disabled queue: ${queueConfig.queueName}`);
      }
    }
  }

  private async startQueuePoller(queueConfig: QueueConfig): Promise<void> {
    const { queueName, handler } = queueConfig;
    const pollerId = `${queueName}-${handler}`;

    if (this.pollers.has(pollerId)) {
      this.logger.warn(`Poller already running for queue: ${queueName}`);
      return;
    }

    try {
      const queueInfo = await this.sqsClient.getQueueInfo(queueName);
      
      this.pollerStates.set(pollerId, {
        isPolling: true,
        messageCount: 0,
        errorCount: 0,
      });

      this.logger.info(`Started polling queue: ${queueName} -> ${handler}`);

      const controller = new AbortController();
      this.pollers.set(pollerId, controller);

      const pollLoop = async () => {
        while (!controller.signal.aborted) {
          await this.pollQueue(queueConfig, queueInfo);
          if (!controller.signal.aborted) {
            await new Promise(resolve => setTimeout(resolve, this.config.pollInterval));
          }
        }
      };

      pollLoop();
    } catch (error: any) {
      this.logger.error(`Failed to start poller for queue ${queueName}: ${error.message}`);
    }
  }

  private async pollQueue(queueConfig: QueueConfig, queueInfo: QueueInfo): Promise<void> {
    const { queueName, handler } = queueConfig;
    const pollerId = `${queueName}-${handler}`;
    const state = this.pollerStates.get(pollerId);

    if (!state || !state.isPolling) {
      return;
    }

    try {
      state.lastPollTime = new Date();
      
      const messages = await this.sqsClient.receiveMessages(
        queueInfo.queueUrl,
        queueConfig.batchSize || 1,
        queueConfig.visibilityTimeout || this.config.visibilityTimeout,
        queueConfig.waitTimeSeconds || this.config.waitTimeSeconds
      );

      if (messages.length === 0) {
        this.logger.debug(`No messages received from queue: ${queueName}`);
        return;
      }

      this.logger.debug(`Received ${messages.length} message(s) from queue: ${queueName}`);
      state.messageCount += messages.length;

      await this.processMessages(messages, queueConfig, queueInfo);
    } catch (error: any) {
      state.errorCount++;
      state.lastError = error.message;
      this.logger.error(`Error polling queue ${queueName}: ${error.message}`);
    }
  }

  private async processMessages(
    messages: Message[],
    queueConfig: QueueConfig,
    queueInfo: QueueInfo
  ): Promise<void> {
    const batchSize = queueConfig.batchSize || 1;
    const maxConcurrency = queueConfig.maxConcurrentPolls || this.config.maxConcurrentPolls;

    // Group messages into chunks of batchSize (matching AWS Lambda event batching)
    const chunks: Message[][] = [];
    for (let i = 0; i < messages.length; i += batchSize) {
      chunks.push(messages.slice(i, i + batchSize));
    }

    // Process chunks with concurrency limits
    for (let i = 0; i < chunks.length; i += maxConcurrency) {
      const concurrentChunks = chunks.slice(i, i + maxConcurrency);
      const promises = concurrentChunks.map(chunk => this.processBatch(chunk, queueConfig, queueInfo));

      await Promise.all(promises);
    }
  }

  private async processBatch(
    messages: Message[],
    queueConfig: QueueConfig,
    queueInfo: QueueInfo
  ): Promise<void> {
    const { queueName, handler } = queueConfig;
    const messageIds = messages.map(m => m.MessageId).join(', ');

    try {
      // Build SQS event with all messages in the batch
      const sqsEvent = this.eventBuilder.buildSQSEvent(messages, queueName);

      // Build function definition
      const functionDefinition: FunctionDefinition = {
        handler,
        timeout: this.config.lambdaTimeout,
      };

      // Invoke handler once for the entire batch
      const result: HandlerResult = await this.lambdaInvoker.invokeHandler(
        handler,
        sqsEvent,
        functionDefinition
      );

      if (result.success) {
        // Delete all messages in the batch on success
        const receiptHandles = messages.map(m => m.ReceiptHandle!);
        await this.sqsClient.deleteMessages(queueInfo.queueUrl, receiptHandles);
        this.logger.debug(`Successfully processed batch of ${messages.length} message(s) [${messageIds}] from queue: ${queueName}`);
      } else {
        // On failure, all messages in the batch fail together (AWS synchronous invocation behavior)
        for (const message of messages) {
          await this.handleMessageFailure(message, queueConfig, queueInfo, result.error);
        }
      }
    } catch (error: any) {
      this.logger.error(`Unexpected error processing batch [${messageIds}]: ${error.message}`);
      for (const message of messages) {
        await this.handleMessageFailure(message, queueConfig, queueInfo, error);
      }
    }
  }

  private async handleMessageFailure(
    message: Message,
    queueConfig: QueueConfig,
    queueInfo: QueueInfo,
    error?: Error
  ): Promise<void> {
    const receiveCount = parseInt(message.Attributes?.ApproximateReceiveCount || '1', 10);
    const maxReceiveCount = queueConfig.dlq?.maxReceiveCount || this.config.maxReceiveCount;

    this.logger.warn(
      `Message ${message.MessageId} failed processing (attempt ${receiveCount}/${maxReceiveCount}): ${error?.message || 'Unknown error'}`
    );

    // If max receive count reached and DLQ is enabled, send to DLQ
    if (receiveCount >= maxReceiveCount && queueConfig.dlq?.enabled) {
      try {
        const dlqName = queueConfig.dlq.queueName || `${queueConfig.queueName}${this.config.deadLetterQueueSuffix}`;
        const dlqInfo = await this.sqsClient.getQueueInfo(dlqName);
        
        if (dlqInfo) {
          // Send message to DLQ with original body preserved (matches real AWS redrive behavior)
          await this.sqsClient.sendMessage(dlqInfo.queueUrl, message.Body || '');

          // Delete original message — if this fails, the message may exist in both queues
          // temporarily, but it will eventually expire or be reprocessed from the source queue
          try {
            await this.sqsClient.deleteMessage(queueInfo.queueUrl, message.ReceiptHandle!);
          } catch (deleteError: any) {
            this.logger.warn(
              `Message ${message.MessageId} sent to DLQ but failed to delete from source queue: ${deleteError.message}`
            );
          }

          this.logger.info(`Moved message ${message.MessageId} to DLQ: ${dlqName}`);
        }
      } catch (dlqError: any) {
        this.logger.error(`Failed to send message to DLQ: ${dlqError.message}`);
      }
    }
  }

  stopPolling(): void {
    this.logger.info('Stopping all SQS pollers');

    for (const [pollerId, controller] of this.pollers.entries()) {
      controller.abort();
      const state = this.pollerStates.get(pollerId);
      if (state) {
        state.isPolling = false;
      }
      this.logger.debug(`Stopped poller: ${pollerId}`);
    }

    this.pollers.clear();
  }

  getPollerStates(): Map<string, PollerState> {
    return new Map(this.pollerStates);
  }

  isPolling(): boolean {
    return this.pollers.size > 0;
  }
}