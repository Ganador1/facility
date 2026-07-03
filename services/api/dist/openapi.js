import {
  buildApp
} from "./chunk-DSLKGQ3L.js";
import {
  readConfig
} from "./chunk-E4CVFKPO.js";

// src/openapi.ts
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { migrate, seed } from "@facility/db";
var root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
var out = join(root, "packages/sdk/openapi.json");
var config = readConfig();
await migrate(config.databaseUrl);
await seed(config.databaseUrl);
var app = await buildApp(config);
await app.ready();
var document = app.swagger();
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(document, null, 2)}
`);
await app.close();
console.log(`wrote ${out}`);
