# 27 - Migration Engine

**What it is (plain version):** a way to run a big migration - swapping a framework, sweeping a deprecated API out of the code, porting a structure, or a refactor that touches a lot of files - as a coordinated team of agents instead of Alex grinding through it one file at a time. The agents split the work, each checks its own piece against a test or a parity check before calling it done, an adversarial pass tries to prove something broke, and the whole thing is resumable and revertible.

**Why it exists:** most changes are small and a single session handles them fine. But some are big, and doing a big one serially by hand is slow and easy to get wrong. When the earlier dashboard cleanup (P9) shrank a 1344-line file to 377 lines, that was done carefully by hand and verified pixel-for-pixel - the small version of this. The Migration Engine is the version for when the job is too big for that: parallelism plus independent verification plus a clean rollback point. Honest note: there is no big migration waiting right now, so this is a tool that sits ready, not a job that runs.

**How it works:**
- It refuses to start without three things: a named target (what is moving, from what, to what), a way to verify the result (tests, renders, a parity diff - because a migration you cannot verify is just a rewrite you hope works), and a rollback point (a branch off main).
- It splits the work into independent units, migrates them in parallel, verifies each one, then runs an adversarial pass that tries to prove behavior changed - grounded in the actual test output, not in confidence.
- It deploys once, at the end, and reads back every external change to confirm it actually took (the same "don't trust a 200" rule that caught a silent failure before).

**Connects to:** reuses the research team's build-and-review agent patterns (#04) and shares the evidence-anchored refutation discipline with the deep audit (#23) and the research team's verification mode (#04). Precedent: the P9 dashboard extraction. Candidate first targets (none chosen yet): the n8n workflow set, the Alex HQ front end, or a docs/vault structure pass.

**Command:** `/migrate {named target}` - on-demand only, never scheduled. On the Max plan a run spends the usage window rather than money, so firing it is a deliberate choice against a real target.
