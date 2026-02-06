import { QueueManager } from '../src/sqs/queue-manager';
import { SqsClientWrapper } from '../src/sqs/client';
import { Logger } from '../src/utils/logger';
import { PluginConfig } from '../src/config/defaults';

describe('QueueManager - Webhook Configuration', () => {
  let queueManager: QueueManager;
  let mockSqsClient: jest.Mocked<SqsClientWrapper>;
  let mockLogger: jest.Mocked<Logger>;
  let config: PluginConfig;

  beforeEach(() => {
    mockSqsClient = {
      createQueue: jest.fn(),
      getQueueInfo: jest.fn(),
      setQueueAttributes: jest.fn(),
      receiveMessages: jest.fn(),
      deleteMessage: jest.fn(),
      deleteMessages: jest.fn(),
      sendMessage: jest.fn(),
      getClient: jest.fn(),
    } as any;

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;

    config = {
      enabled: true,
      endpoint: 'http://localhost:4566',
      region: 'us-east-1',
      accessKeyId: 'test',
      secretAccessKey: 'test',
      autoCreate: true,
      pollInterval: 1000,
      maxConcurrentPolls: 3,
      visibilityTimeout: 30,
      waitTimeSeconds: 20,
      maxReceiveCount: 3,
      deadLetterQueueSuffix: '-dlq',
      debug: false,
      skipCacheInvalidation: false,
      lambdaTimeout: 30000,
      queues: [],
    };

    queueManager = new QueueManager(mockSqsClient, config, mockLogger);

    mockSqsClient.createQueue.mockResolvedValue({
      queueUrl: 'http://localhost:4566/000000000000/test-queue',
      queueName: 'test-queue',
    });
  });

  describe('Real webhook serverless.yml configuration', () => {
    it('should handle CloudFormation resources with Fn::GetAtt deadLetterTargetArn', async () => {
      // Simulate the exact CloudFormation configuration from webhooks-serverless.yml
      const cloudFormationResources = {
        WebhookEventsQueue: {
          Type: 'AWS::SQS::Queue',
          Properties: {
            QueueName: 'wetrained-webhook-events-local.fifo',
            FifoQueue: true,
            ContentBasedDeduplication: false,
            DeduplicationScope: 'queue',
            FifoThroughputLimit: 'perQueue',
            VisibilityTimeout: 300,
            MessageRetentionPeriod: 1209600,
            ReceiveMessageWaitTimeSeconds: 20,
            RedrivePolicy: {
              deadLetterTargetArn: {
                'Fn::GetAtt': ['WebhookEventsDLQ', 'Arn']
              },
              maxReceiveCount: 3
            }
          }
        },
        WebhookEventsDLQ: {
          Type: 'AWS::SQS::Queue',
          Properties: {
            QueueName: 'wetrained-webhook-events-dlq-local.fifo',
            FifoQueue: true,
            ContentBasedDeduplication: false,
            DeduplicationScope: 'queue',
            FifoThroughputLimit: 'perQueue',
            VisibilityTimeout: 300,
            MessageRetentionPeriod: 1209600
          }
        }
      };

      // This should not throw the TypeError we were experiencing
      await expect(queueManager.createQueuesFromCloudFormation(cloudFormationResources))
        .resolves.not.toThrow();

      // Verify that queues were created with .fifo suffix preserved
      expect(mockSqsClient.createQueue).toHaveBeenCalledWith(
        'wetrained-webhook-events-local.fifo',
        expect.objectContaining({
          VisibilityTimeout: '300',
          ReceiveMessageWaitTimeSeconds: '20',
          MessageRetentionPeriod: '1209600',
          FifoQueue: 'true',
          ContentBasedDeduplication: 'false',
          DeduplicationScope: 'queue',
          FifoThroughputLimit: 'perQueue'
        })
      );

      expect(mockSqsClient.createQueue).toHaveBeenCalledWith(
        'wetrained-webhook-events-dlq-local.fifo',
        expect.objectContaining({
          VisibilityTimeout: '300',
          MessageRetentionPeriod: '1209600',
          FifoQueue: 'true',
          ContentBasedDeduplication: 'false',
          DeduplicationScope: 'queue',
          FifoThroughputLimit: 'perQueue'
        })
      );

      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should handle string deadLetterTargetArn correctly', async () => {
      const cloudFormationResources = {
        TestQueue: {
          Type: 'AWS::SQS::Queue',
          Properties: {
            QueueName: 'test-queue',
            RedrivePolicy: {
              deadLetterTargetArn: 'arn:aws:sqs:us-east-1:123456789012:test-dlq',
              maxReceiveCount: 3
            }
          }
        }
      };

      await queueManager.createQueuesFromCloudFormation(cloudFormationResources);

      // The DLQ is not automatically created when deadLetterTargetArn is a string (existing ARN)
      // Only the main queue should be created
      expect(mockSqsClient.createQueue).toHaveBeenCalledWith(
        'test-queue',
        expect.objectContaining({
          RedrivePolicy: expect.stringContaining('test-dlq')
        })
      );
    });

    it('should sanitize queue names with invalid characters', async () => {
      const testCases = [
        {
          input: 'wetrained-webhook-events-local.fifo',
          expected: 'wetrained-webhook-events-local.fifo'
        },
        {
          input: 'queue.with.dots.and@symbols!',
          expected: 'queue-with-dots-and-symbols'
        },
        {
          input: 'a'.repeat(100), // Too long
          expected: 'a'.repeat(80)
        },
        {
          input: 'queue-with-trailing-dots...',
          expected: 'queue-with-trailing-dots'
        },
        {
          input: '@#$%^&*()',
          expected: 'queue' // fallback for all invalid chars
        }
      ];

      for (const testCase of testCases) {
        const cloudFormationResources = {
          TestQueue: {
            Type: 'AWS::SQS::Queue',
            Properties: {
              QueueName: testCase.input
            }
          }
        };

        await queueManager.createQueuesFromCloudFormation(cloudFormationResources);

        expect(mockSqsClient.createQueue).toHaveBeenCalledWith(
          testCase.expected,
          expect.any(Object)
        );

        // Reset mock for next iteration
        mockSqsClient.createQueue.mockClear();
      }
    });

    it('should handle non-string deadLetterTargetArn without throwing TypeError', async () => {
      const cloudFormationResources = {
        TestQueue: {
          Type: 'AWS::SQS::Queue',
          Properties: {
            QueueName: 'test-queue',
            RedrivePolicy: {
              deadLetterTargetArn: {
                'Fn::GetAtt': ['DLQ', 'Arn']
              },
              maxReceiveCount: 3
            }
          }
        }
      };

      // This should not throw a TypeError
      await expect(queueManager.createQueuesFromCloudFormation(cloudFormationResources))
        .resolves.not.toThrow();

      expect(mockSqsClient.createQueue).toHaveBeenCalledWith(
        'test-queue',
        expect.objectContaining({
          RedrivePolicy: expect.stringMatching(/deadLetterTargetArn.*maxReceiveCount/)
        })
      );
    });

    it('should handle null or undefined deadLetterTargetArn', async () => {
      const cloudFormationResources = {
        TestQueue1: {
          Type: 'AWS::SQS::Queue',
          Properties: {
            QueueName: 'test-queue-1',
            RedrivePolicy: {
              deadLetterTargetArn: null,
              maxReceiveCount: 3
            }
          }
        },
        TestQueue2: {
          Type: 'AWS::SQS::Queue',
          Properties: {
            QueueName: 'test-queue-2',
            RedrivePolicy: {
              deadLetterTargetArn: undefined,
              maxReceiveCount: 3
            }
          }
        }
      };

      await expect(queueManager.createQueuesFromCloudFormation(cloudFormationResources))
        .resolves.not.toThrow();

      expect(mockSqsClient.createQueue).toHaveBeenCalledWith('test-queue-1', expect.any(Object));
      expect(mockSqsClient.createQueue).toHaveBeenCalledWith('test-queue-2', expect.any(Object));
    });
  });
});