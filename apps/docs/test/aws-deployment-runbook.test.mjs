import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const guides = new Map([
  [
    "published AWS runbook",
    readFileSync(resolve(repoRoot, "apps/docs/docs/self-host/aws.md"), "utf8"),
  ],
  [
    "Terraform module README",
    readFileSync(resolve(repoRoot, "infra/terraform/aws/README.md"), "utf8"),
  ],
]);

const dockerfile = readFileSync(resolve(repoRoot, "Dockerfile"), "utf8");

function apiStage(image) {
  const start = image.indexOf("FROM base AS api\n");
  assert.notEqual(start, -1, "the root Dockerfile must still build an api stage");
  const end = image.indexOf("\nFROM ", start + 1);
  return image.slice(start, end === -1 ? undefined : end);
}

function bootstrapOverrideCommand(markdown) {
  const override = markdown.match(
    /"containerOverrides":\[\{"name":"migrate","command":\[([\s\S]*?)\]\}\]\}/,
  );
  assert.ok(override, "the runbook must bootstrap the instance through a migrate task override");
  return [...override[1].matchAll(/"([^"]*)"/g)].map(([, token]) => token);
}

function imageOverrideBlock(markdown, guideName) {
  const match = markdown.match(/```hcl\n(image_overrides = \{[\s\S]*?\n\})\n```/);
  assert.ok(match, `${guideName} must include the release image_overrides block`);
  return match[1];
}

test("AWS guides select verified public release images before the first apply", () => {
  for (const [guideName, markdown] of guides) {
    const privatePackageWarning = markdown.indexOf("GitHub creates each GHCR package private");
    const publicPackageRequirement = markdown.search(/made all\s+six packages public/);
    const anonymousPullRequirement = markdown.search(/anonymously\s+pullable/);
    const imageOverrides = markdown.indexOf("image_overrides = {");
    const firstApply = markdown.indexOf("apply -var-file");

    assert.notEqual(privatePackageWarning, -1, `${guideName} must explain GHCR's private default`);
    assert.notEqual(
      publicPackageRequirement,
      -1,
      `${guideName} must require all release packages to be public`,
    );
    assert.notEqual(
      anonymousPullRequirement,
      -1,
      `${guideName} must require an anonymous-pull check`,
    );
    assert.notEqual(firstApply, -1, `${guideName} must include the first Terraform apply`);
    assert.ok(
      privatePackageWarning < imageOverrides &&
        publicPackageRequirement < imageOverrides &&
        anonymousPullRequirement < imageOverrides,
      `${guideName} must state the GHCR visibility prerequisite before configuring overrides`,
    );
    assert.ok(
      imageOverrides < firstApply,
      `${guideName} must configure image_overrides before the first Terraform apply`,
    );
    assert.doesNotMatch(
      markdown,
      /because the packages are public/,
      `${guideName} must not assume the packages are already public`,
    );
  }
});

// The bootstrap step binds the first organization, owner, and installation, so a
// command the image cannot resolve fails it — and every later sign-in with
// `not_invited`. Nothing else fails when the two halves drift apart: the runbook is
// prose to CI, and the image builds happily without the name the runbook spells.
test("the runbook bootstraps by the name the api image puts on the PATH", () => {
  const [[, runbook]] = guides;
  const stage = apiStage(dockerfile);

  assert.deepEqual(
    bootstrapOverrideCommand(runbook).slice(0, 3),
    ["facility", "instance", "bootstrap"],
    "the runbook must invoke the CLI by name, not as a path into the image",
  );
  assert.match(
    stage,
    /chmod \+x \/usr\/local\/bin\/facility/,
    "the api stage must install an executable `facility` on the PATH",
  );
  // Exec form, so the guard resolves the name without a shell — the way the
  // container runtime does for an ECS command override, and unlike `RUN cmd`.
  assert.match(
    stage,
    /RUN\s*\[\s*"facility",\s*"instance",\s*"bootstrap"/,
    "the api stage must fail the build when that name stops resolving without a shell",
  );
});

test("AWS guides keep the release override and build-fallback paths synchronized", () => {
  const [[runbookName, runbook], [readmeName, readme]] = guides;
  assert.equal(
    imageOverrideBlock(runbook, runbookName),
    imageOverrideBlock(readme, readmeName),
    "both AWS guides must use the same release image overrides",
  );

  for (const [guideName, markdown] of guides) {
    for (const service of ["api", "worker", "gateway", "web", "mcp", "runner"]) {
      assert.match(
        markdown,
        new RegExp(`ghcr\\.io/theam/facility/${service}:<version>`),
        `${guideName} must override the ${service} image`,
      );
    }
    assert.match(
      markdown,
      /## 3\. Build and push images when needed[\s\S]*?If you configured and verified public `image_overrides` before the first apply,\s+skip this step\./,
      `${guideName} must keep self-built images as a conditional fallback`,
    );
  }
});
