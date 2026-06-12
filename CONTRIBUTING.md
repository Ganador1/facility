# Contributing

Capataz eats its own cooking: this repo follows the method it ships.

## Ground rules

- **Zero runtime dependencies** in the CLI and in everything we vendor into
  user repos. A dependency you add is a supply chain we hand to every
  adopter. PRs that add one need a reason that survives review.
- **Templates are product.** Anything under `templates/` and `modules/` lands
  in users' repos and gets read by their agents and their engineers. Comments
  in those files explain *why* (they survive); never narrate *what*.
- **The hardening doc is evidence-based.** New entries to
  `docs/hardening.md` describe something that actually happened, with the
  countermeasure that worked — not something that could conceivably happen.
- Branch names are semantic (`feature/...`, `fix/...`, `docs/...`); commits
  follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/);
  squash and merge.

## Working on it

```
git clone https://github.com/theam/capataz && cd capataz
npm test                      # node --test — no install step needed
node bin/capataz.mjs init --yes --dir=/tmp/somewhere ...   # try it on a scratch repo
node guards/run.mjs           # this repo's own guards
```

Tests live in `test/` and run the real CLI against temp repos — if you change
templates or the init flow, extend the assertions there. If you change
generated YAML, validate it parses (`ruby -ryaml -e "YAML.load_file(...)"` or
your tool of choice) before pushing.

## Releasing (maintainers)

1. Bump `version` in `package.json` (semver; pre-1.0 minor = breaking).
2. `npm publish --access public` (scoped package).
3. Tag `vX.Y.Z` and write release notes that name behavior, not commits.
