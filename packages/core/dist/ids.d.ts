declare const ID_PREFIXES: {
    readonly org: "org";
    readonly user: "user";
    readonly proj: "proj";
    readonly repo: "repo";
    readonly run: "run";
    readonly sess: "sess";
    readonly agent: "agent";
    readonly sbx: "sbx";
    readonly key: "key";
    readonly vkey: "vkey";
    readonly bud: "bud";
    readonly prop: "prop";
    readonly act: "act";
    readonly kb: "kb";
    readonly task: "task";
    readonly item: "item";
    readonly ver: "ver";
    readonly bun: "bun";
    readonly iss: "iss";
    readonly evt: "evt";
    readonly int: "int";
    readonly fp: "fp";
};
type IdPrefix = keyof typeof ID_PREFIXES;
declare function newId(prefix: IdPrefix): string;

export { ID_PREFIXES, type IdPrefix, newId };
