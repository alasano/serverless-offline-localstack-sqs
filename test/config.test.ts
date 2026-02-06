import { validateConfig } from "../src/config/schema";
import { mergeConfig, defaultConfig } from "../src/config/defaults";

describe("Configuration", () => {
  describe("validateConfig", () => {
    it("should validate default configuration", () => {
      expect(() => validateConfig({})).not.toThrow();
    });

    it("should validate complete configuration", () => {
      const config = {
        enabled: true,
        endpoint: "http://localhost:4566",
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
        queues: [
          {
            queueName: "test-queue",
            handler: "handler.test",
            enabled: true,
            batchSize: 1,
            dlq: {
              enabled: true,
              maxReceiveCount: 3,
            },
          },
        ],
      };

      expect(() => validateConfig(config)).not.toThrow();
    });

    it("should reject invalid endpoint URL", () => {
      const config = {
        endpoint: "invalid-url",
      };

      expect(() => validateConfig(config)).toThrow(/Invalid plugin configuration/);
    });

    it("should reject invalid poll interval", () => {
      const config = {
        pollInterval: 50, // Below minimum of 100
      };

      expect(() => validateConfig(config)).toThrow(/Invalid plugin configuration/);
    });

    it("should reject invalid queue configuration", () => {
      const config = {
        queues: [
          {
            // Missing queueName and handler
            batchSize: 1,
          },
        ],
      };

      expect(() => validateConfig(config)).toThrow(/Invalid plugin configuration/);
    });
  });

  describe("mergeConfig", () => {
    it("should merge with default configuration", () => {
      const userConfig = {
        endpoint: "http://custom:4566",
        debug: true,
        queues: [
          {
            queueName: "custom-queue",
            handler: "handler.custom",
          },
        ],
      };

      const merged = mergeConfig(userConfig);

      expect(merged.endpoint).toBe("http://custom:4566");
      expect(merged.debug).toBe(true);
      expect(merged.region).toBe(defaultConfig.region);
      expect(merged.pollInterval).toBe(defaultConfig.pollInterval);
      expect(merged.queues).toHaveLength(1);
    });

    it("should handle empty user configuration", () => {
      const merged = mergeConfig({});

      expect(merged).toEqual(defaultConfig);
    });
  });
});
