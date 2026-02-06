import {
  SQSClient,
  CreateQueueCommand,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
  SetQueueAttributesCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
  SendMessageCommand,
  Message,
} from '@aws-sdk/client-sqs';
import { Logger } from '../utils/logger';
import { PluginConfig } from '../config/defaults';

export interface QueueInfo {
  queueUrl: string;
  queueName: string;
  attributes?: Record<string, string>;
}

export class SqsClientWrapper {
  private client: SQSClient;
  private logger: Logger;
  private config: PluginConfig;

  constructor(config: PluginConfig, logger: Logger, endpoint?: string) {
    this.config = config;
    this.logger = logger;
    
    const clientConfig: any = {
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true, // Required for LocalStack
    };

    if (endpoint) {
      clientConfig.endpoint = endpoint;
    }

    this.client = new SQSClient(clientConfig);
    this.logger.debug(`SQS Client initialized with endpoint: ${endpoint || 'default'}`);
  }

  async createQueue(queueName: string, attributes?: Record<string, string>): Promise<QueueInfo> {
    try {
      this.logger.debug(`Creating queue: ${queueName}`);
      
      const command = new CreateQueueCommand({
        QueueName: queueName,
        Attributes: attributes,
      });

      const response = await this.client.send(command);
      
      if (!response.QueueUrl) {
        throw new Error(`Failed to create queue ${queueName}: No queue URL returned`);
      }

      this.logger.info(`Created queue: ${queueName} at ${response.QueueUrl}`);
      
      return {
        queueUrl: response.QueueUrl,
        queueName,
        attributes,
      };
    } catch (error: any) {
      if (error.name === 'QueueAlreadyExists') {
        this.logger.debug(`Queue ${queueName} already exists, getting URL`);
        return this.getQueueInfo(queueName);
      }
      throw new Error(`Failed to create queue ${queueName}: ${error.message}`);
    }
  }

  async getQueueInfo(queueName: string): Promise<QueueInfo> {
    try {
      const urlCommand = new GetQueueUrlCommand({ QueueName: queueName });
      const urlResponse = await this.client.send(urlCommand);
      
      if (!urlResponse.QueueUrl) {
        throw new Error(`Queue ${queueName} not found`);
      }

      const attrsCommand = new GetQueueAttributesCommand({
        QueueUrl: urlResponse.QueueUrl,
        AttributeNames: ['All'],
      });
      
      const attrsResponse = await this.client.send(attrsCommand);

      return {
        queueUrl: urlResponse.QueueUrl,
        queueName,
        attributes: attrsResponse.Attributes,
      };
    } catch (error: any) {
      throw new Error(`Failed to get queue info for ${queueName}: ${error.message}`);
    }
  }

  async setQueueAttributes(queueUrl: string, attributes: Record<string, string>): Promise<void> {
    try {
      const command = new SetQueueAttributesCommand({
        QueueUrl: queueUrl,
        Attributes: attributes,
      });

      await this.client.send(command);
      this.logger.debug(`Updated attributes for queue: ${queueUrl}`);
    } catch (error: any) {
      throw new Error(`Failed to set queue attributes: ${error.message}`);
    }
  }

  async receiveMessages(
    queueUrl: string,
    maxMessages = 1,
    visibilityTimeout = 30,
    waitTimeSeconds = 20
  ): Promise<Message[]> {
    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: maxMessages,
        VisibilityTimeout: visibilityTimeout,
        WaitTimeSeconds: waitTimeSeconds,
        AttributeNames: ['All'],
        MessageAttributeNames: ['All'],
      });

      const response = await this.client.send(command);
      return response.Messages || [];
    } catch (error: any) {
      this.logger.error(`Failed to receive messages from ${queueUrl}: ${error.message}`);
      throw error;
    }
  }

  async deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
    try {
      const command = new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      });

      await this.client.send(command);
      this.logger.debug(`Deleted message from queue: ${queueUrl}`);
    } catch (error: any) {
      this.logger.error(`Failed to delete message: ${error.message}`);
      throw error;
    }
  }

  async deleteMessages(queueUrl: string, receiptHandles: string[]): Promise<void> {
    if (receiptHandles.length === 0) return;

    try {
      const entries = receiptHandles.map((handle, index) => ({
        Id: index.toString(),
        ReceiptHandle: handle,
      }));

      const command = new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: entries,
      });

      const response = await this.client.send(command);
      
      if (response.Failed && response.Failed.length > 0) {
        this.logger.warn(`Failed to delete ${response.Failed.length} messages`);
      }

      this.logger.debug(`Deleted ${receiptHandles.length} messages from queue: ${queueUrl}`);
    } catch (error: any) {
      this.logger.error(`Failed to delete messages: ${error.message}`);
      throw error;
    }
  }

  async sendMessage(queueUrl: string, messageBody: string, attributes?: Record<string, any>): Promise<void> {
    try {
      const command = new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: messageBody,
        MessageAttributes: attributes,
      });

      await this.client.send(command);
      this.logger.debug(`Sent message to DLQ: ${queueUrl}`);
    } catch (error: any) {
      this.logger.error(`Failed to send message to DLQ: ${error.message}`);
      throw error;
    }
  }

  getClient(): SQSClient {
    return this.client;
  }
}