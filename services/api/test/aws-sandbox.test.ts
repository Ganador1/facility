import { GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { DescribeTasksCommand, RunTaskCommand, StopTaskCommand } from "@aws-sdk/client-ecs";
import { describe, expect, it } from "vitest";
import { AwsSandboxDriver } from "../src/sandbox/aws.js";

const env = {
  AWS_REGION: "us-east-1",
  FACILITY_AWS_ECS_CLUSTER: "facility-test",
  FACILITY_AWS_RUNNER_TASK_DEF: "facility-test-runner",
  FACILITY_AWS_SUBNETS: "subnet-a,subnet-b",
  FACILITY_AWS_SECURITY_GROUPS: "sg-runner",
  FACILITY_AWS_RUNNER_CONTAINER: "runner",
  FACILITY_AWS_RUNNER_LOG_GROUP: "/facility/test/runner",
};

describe("AwsSandboxDriver", () => {
  it("runs a Fargate task with env overrides and private awsvpc networking", async () => {
    const ecs = new FakeEcsClient();
    const driver = new AwsSandboxDriver(ecs, new FakeLogsClient(), env);
    const launched = await driver.launch({
      runId: "run_test",
      image: "facility-runner:dev",
      env: { RUN_ID: "run_test", RUNNER_TOKEN: "secret" },
      cpu: 1,
      memoryMb: 2048,
      timeoutMin: 30,
      cmd: ["node", "runner.js"],
    });

    expect(launched).toEqual({
      ref: "arn:aws:ecs:us-east-1:123456789012:task/facility-test/task-1",
    });
    const command = ecs.commands[0];
    expect(command).toBeInstanceOf(RunTaskCommand);
    expect(command?.input).toMatchObject({
      cluster: "facility-test",
      taskDefinition: "facility-test-runner",
      launchType: "FARGATE",
      overrides: {
        containerOverrides: [
          {
            name: "runner",
            command: ["node", "runner.js"],
            environment: [
              { name: "RUN_ID", value: "run_test" },
              { name: "RUNNER_TOKEN", value: "secret" },
            ],
          },
        ],
      },
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: ["subnet-a", "subnet-b"],
          securityGroups: ["sg-runner"],
          assignPublicIp: "DISABLED",
        },
      },
    });
  });

  it("maps ECS task states", async () => {
    const ecs = new FakeEcsClient();
    const driver = new AwsSandboxDriver(ecs, new FakeLogsClient(), env);
    ecs.describeStatuses.push("RUNNING", "STOPPED", undefined);

    await expect(driver.status("task-running")).resolves.toBe("running");
    await expect(driver.status("task-stopped")).resolves.toBe("exited");
    await expect(driver.status("task-missing")).resolves.toBe("lost");
  });

  it("stops ECS tasks", async () => {
    const ecs = new FakeEcsClient();
    const driver = new AwsSandboxDriver(ecs, new FakeLogsClient(), env);

    await driver.stop("task-1");

    const command = ecs.commands[0];
    expect(command).toBeInstanceOf(StopTaskCommand);
    expect(command?.input).toMatchObject({
      cluster: "facility-test",
      task: "task-1",
      reason: "Facility sandbox stop requested",
    });
  });

  it("reads CloudWatch log lines from the runner task stream", async () => {
    const logs = new FakeLogsClient();
    logs.events.push({ message: "first\nsecond" }, { message: "third" });
    const driver = new AwsSandboxDriver(new FakeEcsClient(), logs, env);

    const lines: string[] = [];
    for await (const line of driver.logs(
      "arn:aws:ecs:us-east-1:123456789012:task/facility-test/task-1",
      1,
    )) {
      lines.push(line);
    }

    expect(lines).toEqual(["second", "third"]);
    const command = logs.commands[0];
    expect(command).toBeInstanceOf(GetLogEventsCommand);
    expect(command?.input).toMatchObject({
      logGroupName: "/facility/test/runner",
      logStreamName: "runner/runner/task-1",
      startFromHead: true,
    });
  });
});

class FakeEcsClient {
  readonly commands: Array<RunTaskCommand | DescribeTasksCommand | StopTaskCommand> = [];
  readonly describeStatuses: Array<string | undefined> = [];

  async send(command: RunTaskCommand | DescribeTasksCommand | StopTaskCommand) {
    this.commands.push(command);
    if (command instanceof RunTaskCommand) {
      return {
        $metadata: {},
        tasks: [{ taskArn: "arn:aws:ecs:us-east-1:123456789012:task/facility-test/task-1" }],
      };
    }
    if (command instanceof DescribeTasksCommand) {
      const lastStatus = this.describeStatuses.shift();
      return { $metadata: {}, tasks: lastStatus ? [{ lastStatus }] : [] };
    }
    return { $metadata: {} };
  }
}

class FakeLogsClient {
  readonly commands: GetLogEventsCommand[] = [];
  readonly events: Array<{ message: string }> = [];

  async send(command: GetLogEventsCommand) {
    this.commands.push(command);
    return { $metadata: {}, events: this.events };
  }
}
