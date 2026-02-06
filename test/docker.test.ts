import { DockerDetector } from "../src/utils/docker";

// Mock dockerode to avoid actual Docker calls in tests
jest.mock("dockerode");

// Mock child_process
jest.mock("child_process", () => ({
  exec: jest.fn(),
}));

describe("DockerDetector", () => {
  let dockerDetector: DockerDetector;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    dockerDetector = new DockerDetector(mockLogger);
  });

  describe("getEndpointUrl", () => {
    it("should return custom endpoint when provided", async () => {
      const customEndpoint = "http://custom:4566";
      const result = await dockerDetector.getEndpointUrl(customEndpoint);

      expect(result).toBe(customEndpoint);
    });

    it("should return default endpoint when Docker is not available", async () => {
      // Mock Docker detection methods
      jest.spyOn(dockerDetector as any, "detectDocker").mockResolvedValue({
        isRunning: false,
        isDockerDesktop: false,
        host: "localhost",
        port: 4566,
      });

      const result = await dockerDetector.getEndpointUrl();

      expect(result).toBe("http://localhost:4566");
    });

    it("should return Docker internal host when running inside container", async () => {
      jest.spyOn(dockerDetector as any, "detectDocker").mockResolvedValue({
        isRunning: true,
        isDockerDesktop: false,
        host: "localstack",
        port: 4566,
      });

      const result = await dockerDetector.getEndpointUrl();

      expect(result).toBe("http://localstack:4566");
    });
  });

  describe("detectDocker", () => {
    beforeEach(() => {
      // Reset all method mocks
      jest.clearAllMocks();
    });

    it("should return default info when Docker is not available", async () => {
      jest.spyOn(dockerDetector as any, "isDockerAvailable").mockResolvedValue(false);

      const result = await dockerDetector.detectDocker();

      expect(result).toEqual({
        isRunning: false,
        isDockerDesktop: false,
        host: "localhost",
        port: 4566,
      });
    });

    it("should detect when running inside Docker container", async () => {
      jest.spyOn(dockerDetector as any, "isDockerAvailable").mockResolvedValue(true);
      jest.spyOn(dockerDetector as any, "isRunningInDocker").mockResolvedValue(true);
      jest.spyOn(dockerDetector as any, "getDockerInternalHost").mockReturnValue("localstack");

      const result = await dockerDetector.detectDocker();

      expect(result).toEqual({
        isRunning: true,
        isDockerDesktop: false,
        host: "localstack",
        port: 4566,
      });
    });

    it("should handle errors gracefully", async () => {
      jest
        .spyOn(dockerDetector as any, "isDockerAvailable")
        .mockRejectedValue(new Error("Test error"));

      const result = await dockerDetector.detectDocker();

      expect(result).toEqual({
        isRunning: false,
        isDockerDesktop: false,
        host: "localhost",
        port: 4566,
      });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Error detecting Docker environment:",
        expect.any(Error),
      );
    });

    it("should detect Docker Desktop when running", async () => {
      jest.spyOn(dockerDetector as any, "isDockerAvailable").mockResolvedValue(true);
      jest.spyOn(dockerDetector as any, "isRunningInDocker").mockResolvedValue(false);
      jest.spyOn(dockerDetector as any, "isDockerDesktopRunning").mockResolvedValue(true);

      const result = await dockerDetector.detectDocker();

      expect(result).toEqual({
        isRunning: true,
        isDockerDesktop: true,
        host: "localhost",
        port: 4566,
      });
      expect(mockLogger.debug).toHaveBeenCalledWith("Docker Desktop detected and running");
    });

    it("should detect LocalStack container when available", async () => {
      jest.spyOn(dockerDetector as any, "isDockerAvailable").mockResolvedValue(true);
      jest.spyOn(dockerDetector as any, "isRunningInDocker").mockResolvedValue(false);
      jest.spyOn(dockerDetector as any, "isDockerDesktopRunning").mockResolvedValue(false);
      jest.spyOn(dockerDetector as any, "getLocalStackContainerInfo").mockResolvedValue({
        host: "localstack",
        port: 4566,
      });

      const result = await dockerDetector.detectDocker();

      expect(result).toEqual({
        isRunning: true,
        isDockerDesktop: false,
        host: "localstack",
        port: 4566,
      });
      expect(mockLogger.debug).toHaveBeenCalledWith("LocalStack container detected", {
        host: "localstack",
        port: 4566,
      });
    });

    it("should return default when Docker available but LocalStack not found", async () => {
      jest.spyOn(dockerDetector as any, "isDockerAvailable").mockResolvedValue(true);
      jest.spyOn(dockerDetector as any, "isRunningInDocker").mockResolvedValue(false);
      jest.spyOn(dockerDetector as any, "isDockerDesktopRunning").mockResolvedValue(false);
      jest.spyOn(dockerDetector as any, "getLocalStackContainerInfo").mockResolvedValue(null);

      const result = await dockerDetector.detectDocker();

      expect(result).toEqual({
        isRunning: false,
        isDockerDesktop: false,
        host: "localhost",
        port: 4566,
      });
      expect(mockLogger.debug).toHaveBeenCalledWith("Docker available but LocalStack not detected");
    });
  });

  describe("isDockerAvailable", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should return true when docker command succeeds", async () => {
       
      const { exec } = require("child_process");
      exec.mockImplementation(
        (cmd: string, callback: (error: Error | null, result?: any) => void) => {
          callback(null, { stdout: "Docker version 20.10.0" });
        },
      );

      const result = await (dockerDetector as any).isDockerAvailable();
      expect(result).toBe(true);
    });

    it("should return false when docker command fails", async () => {
       
      const { exec } = require("child_process");
      exec.mockImplementation(
        (cmd: string, callback: (error: Error | null, result?: any) => void) => {
          callback(new Error("Command not found"));
        },
      );

      const result = await (dockerDetector as any).isDockerAvailable();
      expect(result).toBe(false);
    });
  });

  describe("isRunningInDocker", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should return true when cgroup contains docker", async () => {
       
      const { exec } = require("child_process");
      exec.mockImplementation(
        (cmd: string, callback: (error: Error | null, result?: any) => void) => {
          callback(null, { stdout: "1:name=docker:/docker/abc123" });
        },
      );

      const result = await (dockerDetector as any).isRunningInDocker();
      expect(result).toBe(true);
    });

    it("should return true when cgroup contains containerd", async () => {
       
      const { exec } = require("child_process");
      exec.mockImplementation(
        (cmd: string, callback: (error: Error | null, result?: any) => void) => {
          callback(null, { stdout: "1:name=containerd:/containerd/abc123" });
        },
      );

      const result = await (dockerDetector as any).isRunningInDocker();
      expect(result).toBe(true);
    });

    it("should return false when not in container", async () => {
       
      const { exec } = require("child_process");
      exec.mockImplementation(
        (cmd: string, callback: (error: Error | null, result?: any) => void) => {
          callback(null, { stdout: "1:name=systemd:/init.scope" });
        },
      );

      const result = await (dockerDetector as any).isRunningInDocker();
      expect(result).toBe(false);
    });

    it("should return false when command fails", async () => {
       
      const { exec } = require("child_process");
      exec.mockImplementation(
        (cmd: string, callback: (error: Error | null, result?: any) => void) => {
          callback(new Error("File not found"));
        },
      );

      const result = await (dockerDetector as any).isRunningInDocker();
      expect(result).toBe(false);
    });
  });

  describe("isDockerDesktopRunning", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should return true when Docker ping succeeds", async () => {
       
      const MockDocker = require("dockerode");
      MockDocker.mockImplementation(() => ({
        ping: jest.fn().mockResolvedValue({}),
      }));

      const result = await (dockerDetector as any).isDockerDesktopRunning();
      expect(result).toBe(true);
    });

    it("should return false when Docker ping fails", async () => {
       
      const MockDocker = require("dockerode");
      MockDocker.mockImplementation(() => ({
        ping: jest.fn().mockRejectedValue(new Error("Connection failed")),
      }));

      const result = await (dockerDetector as any).isDockerDesktopRunning();
      expect(result).toBe(false);
    });
  });

  describe("getLocalStackContainerInfo", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should return null when no containers found", async () => {
       
      const MockDocker = require("dockerode");
      MockDocker.mockImplementation(() => ({
        listContainers: jest.fn().mockResolvedValue([]),
      }));

      const result = await (dockerDetector as any).getLocalStackContainerInfo();
      expect(result).toBeNull();
    });

    it("should return container info with mapped port", async () => {
       
      const MockDocker = require("dockerode");
      MockDocker.mockImplementation(() => ({
        listContainers: jest.fn().mockResolvedValue([
          {
            Ports: [
              {
                PrivatePort: 4566,
                PublicPort: 4566,
                IP: "127.0.0.1",
              },
            ],
          },
        ]),
      }));

      const result = await (dockerDetector as any).getLocalStackContainerInfo();
      expect(result).toEqual({
        host: "127.0.0.1",
        port: 4566,
      });
    });

    it("should return default localhost when no IP specified", async () => {
       
      const MockDocker = require("dockerode");
      MockDocker.mockImplementation(() => ({
        listContainers: jest.fn().mockResolvedValue([
          {
            Ports: [
              {
                PrivatePort: 4566,
                PublicPort: 4566,
              },
            ],
          },
        ]),
      }));

      const result = await (dockerDetector as any).getLocalStackContainerInfo();
      expect(result).toEqual({
        host: "localhost",
        port: 4566,
      });
    });

    it("should return default port when no SQS port found", async () => {
       
      const MockDocker = require("dockerode");
      MockDocker.mockImplementation(() => ({
        listContainers: jest.fn().mockResolvedValue([
          {
            Ports: [
              {
                PrivatePort: 8080,
                PublicPort: 8080,
              },
            ],
          },
        ]),
      }));

      const result = await (dockerDetector as any).getLocalStackContainerInfo();
      expect(result).toEqual({
        host: "localhost",
        port: 4566,
      });
    });

    it("should return null and log error when Docker call fails", async () => {
       
      const MockDocker = require("dockerode");
      MockDocker.mockImplementation(() => ({
        listContainers: jest.fn().mockRejectedValue(new Error("Docker error")),
      }));

      const result = await (dockerDetector as any).getLocalStackContainerInfo();
      expect(result).toBeNull();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Error getting LocalStack container info:",
        expect.any(Error),
      );
    });
  });

  describe("getDockerInternalHost", () => {
    beforeEach(() => {
      delete process.env.LOCALSTACK_HOST;
    });

    afterEach(() => {
      delete process.env.LOCALSTACK_HOST;
    });

    it("should return env variable when LOCALSTACK_HOST is set", () => {
      process.env.LOCALSTACK_HOST = "custom-localstack-host";

      const result = (dockerDetector as any).getDockerInternalHost();
      expect(result).toBe("custom-localstack-host");
    });

    it("should return default localstack when no env variable", () => {
      const result = (dockerDetector as any).getDockerInternalHost();
      expect(result).toBe("localstack");
    });
  });
});
