import { describe, expect, it } from "vitest";
import { nestedDockerEnabled, nestedDockerSettingIsValid } from "../src/sandbox/capabilities.js";

describe("sandbox capabilities", () => {
  it.each([
    [{ nested_docker: false }, false],
    [{ nested_docker: true }, true],
    [{}, true],
    [null, true],
    [["not", "an", "object"], true],
    [{ nested_docker: "false" }, true],
  ] as const)("normalizes %j to the conservative nested-Docker boundary", (setup, expected) => {
    expect(nestedDockerEnabled(setup)).toBe(expected);
  });

  it("rejects non-boolean writes while preserving unrelated setup keys", () => {
    expect(nestedDockerSettingIsValid({ provision_cmd: "pnpm setup" })).toBe(true);
    expect(nestedDockerSettingIsValid({ nested_docker: false, deps: [] })).toBe(true);
    expect(nestedDockerSettingIsValid({ nested_docker: 0 })).toBe(false);
  });
});
