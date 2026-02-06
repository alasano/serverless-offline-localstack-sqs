import { ConsoleLogger, createLogger, Logger } from "../src/utils/logger";

describe("ConsoleLogger", () => {
  let logger: Logger;
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("with debug enabled", () => {
    beforeEach(() => {
      logger = new ConsoleLogger("[test]", true);
    });

    it("should log info messages", () => {
      logger.info("Test info message");
      expect(consoleLogSpy).toHaveBeenCalledWith("[test] Test info message");
    });

    it("should log debug messages when debug is enabled", () => {
      logger.debug("Test debug message");
      expect(consoleLogSpy).toHaveBeenCalledWith("[test] 🐛 Test debug message");
    });

    it("should log warn messages", () => {
      logger.warn("Test warning message");
      expect(consoleWarnSpy).toHaveBeenCalledWith("[test] ⚠️  Test warning message");
    });

    it("should log error messages", () => {
      logger.error("Test error message");
      expect(consoleErrorSpy).toHaveBeenCalledWith("[test] ❌ Test error message");
    });

    it("should handle multiple arguments", () => {
      logger.info("Message", { data: "test" }, 123);
      expect(consoleLogSpy).toHaveBeenCalledWith("[test] Message", { data: "test" }, 123);
    });
  });

  describe("with debug disabled", () => {
    beforeEach(() => {
      logger = new ConsoleLogger("[test]", false);
    });

    it("should log info messages", () => {
      logger.info("Test info message");
      expect(consoleLogSpy).toHaveBeenCalledWith("[test] Test info message");
    });

    it("should not log debug messages when debug is disabled", () => {
      logger.debug("Test debug message");
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("should log warn messages", () => {
      logger.warn("Test warning message");
      expect(consoleWarnSpy).toHaveBeenCalledWith("[test] ⚠️  Test warning message");
    });

    it("should log error messages", () => {
      logger.error("Test error message");
      expect(consoleErrorSpy).toHaveBeenCalledWith("[test] ❌ Test error message");
    });
  });

  describe("default constructor", () => {
    beforeEach(() => {
      logger = new ConsoleLogger("[test]");
    });

    it("should not log debug messages by default", () => {
      logger.debug("Test debug message");
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("should log other messages", () => {
      logger.info("Test info message");
      expect(consoleLogSpy).toHaveBeenCalledWith("[test] Test info message");
    });
  });

  describe("createLogger", () => {
    it("should create a logger with default settings", () => {
      const logger = createLogger();
      expect(logger).toBeDefined();
    });

    it("should create a logger with custom prefix and debug", () => {
      const logger = createLogger("[custom]", true);
      expect(logger).toBeDefined();
    });
  });
});
