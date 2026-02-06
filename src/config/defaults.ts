export interface PluginConfig {
  enabled: boolean;
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  autoCreate: boolean;
  pollInterval: number;
  maxConcurrentPolls: number;
  visibilityTimeout: number;
  waitTimeSeconds: number;
  maxReceiveCount: number;
  deadLetterQueueSuffix: string;
  debug: boolean;
  skipCacheInvalidation: boolean;
  lambdaTimeout: number;
  queues: QueueConfig[];
}

export interface QueueConfig {
  queueName: string;
  handler: string;
  enabled?: boolean;
  batchSize?: number;
  maxConcurrentPolls?: number;
  visibilityTimeout?: number;
  waitTimeSeconds?: number;
  dlq?: {
    enabled: boolean;
    maxReceiveCount?: number;
    queueName?: string;
  };
}

export const defaultConfig: PluginConfig = {
  enabled: true,
  region: "us-east-1",
  accessKeyId: "test",
  secretAccessKey: "test",
  autoCreate: true,
  pollInterval: 1000,
  maxConcurrentPolls: 3,
  visibilityTimeout: 30,
  waitTimeSeconds: 20,
  maxReceiveCount: 3,
  deadLetterQueueSuffix: "-dlq",
  debug: false,
  skipCacheInvalidation: false,
  lambdaTimeout: 30000,
  queues: [],
};

export const mergeConfig = (userConfig: Partial<PluginConfig>): PluginConfig => {
  return {
    ...defaultConfig,
    ...userConfig,
    queues: userConfig.queues || [],
  };
};
