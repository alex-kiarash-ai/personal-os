# Third-party notices

The MIT license in [LICENSE](LICENSE) covers the code and documentation written for this
repository by its owner.

It does NOT cover the vendored third-party agent skills in `.agents/skills/` (mirrored as
junction links in `.claude/skills/`). Those are other authors' works, installed as data, and
each remains under its own author's license terms.

**Provenance is machine-recorded, not remembered:** `skills-lock.json` at the repo root maps
every installed skill to its source repository (`source`), the file it was fetched from
(`skillPath`), a content hash of the installed copy (`computedHash`), and - for installs since
2026-08-05 - the exact upstream commit audited and verified at install time (`sourceCommit`).
Look a skill up there first; the upstream repository's license is authoritative for it.

Notes:

- The larger upstream sources include `coreyhaines31/marketingskills` (MIT),
  `anthropics/claude-code` plugin skills, `kepano/obsidian-skills`, `davila7` career skills,
  `breferrari/obsidian-mind`, `czlonkowski` n8n skills, `obra/superpowers`,
  `github/awesome-copilot`, `multica-ai/andrej-karpathy-skills` (MIT), and
  `Panniantong/Agent-Reach` (MIT).
- A few installed skills carry small, documented local modifications (rewritten frontmatter
  descriptions, added scope-guard blocks). Each such deviation is recorded where the skill is
  routed (the root `CLAUDE.md` Skill Bindings section) and reflected in the lock's hash notes;
  the modifications are offered under the same terms as the upstream skill's license.
- If you are the author of a vendored skill and want it removed or attributed differently,
  open an issue.
