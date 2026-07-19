import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
  type GetLogEventsCommandOutput,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  DescribeTasksCommand,
  type DescribeTasksCommandOutput,
  ECSClient,
  RunTaskCommand,
  type RunTaskCommandOutput,
  StopTaskCommand,
  type StopTaskCommandOutput,
} from "@aws-sdk/client-ecs";
import type { LaunchSpec, SandboxDriver } from "./driver.js";

type EcsCommand = RunTaskCommand | DescribeTasksCommand | StopTaskCommand;
type EcsCommandOutput = RunTaskCommandOutput | DescribeTasksCommandOutput | StopTaskCommandOutput;

type EcsSender = {
  send(command: EcsCommand): Promise<EcsCommandOutput>;
};

type LogsSender = {
  send(command: GetLogEventsCommand): Promise<GetLogEventsCommandOutput>;
};

type AwsSandboxConfig = {
  region: string;
  cluster: string;
  taskDefinition: string;
  subnets: string[];
  securityGroups: string[];
  container: string;
  logGroup: string;
  logStreamPrefix: string;
};

export class AwsSandboxDriver implements SandboxDriver {
  readonly name = "aws" as const;
  private readonly ecs: EcsSender;
  private readonly cloudwatchLogs: LogsSender;
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    ecs: EcsSender = new ECSClient({ region: process.env.AWS_REGION }),
    cloudwatchLogs: LogsSender = new CloudWatchLogsClient({ region: process.env.AWS_REGION }),
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.ecs = ecs;
    this.cloudwatchLogs = cloudwatchLogs;
    this.env = env;
  }

  async launch(spec: LaunchSpec): Promise<{ ref: string; endpoint?: string }> {
    const config = this.config();
    const output = (await this.ecs.send(
      new RunTaskCommand({
        cluster: config.cluster,
        taskDefinition: config.taskDefinition,
        launchType: "FARGATE",
        count: 1,
        overrides: {
          cpu: ecsCpuUnits(spec.cpu),
          memory: String(Math.max(128, Math.round(spec.memoryMb))),
          containerOverrides: [
            {
              name: config.container,
              environment: Object.entries(spec.env).map(([name, value]) => ({ name, value })),
              ...(spec.cmd ? { command: spec.cmd } : {}),
            },
          ],
        },
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: config.subnets,
            securityGroups: config.securityGroups,
            assignPublicIp: "DISABLED",
          },
        },
      }),
    )) as RunTaskCommandOutput;
    if (output.failures?.length) {
      throw new Error(
        `ECS RunTask failed: ${output.failures
          .map((failure) => [failure.arn, failure.reason, failure.detail].filter(Boolean).join(" "))
          .join("; ")}`,
      );
    }
    const taskArn = output.tasks?.[0]?.taskArn;
    if (!taskArn) throw new Error("ECS RunTask did not return a taskArn");
    const privateIp = output.tasks?.[0]?.attachments
      ?.flatMap((attachment) => attachment.details ?? [])
      .find((detail) => detail.name === "privateIPv4Address")?.value;
    return {
      ref: taskArn,
      ...(spec.servicePort && privateIp
        ? { endpoint: `http://${privateIp}:${spec.servicePort}` }
        : {}),
    };
  }

  async status(ref: string): Promise<"starting" | "running" | "exited" | "lost"> {
    const config = this.config();
    const output = (await this.ecs.send(
      new DescribeTasksCommand({ cluster: config.cluster, tasks: [ref] }),
    )) as DescribeTasksCommandOutput;
    const task = output.tasks?.[0];
    if (!task) return "lost";
    switch (task.lastStatus) {
      case "PROVISIONING":
      case "PENDING":
      case "ACTIVATING":
        return "starting";
      case "RUNNING":
        return "running";
      case "DEACTIVATING":
      case "STOPPING":
      case "STOPPED":
      case "DELETED":
        return "exited";
      default:
        return "lost";
    }
  }

  async *logs(ref: string, afterLine = 0): AsyncIterable<string> {
    const config = this.config();
    let nextToken: string | undefined;
    let lineNo = 0;
    do {
      let output: GetLogEventsCommandOutput;
      try {
        output = await this.cloudwatchLogs.send(
          new GetLogEventsCommand({
            logGroupName: config.logGroup,
            logStreamName: logStreamName(config, ref),
            nextToken,
            startFromHead: true,
          }),
        );
      } catch (error) {
        if (isResourceNotFound(error)) return;
        throw error;
      }
      for (const event of output.events ?? []) {
        const message = event.message;
        if (!message) continue;
        for (const line of message.split(/\r?\n/)) {
          if (!line) continue;
          lineNo += 1;
          if (lineNo > afterLine) yield line;
        }
      }
      if (!output.nextForwardToken || output.nextForwardToken === nextToken) return;
      nextToken = output.nextForwardToken;
    } while (nextToken);
  }

  async stop(ref: string, opts: { kill?: boolean } = {}): Promise<void> {
    const config = this.config();
    await this.ecs.send(
      new StopTaskCommand({
        cluster: config.cluster,
        task: ref,
        reason: opts.kill ? "Facility sandbox kill requested" : "Facility sandbox stop requested",
      }),
    );
  }

  async destroy(ref: string): Promise<void> {
    await this.stop(ref, { kill: true });
  }

  private config(): AwsSandboxConfig {
    const region = stringEnv(this.env.AWS_REGION);
    const cluster = stringEnv(this.env.FACILITY_AWS_ECS_CLUSTER);
    const taskDefinition = stringEnv(this.env.FACILITY_AWS_RUNNER_TASK_DEF);
    const subnets = listEnv(this.env.FACILITY_AWS_SUBNETS);
    const securityGroups = listEnv(this.env.FACILITY_AWS_SECURITY_GROUPS);
    const logGroup = stringEnv(this.env.FACILITY_AWS_RUNNER_LOG_GROUP);
    const missing: string[] = [];
    if (!region) missing.push("AWS_REGION");
    if (!cluster) missing.push("FACILITY_AWS_ECS_CLUSTER");
    if (!taskDefinition) missing.push("FACILITY_AWS_RUNNER_TASK_DEF");
    if (subnets.length === 0) missing.push("FACILITY_AWS_SUBNETS");
    if (securityGroups.length === 0) missing.push("FACILITY_AWS_SECURITY_GROUPS");
    if (!logGroup) missing.push("FACILITY_AWS_RUNNER_LOG_GROUP");
    if (missing.length > 0) this.notConfigured(missing.join(", "));
    const container = stringEnv(this.env.FACILITY_AWS_RUNNER_CONTAINER) ?? "runner";
    if (!region || !cluster || !taskDefinition || !logGroup) this.notConfigured("AWS sandbox env");
    return {
      region,
      cluster,
      taskDefinition,
      subnets,
      securityGroups,
      container,
      logGroup,
      logStreamPrefix: stringEnv(this.env.FACILITY_AWS_RUNNER_LOG_STREAM_PREFIX) ?? container,
    };
  }

  private notConfigured(missing: string): never {
    const error = new Error(`AWS sandbox driver is not configured; missing ${missing}`);
    (error as Error & { code: string }).code = "not_configured";
    throw error;
  }
}

function stringEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function listEnv(value: string | undefined) {
  return (
    value
      ?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

function ecsCpuUnits(cpu: number) {
  return String(Math.max(256, Math.round(cpu * 1024)));
}

function logStreamName(config: AwsSandboxConfig, taskArn: string) {
  return `${config.logStreamPrefix}/${config.container}/${taskId(taskArn)}`;
}

function taskId(taskArn: string) {
  return taskArn.split("/").filter(Boolean).at(-1) ?? taskArn;
}

function isResourceNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { name?: string }).name === "ResourceNotFoundException" ||
      (error as { Code?: string }).Code === "ResourceNotFoundException")
  );
}
