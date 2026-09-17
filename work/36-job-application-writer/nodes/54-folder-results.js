'use strict';
/*
 * 54-folder-results.js - "Folder Results". Joins the folder branch back to the carried branch so
 * Attach Folder Ids runs exactly once, on one stream, whatever happened upstream.
 *
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANT: THE WHOLE WRITE BACK HALF MUST RUN, INCLUDING ON A MORNING THAT SHIPPED NOTHING.
 * ---------------------------------------------------------------------------------------------
 * n8n does not run a node whose input carries no items. A run with nothing to ship is ordinary
 * here: both lanes capped out, every qualifier already written, an Anthropic outage at the reader,
 * every letter held by the blind grade, or a CV that would not fit one page.
 *
 * In a straight chain any one of those would skip Create Folder and, after it, every node in this
 * seat. The run would end having written no sheet row, pushed no heartbeat and said nothing at all
 * about why, while reporting success. That is the failure this join exists to prevent, and this is
 * the sixth time this workflow has had to prevent it.
 *
 * Input 1 comes from Folder Route output 1 and is NEVER empty: Build Candidates always emits one
 * lane report per lane and its own stage report, and every Code node since has carried them. Inputs
 * 0 and 2 are allowed to be empty and both will be on any morning with nothing to ship.
 *
 * ---------------------------------------------------------------------------------------------
 * `numberInputs`, NOT `numberOfInputs`. THE WORD THAT COST THE COLLECTOR 748 ROWS.
 * ---------------------------------------------------------------------------------------------
 * The Merge v3 property is `numberInputs`. n8n drops an unknown parameter on save without an error
 * and leaves the real one at its DEFAULT OF TWO, so a node wired for three and spelling it
 * `numberOfInputs` declares two and never reads the third. Execution 5154 on #34 lost 748 job rows
 * and six source reports that way and reported success.
 *
 * This node is wired for THREE, so that is not a hypothetical here: a dropped parameter would
 * silently discard input 2, which is every shipped application in the run. build.js
 * assertDeclaredInputs() refuses a wired but undeclared count and refuses the five wrong spellings
 * by name, which is why the number is stated rather than left to a default.
 *
 * ---------------------------------------------------------------------------------------------
 * APPEND MODE CARRIES THE BINARY, AND HERE THAT IS THE PAYLOAD.
 * ---------------------------------------------------------------------------------------------
 * Input 2 carries the two PDFs of every shipped application. Those bytes have to survive this node
 * to reach Attach Folder Ids, which is where they are split onto the four file items and uploaded.
 * Merge v3 in append mode passes items through whole, binary included. Any other mode on this node
 * would be a different question being asked of the data.
 *
 * ---------------------------------------------------------------------------------------------
 * THREE INPUTS, AND THE THIRD ONE IS THE WHOLE REASON THIS NODE WAS REDESIGNED.
 * ---------------------------------------------------------------------------------------------
 * Create Folder REPLACES the item it is given, so the shipped pairs that went into it do not come
 * out of it: input 0 carries Drive folder resources with no `_kind`, no pair, and NO BYTES. Input 1
 * carries everything that did not ship. Between them, the two shipped applications and their four
 * documents would simply not be in the stream any more, and the first version of this node lost
 * exactly that: two folders were created, two resources came back, and not one pair survived to be
 * given a folder id. test-stage-5.js caught it on its first run.
 *
 * Input 2 is Folder Route output 0 wired in a SECOND time, so the shipped pairs travel through the
 * merge the way every other item in this workflow does, carrying their binary with them.
 *
 * THE ALTERNATIVE WAS WORSE, and it is worth writing down because it looks cheaper. Attach Folder
 * Ids could read the pairs back from `$('Folder Route').all(0)` by name, which is how it reads the
 * authoritative ORDER. That works for json. It is not something this seat can prove for BINARY from
 * a development machine: when the instance stores binary outside the item, whether a lookup by node
 * name hands back a usable descriptor is a property of the runtime, and the two PDFs are the whole
 * payload. Wiring the pairs through the merge needs no such assumption. The order lookup stays,
 * because a cross check has to come from somewhere independent.
 */

module.exports = {
  name: 'Folder Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [13520, 100],
  connectFrom: [
    { node: 'Create Folder', inputIndex: 0 },
    { node: 'Folder Route', outputIndex: 1, inputIndex: 1 },
    { node: 'Folder Route', outputIndex: 0, inputIndex: 2 },
  ],
  notes: 'Input 0: the Drive folder resources. Input 1: every pair that did not ship, every lane report and every stage report, which is never empty. Input 2: Folder Route output 0 wired a SECOND time, which is the shipped pairs themselves, carrying their two PDFs. That third input exists because Create Folder REPLACES the item it is given, so without it the shipped applications would not be in the stream at all: the first version of this node created two folders, got two resources back, and lost both pairs. Append mode, so an empty input appends nothing and the binary passes through whole.',
  parameters: {
    mode: 'append',
    numberInputs: 3,
  },
};
