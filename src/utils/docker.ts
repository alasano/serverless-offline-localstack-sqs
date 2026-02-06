import { exec } from "child_process";
import { promisify } from "util";
import Docker from "dockerode";
import { Logger } from "./logger";

const execAsync = promisify(exec);

export interface DockerInfo {
  isRunning: boolean;
  isDockerDesktop: boolean;
  host: string;
  port: number;
}

export class DockerDetector {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async detectDocker(): Promise<DockerInfo> {
    const defaultInfo: DockerInfo = {
      isRunning: false,
      isDockerDesktop: false,
      host: "localhost",
      port: 4566,
    };

    try {
      // First check if Docker is available
      const isDockerAvailable = await this.isDockerAvailable();
      if (!isDockerAvailable) {
        this.logger.debug("Docker is not available on this system");
        return defaultInfo;
      }

      // Check if running in a Docker container
      const isInContainer = await this.isRunningInDocker();
      if (isInContainer) {
        this.logger.debug("Running inside Docker container");
        return {
          ...defaultInfo,
          isRunning: true,
          host: this.getDockerInternalHost(),
        };
      }

      // Check if Docker Desktop is running
      const isDesktopRunning = await this.isDockerDesktopRunning();
      if (isDesktopRunning) {
        this.logger.debug("Docker Desktop detected and running");
        return {
          ...defaultInfo,
          isRunning: true,
          isDockerDesktop: true,
          host: "localhost",
        };
      }

      // Check for LocalStack container specifically
      const localstackInfo = await this.getLocalStackContainerInfo();
      if (localstackInfo) {
        this.logger.debug("LocalStack container detected", localstackInfo);
        return {
          ...defaultInfo,
          isRunning: true,
          host: localstackInfo.host,
          port: localstackInfo.port,
        };
      }

      this.logger.debug("Docker available but LocalStack not detected");
      return defaultInfo;
    } catch (error) {
      this.logger.debug("Error detecting Docker environment:", error);
      return defaultInfo;
    }
  }

  private async isDockerAvailable(): Promise<boolean> {
    try {
      await execAsync("docker --version");
      return true;
    } catch {
      return false;
    }
  }

  private async isRunningInDocker(): Promise<boolean> {
    try {
      // Check if we're running inside a container
      const { stdout } = await execAsync('cat /proc/1/cgroup 2>/dev/null || echo ""');
      return stdout.includes("docker") || stdout.includes("containerd");
    } catch {
      return false;
    }
  }

  private async isDockerDesktopRunning(): Promise<boolean> {
    try {
      const docker = new Docker();
      await docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  private async getLocalStackContainerInfo(): Promise<{
    host: string;
    port: number;
  } | null> {
    try {
      const docker = new Docker();
      const containers = await docker.listContainers({
        filters: {
          name: ["localstack"],
          status: ["running"],
        },
      });

      if (containers.length === 0) {
        return null;
      }

      const container = containers[0];
      const ports = container.Ports;

      // Look for SQS port (4566)
      const sqsPort = ports.find((p) => p.PrivatePort === 4566);
      if (sqsPort && sqsPort.PublicPort) {
        return {
          host: sqsPort.IP || "localhost",
          port: sqsPort.PublicPort,
        };
      }

      // Default LocalStack port
      return {
        host: "localhost",
        port: 4566,
      };
    } catch (error) {
      this.logger.debug("Error getting LocalStack container info:", error);
      return null;
    }
  }

  private getDockerInternalHost(): string {
    // When running inside Docker, LocalStack is typically accessible via container name or host.docker.internal
    if (process.env.LOCALSTACK_HOST) {
      return process.env.LOCALSTACK_HOST;
    }

    // Try common Docker networking patterns
    const commonHosts = ["localstack", "host.docker.internal", "localhost"];
    return commonHosts[0]; // Default to 'localstack' container name
  }

  async getEndpointUrl(customEndpoint?: string): Promise<string> {
    if (customEndpoint) {
      return customEndpoint;
    }

    const dockerInfo = await this.detectDocker();
    return `http://${dockerInfo.host}:${dockerInfo.port}`;
  }
}
