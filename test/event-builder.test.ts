import { EventBuilder } from "../src/lambda/event-builder";
import { Message } from "@aws-sdk/client-sqs";

describe("EventBuilder", () => {
  let eventBuilder: EventBuilder;

  beforeEach(() => {
    eventBuilder = new EventBuilder("us-east-1", "123456789012");
  });

  describe("buildSQSEvent", () => {
    it("should build SQS event from messages", () => {
      const messages: Message[] = [
        {
          MessageId: "msg-123",
          ReceiptHandle: "handle-123",
          Body: JSON.stringify({ test: "data" }),
          Attributes: {
            ApproximateReceiveCount: "1",
            SentTimestamp: "1234567890000",
          },
          MessageAttributes: {
            customAttribute: {
              StringValue: "test-value",
              DataType: "String",
            },
          },
          MD5OfBody: "test-md5",
        },
      ];

      const event = eventBuilder.buildSQSEvent(messages, "test-queue");

      expect(event.Records).toHaveLength(1);
      expect(event.Records[0]).toMatchObject({
        messageId: "msg-123",
        receiptHandle: "handle-123",
        body: JSON.stringify({ test: "data" }),
        eventSource: "aws:sqs",
        eventSourceARN: "arn:aws:sqs:us-east-1:123456789012:test-queue",
        awsRegion: "us-east-1",
      });
      expect(event.Records[0].attributes).toMatchObject({
        ApproximateReceiveCount: "1",
        SentTimestamp: "1234567890000",
      });
      expect(event.Records[0].messageAttributes).toHaveProperty("customAttribute");
    });

    it("should handle messages without attributes", () => {
      const messages: Message[] = [
        {
          MessageId: "msg-456",
          ReceiptHandle: "handle-456",
          Body: "simple message",
        },
      ];

      const event = eventBuilder.buildSQSEvent(messages, "simple-queue");

      expect(event.Records).toHaveLength(1);
      expect(event.Records[0].attributes.ApproximateReceiveCount).toBe("1");
      expect(event.Records[0].messageAttributes).toEqual({});
    });

    it("should handle multiple messages", () => {
      const messages: Message[] = [
        {
          MessageId: "msg-1",
          ReceiptHandle: "handle-1",
          Body: "message 1",
        },
        {
          MessageId: "msg-2",
          ReceiptHandle: "handle-2",
          Body: "message 2",
        },
      ];

      const event = eventBuilder.buildSQSEvent(messages, "batch-queue");

      expect(event.Records).toHaveLength(2);
      expect(event.Records[0].messageId).toBe("msg-1");
      expect(event.Records[1].messageId).toBe("msg-2");
    });
  });

  describe("buildLambdaContext", () => {
    it("should build Lambda context", () => {
      const context = eventBuilder.buildLambdaContext("test-function", 30000);

      expect(context.functionName).toBe("test-function");
      expect(context.functionVersion).toBe("$LATEST");
      expect(context.invokedFunctionArn).toBe(
        "arn:aws:lambda:us-east-1:123456789012:function:test-function",
      );
      expect(context.memoryLimitInMB).toBe("1024");
      expect(context.logGroupName).toBe("/aws/lambda/test-function");
      expect(context.awsRequestId).toBeTruthy();
      expect(typeof context.getRemainingTimeInMillis).toBe("function");
    });

    it("should track remaining time correctly", (done) => {
      const context = eventBuilder.buildLambdaContext("test-function", 1000);
      const initialTime = context.getRemainingTimeInMillis();

      setTimeout(() => {
        const laterTime = context.getRemainingTimeInMillis();
        expect(laterTime).toBeLessThan(initialTime);
        expect(laterTime).toBeGreaterThan(0);
        done();
      }, 100);
    });

    it("should handle context methods", () => {
      const context = eventBuilder.buildLambdaContext("test-function", 30000);

      expect(() => context.succeed("test")).not.toThrow();
      expect(() => context.done()).not.toThrow();
      expect(() => context.fail("error")).toThrow("error");
    });
  });
});
