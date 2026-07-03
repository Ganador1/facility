import type { LaunchSpec, SandboxDriver } from "./driver.js";

export class AwsSandboxDriver implements SandboxDriver {
  readonly name = "aws" as const;

  private notConfigured(): never {
    const error = new Error("AWS sandbox driver is not configured in this build");
    (error as Error & { code: string }).code = "not_configured";
    throw error;
  }

  launch(_spec: LaunchSpec): Promise<{ ref: string }> {
    this.notConfigured();
  }

  status(_ref: string): Promise<"starting" | "running" | "exited" | "lost"> {
    this.notConfigured();
  }

  logs(_ref: string, _afterLine?: number): AsyncIterable<string> {
    this.notConfigured();
  }

  stop(_ref: string, _opts?: { kill?: boolean }): Promise<void> {
    this.notConfigured();
  }

  destroy(_ref: string): Promise<void> {
    this.notConfigured();
  }
}
