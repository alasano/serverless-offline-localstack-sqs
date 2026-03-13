import { resolve } from "path";
import { LambdaInvoker } from "../src/lambda/invoker";
import { defaultConfig } from "../src/config/defaults";
import { createLogger } from "../src/utils/logger";

const fixturesDir = resolve(__dirname, "fixtures");
const logger = createLogger("[test]", false);

function buildSqsEvent() {
  return {
    Records: [
      {
        messageId: "test-id",
        receiptHandle: "test-handle",
        body: "{}",
        attributes: {
          ApproximateReceiveCount: "1",
          SentTimestamp: Date.now().toString(),
          SenderId: "test",
          ApproximateFirstReceiveTimestamp: Date.now().toString(),
        },
        messageAttributes: {},
        md5OfBody: "d41d8cd98f00b204e9800998ecf8427e",
        eventSource: "aws:sqs",
        eventSourceARN: "arn:aws:sqs:us-east-1:000000000000:test-queue",
        awsRegion: "us-east-1",
      },
    ],
  };
}

describe("LambdaInvoker environment variables", () => {
  let invoker: LambdaInvoker;

  beforeEach(() => {
    invoker = new LambdaInvoker(fixturesDir, defaultConfig, logger);
  });

  afterEach(() => {
    // Clean up any leaked env vars
    delete process.env.TEST_SQS_VAR_A;
    delete process.env.TEST_SQS_VAR_B;
    delete process.env.TEST_SQS_PREEXISTING;
  });

  it("should set environment variables before handler execution", async () => {
    const result = await invoker.invokeHandler("env-handler.handler", buildSqsEvent(), {
      handler: "env-handler.handler",
      environment: {
        TEST_SQS_VAR_A: "value-a",
        TEST_SQS_VAR_B: "value-b",
      },
    });

    expect(result.success).toBe(true);
    expect(result.result.capturedEnv.TEST_SQS_VAR_A).toBe("value-a");
    expect(result.result.capturedEnv.TEST_SQS_VAR_B).toBe("value-b");
  });

  it("should restore process.env after successful handler execution", async () => {
    expect(process.env.TEST_SQS_VAR_A).toBeUndefined();

    await invoker.invokeHandler("env-handler.handler", buildSqsEvent(), {
      handler: "env-handler.handler",
      environment: { TEST_SQS_VAR_A: "temporary" },
    });

    expect(process.env.TEST_SQS_VAR_A).toBeUndefined();
  });

  it("should restore process.env after handler failure", async () => {
    expect(process.env.TEST_SQS_VAR_A).toBeUndefined();

    const result = await invoker.invokeHandler("env-handler.failingHandler", buildSqsEvent(), {
      handler: "env-handler.failingHandler",
      environment: { TEST_SQS_VAR_A: "temporary" },
    });

    expect(result.success).toBe(false);
    expect(process.env.TEST_SQS_VAR_A).toBeUndefined();
  });

  it("should preserve pre-existing env vars and restore them after invocation", async () => {
    process.env.TEST_SQS_PREEXISTING = "original";

    await invoker.invokeHandler("env-handler.handler", buildSqsEvent(), {
      handler: "env-handler.handler",
      environment: { TEST_SQS_PREEXISTING: "overridden" },
    });

    expect(process.env.TEST_SQS_PREEXISTING).toBe("original");
  });

  it("should work unchanged when no environment is provided", async () => {
    const result = await invoker.invokeHandler("env-handler.handler", buildSqsEvent(), {
      handler: "env-handler.handler",
    });

    expect(result.success).toBe(true);
    expect(result.result.capturedEnv.TEST_SQS_VAR_A).toBeUndefined();
  });
});
