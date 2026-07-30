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
