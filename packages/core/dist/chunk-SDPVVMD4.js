// src/ids.ts
import { uuidv7 } from "uuidv7";
var ID_PREFIXES = {
  org: "org",
  user: "user",
  proj: "proj",
  repo: "repo",
  run: "run",
  sess: "sess",
  agent: "agent",
  sbx: "sbx",
  key: "key",
  vkey: "vkey",
  bud: "bud",
  prop: "prop",
  act: "act",
  kb: "kb",
  task: "task",
  item: "item",
  ver: "ver",
  bun: "bun",
  iss: "iss",
  evt: "evt",
  int: "int",
  fp: "fp"
};
function newId(prefix) {
  return `${ID_PREFIXES[prefix]}_${uuidv7().replaceAll("-", "")}`;
}

export {
  ID_PREFIXES,
  newId
};
