import Joi from "joi";

const queueConfigSchema = Joi.object({
  queueName: Joi.string().required(),
  handler: Joi.string().required(),
  enabled: Joi.boolean().default(true),
  batchSize: Joi.number().integer().min(1).max(10).default(1),
  maxConcurrentPolls: Joi.number().integer().min(1).default(3),
  visibilityTimeout: Joi.number().integer().min(0).max(43200).default(30),
  waitTimeSeconds: Joi.number().integer().min(0).max(20).default(20),
  dlq: Joi.object({
    enabled: Joi.boolean().required(),
    maxReceiveCount: Joi.number().integer().min(1).default(3),
    queueName: Joi.string().optional(),
  }).optional(),
});

export const configSchema = Joi.object({
  enabled: Joi.boolean().default(true),
  endpoint: Joi.string().uri().optional(),
  region: Joi.string().default("us-east-1"),
  accessKeyId: Joi.string().default("test"),
  secretAccessKey: Joi.string().default("test"),
  autoCreate: Joi.boolean().default(true),
  pollInterval: Joi.number().integer().min(100).default(1000),
  maxConcurrentPolls: Joi.number().integer().min(1).default(3),
  visibilityTimeout: Joi.number().integer().min(0).max(43200).default(30),
  waitTimeSeconds: Joi.number().integer().min(0).max(20).default(20),
  maxReceiveCount: Joi.number().integer().min(1).default(3),
  deadLetterQueueSuffix: Joi.string().default("-dlq"),
  debug: Joi.boolean().default(false),
  skipCacheInvalidation: Joi.boolean().default(false),
  // lambdaTimeout is in milliseconds (e.g., 30000 = 30 seconds)
  lambdaTimeout: Joi.number().integer().min(1000).max(900000).default(30000),
  queues: Joi.array().items(queueConfigSchema).default([]),
});

export const validateConfig = (config: any) => {
  const { error, value } = configSchema.validate(config, {
    allowUnknown: true,
    stripUnknown: true,
  });

  if (error) {
    throw new Error(
      `Invalid plugin configuration: ${error.details.map((d) => d.message).join(", ")}`,
    );
  }

  return value;
};
