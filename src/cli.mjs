// capataz CLI entry: init · add · doctor.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "./init.mjs";
import { addModule } from "./add.mjs";
import { doctor } from "./doctor.mjs";
import { banner, bold, dim, item } from "./ui.mjs";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")).version;

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (const arg of args) {
    if (arg === "--yes" || arg === "-y") flags.yes = true;
    else if (arg === "--force") flags.force = true;
    else if (arg.startsWith("--") && arg.includes("=")) {
      const [key, ...rest] = arg.slice(2).split("=");
      flags[key] = rest.join("=");
    } else if (!arg.startsWith("-")) positional.push(arg);
  }
  return { flags, positional };
}

function help() {
  banner(version);
  item(`${bold("npx @theam/capataz init")}            install the method into this repo`);
  item(`${bold("npx @theam/capataz add <module>")}    add a quality module (analytics, database, ai-queryability, design-system)`);
  item(`${bold("npx @theam/capataz doctor")}          check the install and list what's left`);
  console.log("");
  item(dim("init flags: --yes --force --dir=<path> --branch=<name> --provision=<cmd>"));
  item(dim('            --checks="cmd1, cmd2" --model=<id> --org=<org> --project=<n> --modules="a, b"'));
  console.log("");
  item(dim("Docs: https://github.com/theam/capataz"));
  console.log("");
}

export async function main(argv) {
  const [command, ...rest] = argv;
  const { flags, positional } = parseFlags(rest);
  if (flags.dir) flags.dir = resolve(flags.dir);

  switch (command) {
    case "init":
      return init(flags, pkgRoot, version);
    case "add": {
      if (!positional[0]) {
        help();
        return 1;
      }
      return addModule(positional[0], { dir: flags.dir || process.cwd(), pkgRoot });
    }
    case "doctor":
      return doctor(flags, version);
    case "--version":
    case "-v":
      console.log(version);
      return 0;
    default:
      help();
      return command === undefined || command === "help" || command === "--help" ? 0 : 1;
  }
}
