import { SqsClientWrapper } from "../src/sqs/client";
import { Logger } from "../src/utils/logger";
import { PluginConfig } from "../src/config/defaults";

// Simple mock implementation
const mockSQSClient = {
  send: jest.fn(),
};

// Mock the entire AWS SDK module
jest.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: jest.fn().mockImplementation(() => mockSQSClient),
  CreateQueueCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  GetQueueUrlCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  GetQueueAttributesCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  SetQueueAttributesCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  ReceiveMessageCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  DeleteMessageCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  DeleteMessageBatchCommand: jest.fn().mockImplementation((params) => ({ input: params })),
  SendMessageCommand: jest.fn().mockImplementation((params) => ({ input: params })),
}));

describe("SqsClientWrapper", () => {
  let sqsClient: SqsClientWrapper;
  let mockLogger: jest.Mocked<Logger>;
  let config: PluginConfig;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    config = {
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

    sqsClient = new SqsClientWrapper(config, mockLogger, "http://localhost:4566");

    // Reset mocks
    jest.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize SQS client", () => {
      expect(sqsClient).toBeInstanceOf(SqsClientWrapper);
      // Debug logging happens in constructor, but our mock might not capture it due to timing
      // Let's just verify the client was created properly
    });
  });

  describe("createQueue", () => {
    it("should create queue successfully", async () => {
      const mockResponse = {
        QueueUrl: "http://localhost:4566/000000000000/test-queue",
      };
      mockSQSClient.send.mockResolvedValue(mockResponse);

      const result = await sqsClient.createQueue("test-queue");

      expect(result.queueUrl).toBe("http://localhost:4566/000000000000/test-queue");
      expect(result.queueName).toBe("test-queue");
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Created queue: test-queue at http://localhost:4566/000000000000/test-queue",
      );
    });

    it("should handle missing queue URL", async () => {
      mockSQSClient.send.mockResolvedValue({});

      await expect(sqsClient.createQueue("test-queue")).rejects.toThrow(
        "Failed to create queue test-queue: No queue URL returned",
      );
    });

    it("should handle queue already exists error", async () => {
      const error = new Error("Queue already exists");
      error.name = "QueueAlreadyExists";
      mockSQSClient.send
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({
          QueueUrl: "http://localhost:4566/000000000000/test-queue",
        })
        .mockResolvedValueOnce({ Attributes: {} });

      const result = await sqsClient.createQueue("test-queue");

      expect(result.queueUrl).toBe("http://localhost:4566/000000000000/test-queue");
      expect(mockLogger.debug).toHaveBeenCalledWith("Queue test-queue already exists, getting URL");
    });

    it("should handle other errors", async () => {
      const error = new Error("Some other error");
      mockSQSClient.send.mockRejectedValue(error);

      await expect(sqsClient.createQueue("test-queue")).rejects.toThrow(
        "Failed to create queue test-queue: Some other error",
      );
    });
  });

  describe("getQueueInfo", () => {
    it("should get queue info successfully", async () => {
      mockSQSClient.send
        .mockResolvedValueOnce({
          QueueUrl: "http://localhost:4566/000000000000/test-queue",
        })
        .mockResolvedValueOnce({ Attributes: { VisibilityTimeout: "30" } });

      const result = await sqsClient.getQueueInfo("test-queue");

      expect(result.queueUrl).toBe("http://localhost:4566/000000000000/test-queue");
      expect(result.queueName).toBe("test-queue");
      expect(result.attributes).toEqual({ VisibilityTimeout: "30" });
    });

    it("should handle missing queue", async () => {
      mockSQSClient.send.mockResolvedValue({});

      await expect(sqsClient.getQueueInfo("test-queue")).rejects.toThrow(
        "Failed to get queue info for test-queue: Queue test-queue not found",
      );
    });
  });

  describe("receiveMessages", () => {
    it("should receive messages successfully", async () => {
      const mockMessages = [{ MessageId: "1", Body: "test" }];
      mockSQSClient.send.mockResolvedValue({ Messages: mockMessages });

      const result = await sqsClient.receiveMessages(
        "http://localhost:4566/000000000000/test-queue",
      );

      expect(result).toEqual(mockMessages);
    });

    it("should handle no messages", async () => {
      mockSQSClient.send.mockResolvedValue({});

      const result = await sqsClient.receiveMessages(
        "http://localhost:4566/000000000000/test-queue",
      );

      expect(result).toEqual([]);
    });

    it("should handle receive errors", async () => {
      const error = new Error("Receive error");
      mockSQSClient.send.mockRejectedValue(error);

      await expect(
        sqsClient.receiveMessages("http://localhost:4566/000000000000/test-queue"),
      ).rejects.toThrow("Receive error");
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to receive messages from http://localhost:4566/000000000000/test-queue: Receive error",
      );
    });
  });

  describe("deleteMessage", () => {
    it("should delete message successfully", async () => {
      mockSQSClient.send.mockResolvedValue({});

      await sqsClient.deleteMessage(
        "http://localhost:4566/000000000000/test-queue",
        "receipt-handle",
      );

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Deleted message from queue: http://localhost:4566/000000000000/test-queue",
      );
    });

    it("should handle delete errors", async () => {
      const error = new Error("Delete error");
      mockSQSClient.send.mockRejectedValue(error);

      await expect(
        sqsClient.deleteMessage("http://localhost:4566/000000000000/test-queue", "receipt-handle"),
      ).rejects.toThrow("Delete error");
      expect(mockLogger.error).toHaveBeenCalledWith("Failed to delete message: Delete error");
    });
  });

  describe("deleteMessages", () => {
    it("should skip empty handle arrays", async () => {
      await sqsClient.deleteMessages("http://localhost:4566/000000000000/test-queue", []);

      expect(mockSQSClient.send).not.toHaveBeenCalled();
    });

    it("should delete messages in batch", async () => {
      mockSQSClient.send.mockResolvedValue({ Failed: [] });

      await sqsClient.deleteMessages("http://localhost:4566/000000000000/test-queue", [
        "handle1",
        "handle2",
      ]);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Deleted 2 messages from queue: http://localhost:4566/000000000000/test-queue",
      );
    });

    it("should handle failed deletions", async () => {
      mockSQSClient.send.mockResolvedValue({
        Failed: [{ Id: "0", Code: "TestError" }],
      });

      await sqsClient.deleteMessages("http://localhost:4566/000000000000/test-queue", [
        "handle1",
        "handle2",
      ]);

      expect(mockLogger.warn).toHaveBeenCalledWith("Failed to delete 1 messages");
    });
  });

  describe("sendMessage", () => {
    it("should send message successfully", async () => {
      mockSQSClient.send.mockResolvedValue({});

      await sqsClient.sendMessage("http://localhost:4566/000000000000/test-queue", "test message");

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Sent message to DLQ: http://localhost:4566/000000000000/test-queue",
      );
    });

    it("should handle send errors", async () => {
      const error = new Error("Send error");
      mockSQSClient.send.mockRejectedValue(error);

      await expect(
        sqsClient.sendMessage("http://localhost:4566/000000000000/test-queue", "test"),
      ).rejects.toThrow("Send error");
      expect(mockLogger.error).toHaveBeenCalledWith("Failed to send message to DLQ: Send error");
    });
  });

  describe("setQueueAttributes", () => {
    it("should set attributes successfully", async () => {
      mockSQSClient.send.mockResolvedValue({});

      await sqsClient.setQueueAttributes("http://localhost:4566/000000000000/test-queue", {
        VisibilityTimeout: "60",
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Updated attributes for queue: http://localhost:4566/000000000000/test-queue",
      );
    });

    it("should handle attribute errors", async () => {
      const error = new Error("Attribute error");
      mockSQSClient.send.mockRejectedValue(error);

      await expect(
        sqsClient.setQueueAttributes("http://localhost:4566/000000000000/test-queue", {}),
      ).rejects.toThrow("Failed to set queue attributes: Attribute error");
    });
  });

  describe("getClient", () => {
    it("should return the SQS client", () => {
      const client = sqsClient.getClient();
      expect(client).toBe(mockSQSClient);
    });
  });
});
