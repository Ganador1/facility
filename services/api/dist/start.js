import {
  buildApp
} from "./chunk-DSLKGQ3L.js";
import {
  readConfig
} from "./chunk-E4CVFKPO.js";

// src/start.ts
var config = readConfig();
var app = await buildApp(config);
await app.listen({ port: config.port, host: "0.0.0.0" });
