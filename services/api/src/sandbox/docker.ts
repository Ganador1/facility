import { Readable } from "node:stream";
import Docker from "dockerode";
import type { LaunchSpec, SandboxDriver } from "./driver.js";

type ContainerSummary = {
  Id: string;
  Labels?: Record<string, string>;
};

export class DockerSandboxDriver implements SandboxDriver {
  readonly name = "docker" as const;
  private readonly docker: Docker;

  constructor(docker = new Docker()) {
    this.docker = docker;
  }

  async launch(spec: LaunchSpec): Promise<{ ref: string }> {
    await this.ensureImage(spec.image);
    const container = await this.docker.createContainer({
      Image: spec.image,
      Cmd: spec.cmd,
      Env: Object.entries(spec.env).map(([key, value]) => `${key}=${value}`),
      Labels: { "facility.run": spec.runId },
      HostConfig: {
        AutoRemove: false,
        Memory: Math.max(128, spec.memoryMb) * 1024 * 1024,
        NanoCpus: Math.max(0.1, spec.cpu) * 1_000_000_000,
      },
    });
    await container.start();
    return { ref: container.id };
  }

  async status(ref: string): Promise<"starting" | "running" | "exited" | "lost"> {
    try {
      const info = await this.docker.getContainer(ref).inspect();
      if (info.State?.Running) return "running";
      if (info.State?.Status === "created" || info.State?.Status === "restarting") {
        return "starting";
      }
      return "exited";
    } catch (error) {
      if (isDockerNotFound(error)) return "lost";
      throw error;
    }
  }

  async *logs(ref: string, afterLine = 0): AsyncIterable<string> {
    const streamOrBuffer = await this.docker.getContainer(ref).logs({
      stdout: true,
      stderr: true,
      follow: false,
      timestamps: false,
    });
    const text = Buffer.isBuffer(streamOrBuffer)
      ? streamOrBuffer.toString("utf8")
      : await readableToString(streamOrBuffer);
    let lineNo = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      lineNo += 1;
      if (lineNo > afterLine) yield line;
    }
  }

  async stop(ref: string, opts: { kill?: boolean } = {}): Promise<void> {
    const container = this.docker.getContainer(ref);
    try {
      if (opts.kill) {
        await container.kill();
      } else {
        await container.stop({ t: 10 });
      }
    } catch (error) {
      if (!isDockerNotFound(error) && !isAlreadyStopped(error)) throw error;
    }
  }

  async destroy(ref: string): Promise<void> {
    try {
      await this.docker.getContainer(ref).remove({ force: true, v: true });
    } catch (error) {
      if (!isDockerNotFound(error)) throw error;
    }
  }

  async listFacilityContainers(): Promise<Array<{ ref: string; runId: string }>> {
    const containers = (await this.docker.listContainers({
      all: true,
      filters: { label: ["facility.run"] },
    })) as ContainerSummary[];
    return containers.flatMap((container) => {
      const runId = container.Labels?.["facility.run"];
      return runId ? [{ ref: container.Id, runId }] : [];
    });
  }

  private async ensureImage(image: string) {
    try {
      await this.docker.getImage(image).inspect();
      return;
    } catch (error) {
      if (!isDockerNotFound(error)) throw error;
    }
    const stream = await this.docker.pull(image);
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(stream, (error) => (error ? reject(error) : resolve()));
    });
  }
}

function isDockerNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { statusCode?: number }).statusCode === 404
  );
}

function isAlreadyStopped(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    String(
      (error as { reason?: string; message?: string }).reason ?? (error as Error).message,
    ).includes("not running")
  );
}

async function readableToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Readable.from(stream)) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
