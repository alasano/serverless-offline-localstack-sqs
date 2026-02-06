import ServerlessOfflineLocalstackSqsPlugin from "../src/index";

// Mock all dependencies
jest.mock("../src/sqs/client");
jest.mock("../src/sqs/queue-manager");
jest.mock("../src/sqs/poller");
jest.mock("../src/lambda/invoker");
jest.mock("../src/utils/docker");

// Mock logger specifically
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.mock("../src/utils/logger", () => ({
  createLogger: jest.fn(() => mockLogger),
  ConsoleLogger: jest.fn(() => mockLogger),
}));

describe("ServerlessOfflineLocalstackSqsPlugin", () => {
  let serverlessInstance: any;
  let options: any;
  let plugin: ServerlessOfflineLocalstackSqsPlugin;

  beforeEach(() => {
    serverlessInstance = {
      service: {
        service: "test-service",
        provider: {
          name: "aws",
          region: "us-east-1",
          stage: "dev",
          runtime: "nodejs20.x",
        },
        functions: {
          testFunction: {
            handler: "handler.test",
            events: [
              {
                sqs: {
                  arn: "arn:aws:sqs:us-east-1:123456789012:test-queue",
                  batchSize: 1,
                },
              },
            ],
          },
        },
        resources: {
          Resources: {
            TestQueue: {
              Type: "AWS::SQS::Queue",
              Properties: {
                QueueName: "test-queue",
              },
            },
          },
        },
        custom: {
          "serverless-offline-localstack-sqs": {
            enabled: true,
            endpoint: "http://localhost:4566",
            debug: true,
          },
        },
      },
      config: {
        servicePath: "/test/service/path",
      },
      pluginManager: {
        addPlugin: jest.fn(),
      },
      cli: {
        log: jest.fn(),
      },
    };

    options = {
      stage: "dev",
      region: "us-east-1",
    };

    plugin = new ServerlessOfflineLocalstackSqsPlugin(serverlessInstance, options);
  });

  describe("constructor", () => {
    it("should initialize plugin with serverless instance and options", () => {
      expect(plugin).toBeInstanceOf(ServerlessOfflineLocalstackSqsPlugin);
    });

    it("should define hooks", () => {
      expect(plugin.hooks).toBeDefined();
      // Check for common Serverless hooks - exact hook names may vary
      expect(Object.keys(plugin.hooks).length).toBeGreaterThan(0);
    });

    it("should define commands", () => {
      expect(plugin.commands).toBeDefined();
      // Commands may be defined or undefined depending on configuration
    });
  });

  describe("plugin configuration", () => {
    it("should handle missing custom configuration", () => {
      const serverlessWithoutCustom = {
        ...serverlessInstance,
        service: {
          ...serverlessInstance.service,
          custom: undefined,
        },
      };

      const pluginWithDefaults = new ServerlessOfflineLocalstackSqsPlugin(
        serverlessWithoutCustom,
        options,
      );
      expect(pluginWithDefaults).toBeInstanceOf(ServerlessOfflineLocalstackSqsPlugin);
    });

    it("should handle missing functions", () => {
      const serverlessWithoutFunctions = {
        ...serverlessInstance,
        service: {
          ...serverlessInstance.service,
          functions: undefined,
        },
      };

      const pluginWithoutFunctions = new ServerlessOfflineLocalstackSqsPlugin(
        serverlessWithoutFunctions,
        options,
      );
      expect(pluginWithoutFunctions).toBeInstanceOf(ServerlessOfflineLocalstackSqsPlugin);
    });

    it("should handle missing resources", () => {
      const serverlessWithoutResources = {
        ...serverlessInstance,
        service: {
          ...serverlessInstance.service,
          resources: undefined,
        },
      };

      const pluginWithoutResources = new ServerlessOfflineLocalstackSqsPlugin(
        serverlessWithoutResources,
        options,
      );
      expect(pluginWithoutResources).toBeInstanceOf(ServerlessOfflineLocalstackSqsPlugin);
    });
  });

  describe("plugin disabled", () => {
    it("should handle disabled plugin", () => {
      const serverlessDisabled = {
        ...serverlessInstance,
        service: {
          ...serverlessInstance.service,
          custom: {
            "serverless-offline-localstack-sqs": {
              enabled: false,
            },
          },
        },
      };

      const disabledPlugin = new ServerlessOfflineLocalstackSqsPlugin(serverlessDisabled, options);
      expect(disabledPlugin).toBeInstanceOf(ServerlessOfflineLocalstackSqsPlugin);
    });
  });

  describe("error handling", () => {
    it("should handle invalid configuration gracefully", () => {
      const invalidServerless = {
        ...serverlessInstance,
        service: {
          ...serverlessInstance.service,
          custom: {
            "serverless-offline-localstack-sqs": {
              endpoint: "invalid-url",
              pollInterval: -1,
            },
          },
        },
      };

      // Should throw with validation error
      expect(() => new ServerlessOfflineLocalstackSqsPlugin(invalidServerless, options)).toThrow(
        "Invalid plugin configuration",
      );
    });

    it("should handle missing provider configuration", () => {
      const serverlessWithoutProvider = {
        ...serverlessInstance,
        service: {
          ...serverlessInstance.service,
          provider: undefined,
        },
      };

      expect(
        () => new ServerlessOfflineLocalstackSqsPlugin(serverlessWithoutProvider, options),
      ).not.toThrow();
    });
  });

  describe("AWS provider validation", () => {
    it("should handle non-AWS providers gracefully", () => {
      const nonAwsServerless = {
        ...serverlessInstance,
        service: {
          ...serverlessInstance.service,
          provider: {
            name: "azure",
            region: "us-east-1",
          },
        },
      };

      expect(
        () => new ServerlessOfflineLocalstackSqsPlugin(nonAwsServerless, options),
      ).not.toThrow();
    });
  });

  describe("SQS event parsing", () => {
    it("should handle functions with no events", () => {
      const serverlessNoEvents = {
        ...serverlessInstance,
        service: {
          ...serverlessInstance.service,
          functions: {
            noEventsFunction: {
              handler: "handler.test",
              // No events property
            },
          },
        },
      };

      const pluginNoEvents = new ServerlessOfflineLocalstackSqsPlugin(serverlessNoEvents, options);
      expect(pluginNoEvents).toBeInstanceOf(ServerlessOfflineLocalstackSqsPlugin);
    });

    it("should handle string function definitions", () => {
      const serverlessStringFunction = {
        ...serverlessInstance,
        service: {
          ...serverlessInstance.service,
          functions: {
            stringFunction: "handler.test", // String instead of object
          },
        },
      };

      const pluginStringFunction = new ServerlessOfflineLocalstackSqsPlugin(
        serverlessStringFunction,
        options,
      );
      expect(pluginStringFunction).toBeInstanceOf(ServerlessOfflineLocalstackSqsPlugin);
    });

    it("should handle SQS events with string ARN format", () => {
      const serverlessStringArn = {
        ...serverlessInstance,
        service: {
          ...serverlessInstance.service,
          functions: {
            testFunction: {
              handler: "handler.test",
              events: [
                {
                  sqs: "arn:aws:sqs:us-east-1:123456789012:test-queue-string",
                },
              ],
            },
          },
        },
      };

      const pluginStringArn = new ServerlessOfflineLocalstackSqsPlugin(
        serverlessStringArn,
        options,
      );
      expect(pluginStringArn).toBeInstanceOf(ServerlessOfflineLocalstackSqsPlugin);
    });

    it("should handle SQS events with queueName instead of arn", () => {
      const serverlessQueueName = {
        ...serverlessInstance,
        service: {
          ...serverlessInstance.service,
          functions: {
            testFunction: {
              handler: "handler.test",
              events: [
                {
                  sqs: {
                    queueName: "test-queue-name",
                    batchSize: 5,
                  },
                },
              ],
            },
          },
        },
      };

      const pluginQueueName = new ServerlessOfflineLocalstackSqsPlugin(
        serverlessQueueName,
        options,
      );
      expect(pluginQueueName).toBeInstanceOf(ServerlessOfflineLocalstackSqsPlugin);
    });

    it("should handle invalid SQS events", () => {
      const serverlessInvalidSqs = {
        ...serverlessInstance,
        service: {
          ...serverlessInstance.service,
          functions: {
            testFunction: {
              handler: "handler.test",
              events: [
                {
                  sqs: {
                    // Missing arn and queueName
                    batchSize: 5,
                  },
                },
              ],
            },
          },
        },
      };

      const pluginInvalidSqs = new ServerlessOfflineLocalstackSqsPlugin(
        serverlessInvalidSqs,
        options,
      );
      expect(pluginInvalidSqs).toBeInstanceOf(ServerlessOfflineLocalstackSqsPlugin);
    });

    it("should handle unsupported SQS event formats", () => {
      const serverlessUnsupportedSqs = {
        ...serverlessInstance,
        service: {
          ...serverlessInstance.service,
          functions: {
            testFunction: {
              handler: "handler.test",
              events: [
                {
                  sqs: 123, // Number instead of string or object
                },
              ],
            },
          },
        },
      };

      const pluginUnsupportedSqs = new ServerlessOfflineLocalstackSqsPlugin(
        serverlessUnsupportedSqs,
        options,
      );
      expect(pluginUnsupportedSqs).toBeInstanceOf(ServerlessOfflineLocalstackSqsPlugin);
    });

    it("should handle malformed function definitions that cause parsing errors", () => {
      const serverlessMalformed = {
        ...serverlessInstance,
        service: {
          ...serverlessInstance.service,
          functions: {
            testFunction: {
              handler: "handler.test",
              events: [
                {
                  sqs: {
                    get arn() {
                      throw new Error("Getter error");
                    },
                  },
                },
              ],
            },
          },
        },
      };

      const pluginMalformed = new ServerlessOfflineLocalstackSqsPlugin(
        serverlessMalformed,
        options,
      );
      expect(pluginMalformed).toBeInstanceOf(ServerlessOfflineLocalstackSqsPlugin);
    });
  });
});
