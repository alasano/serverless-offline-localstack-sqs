import { Message } from "@aws-sdk/client-sqs";

export interface SQSRecord {
  messageId: string;
  receiptHandle: string;
  body: string;
  attributes: Record<string, string>;
  messageAttributes: Record<string, any>;
  md5OfBody: string;
  md5OfMessageAttributes?: string;
  eventSource: string;
  eventSourceARN: string;
  awsRegion: string;
}

export interface SQSEvent {
  Records: SQSRecord[];
}

export interface LambdaContext {
  callbackWaitsForEmptyEventLoop: boolean;
  functionName: string;
  functionVersion: string;
  invokedFunctionArn: string;
  memoryLimitInMB: string;
  awsRequestId: string;
  logGroupName: string;
  logStreamName: string;
  identity?: any;
  clientContext?: any;
  getRemainingTimeInMillis(): number;
  done(error?: Error, result?: any): void;
  fail(error: Error | string): void;
  succeed(messageOrObject: any): void;
}

export class EventBuilder {
  private region: string;
  private accountId: string;

  constructor(region: string, accountId = "000000000000") {
    this.region = region;
    this.accountId = accountId;
  }

  buildSQSEvent(messages: Message[], queueName: string): SQSEvent {
    const records: SQSRecord[] = messages.map((message) => ({
      messageId: message.MessageId!,
      receiptHandle: message.ReceiptHandle!,
      body: message.Body!,
      attributes: {
        ApproximateReceiveCount: message.Attributes?.ApproximateReceiveCount || "1",
        SentTimestamp: message.Attributes?.SentTimestamp || Date.now().toString(),
        SenderId: message.Attributes?.SenderId || "AIDAIENQZJOLO23YVJ4VO",
        ApproximateFirstReceiveTimestamp:
          message.Attributes?.ApproximateFirstReceiveTimestamp || Date.now().toString(),
        ...message.Attributes,
      },
      messageAttributes: this.formatMessageAttributes(message.MessageAttributes || {}),
      md5OfBody: message.MD5OfBody || this.calculateMD5(message.Body!),
      ...(message.MD5OfMessageAttributes
        ? { md5OfMessageAttributes: message.MD5OfMessageAttributes }
        : {}),
      eventSource: "aws:sqs",
      eventSourceARN: this.buildQueueArn(queueName),
      awsRegion: this.region,
    }));

    return { Records: records };
  }

  buildLambdaContext(functionName: string, timeout: number): LambdaContext {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    return {
      callbackWaitsForEmptyEventLoop: true,
      functionName,
      functionVersion: "$LATEST",
      invokedFunctionArn: `arn:aws:lambda:${this.region}:${this.accountId}:function:${functionName}`,
      memoryLimitInMB: "1024",
      awsRequestId: requestId,
      logGroupName: `/aws/lambda/${functionName}`,
      logStreamName: `${new Date().toISOString().split("T")[0].replace(/-/g, "/")}/[$LATEST]${this.generateLogStreamSuffix()}`,
      getRemainingTimeInMillis: () => Math.max(0, timeout - (Date.now() - startTime)),
      done: (error?: Error, result?: any) => {
        if (error) throw error;
        return result;
      },
      fail: (error: Error | string) => {
        throw error instanceof Error ? error : new Error(error);
      },
      succeed: (result: any) => result,
    };
  }

  private formatMessageAttributes(attributes: Record<string, any>): Record<string, any> {
    const formatted: Record<string, any> = {};

    for (const [key, value] of Object.entries(attributes)) {
      if (value && typeof value === "object") {
        formatted[key] = {
          stringValue: value.StringValue,
          binaryValue: value.BinaryValue,
          stringListValues: value.StringListValues,
          binaryListValues: value.BinaryListValues,
          dataType: value.DataType || "String",
        };
      } else {
        formatted[key] = {
          stringValue: String(value),
          dataType: "String",
        };
      }
    }

    return formatted;
  }

  private buildQueueArn(queueName: string): string {
    return `arn:aws:sqs:${this.region}:${this.accountId}:${queueName}`;
  }

  private calculateMD5(body: string): string {
    // Simple MD5 placeholder - in a real implementation, you'd use crypto

    const crypto = require("crypto");
    return crypto.createHash("md5").update(body).digest("hex");
  }

  private generateRequestId(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private generateLogStreamSuffix(): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
