'use strict';
/*
 * 19-combine.js - "Combine". The join. Three collector branches become one stream.
 *
 * WHY THIS HAS TO BE A REAL MERGE NODE, MEASURED ON THIS BOX AND NOT ASSUMED.
 * The obvious cheaper shape is a Code node with all three extractors wired into it. That shape is
 * already live here and it does NOT do what it looks like it does. Execution 5065 of
 * `Alex Radar - Collector (15)`, read back through the public API, has nine sources wired into
 * `Normalize Items` input 0. The run data shows `Normalize Items` with NINE runs, output counts
 * 10 / 10 / 9 / 10 / 1189 / 100 / 30 / 30 / 20. It did not run once over the union. It ran once per
 * incoming branch, each run seeing only that branch's items. A cross-source dedupe written in that
 * node could never see two sources at the same time, and a per-run cap of 20 would emit up to 60.
 *
 * THE OTHER CHEAP SHAPE IS WORSE. Hanging this node off ONE branch and reading the other two with
 * $('Extract Indeed Jobs').all() depends on execution ORDER, and the same execution measures that
 * order exactly: n8n v1 runs a branch AND ITS ENTIRE DOWNSTREAM to completion before starting the
 * next branch (RSS Claude Code -> Normalize -> Filter -> Insert -> Notify, only then RSS MCP
 * Servers). So a Combine hung off the LinkedIn branch would run the whole of Stage E and Stage F
 * before the board branch ever executed, and the board rows would simply not be there. It would
 * report a small, healthy-looking run. The dependency is on canvas POSITION, which is the kind of
 * thing a later tidy-up breaks silently.
 *
 * A Merge has neither problem: n8n waits for its connected inputs and fires once.
 *
 * THE INDEED INPUT IS USUALLY DEAD, AND THAT IS FINE. `source_brightdata_indeed` ships OFF, so on a
 * normal run the whole Indeed branch is skipped and input 1 never receives anything. n8n's own
 * documentation is explicit that this is supported: in v1 "nodes only execute when they receive
 * data, and multi-input nodes require data on at least one input to trigger", and Append "waits for
 * all connected inputs to complete execution". A branch that will not run is complete.
 *
 * WHAT HAD TO CHANGE IN build.js, and it is the honest cost of this node.
 * `assembleConnections` wrote `index: 0` as a literal, and `index` on a connection is the TARGET
 * INPUT. So build.js could only ever wire single-input nodes, and the limitation was invisible
 * because every node it had built until now has one input. connectFrom entries may now be objects
 * carrying `inputIndex`. Plain strings are untouched and every earlier node file builds byte for
 * byte the same. The change is negative-tested in config/test-stage-e-guards.js.
 *
 * THE PARAMETER IS `numberInputs`. NOT `numberOfInputs`. THAT ONE WORD COST THE FIRST LIVE RUN.
 *
 * This file shipped `numberOfInputs: 3` and the comment above it warned, correctly, that the count
 * is load bearing. The warning was right and the spelling was wrong, and the spelling is the part
 * n8n reads. Execution 5154 (2026-09-11, 23:44:58Z, `status: success`) is what it cost: `Extract
 * Board Jobs` emitted 754 items, Combine emitted 201, and 748 job rows plus all six board source
 * reports were gone with a green tick on the run.
 *
 * THE MECHANISM, read out of the n8n source and not inferred from the symptom:
 *   1. Merge v3's real property is `numberInputs` (nodes/Merge/v3/helpers/descriptions.ts,
 *      `numberInputsProperty`, `name: 'numberInputs'`, `default: 2`). `numberOfInputs` is not a
 *      property of this node at all.
 *   2. n8n normalises a node against its schema on save, and drops TWO kinds of key: one it does
 *      not declare, silently and with no error, and one whose value equals the schema default.
 *      Both happened here, so `GET /workflows/oSVDR2WjkZnjovCP` returns `"parameters": {}` for this
 *      node. Nothing. The execution snapshot then hydrates the defaults back, which is why
 *      execution 5154 reads `{"mode":"append","numberInputs":2}`: that 2 was never sent by anyone,
 *      it is the default filling the hole. The PUT returned 200 and the read-back passed, because
 *      the read-back compared node names, connections and settings and never a parameter.
 *   3. `configuredInputs` (Merge/v3/helpers/utils.ts) builds the node's input list from
 *      `parameters.numberInputs || 2`, so the node DECLARED two inputs.
 *   4. The ENGINE still waited on three, because it counts CONNECTIONS, not declared inputs
 *      (workflow-execute.ts, `connectionsByDestinationNode[node].main.length`). It handed the node
 *      a `main` array of length 3.
 *   5. `getNodeInputsData` (same utils.ts) loops `i < inputs.length`, where `inputs` is the node's
 *      DECLARED inputs. Two. It called `getInputData(0)` and `getInputData(1)` and NEVER READ
 *      INPUT 2. The board branch's 754 items were never fetched by the node.
 *
 * WHAT WAS NOT THE CAUSE, because the obvious reading of the run data is wrong. The recorded source
 * array is `[Extract LinkedIn, null, Extract Board Jobs]`, and the null at index 1 is real: Indeed
 * is switched off so that branch never ran. It is also IRRELEVANT. `append.execute` iterates the
 * whole `inputsData` array and appends every element including empty ones; an empty input appends
 * nothing and truncates nothing. The engine's own flush path is explicit about it: "For the inputs
 * for which never any data got received set it to an empty array". So an empty middle input is a
 * supported case, and with `numberInputs: 3` inputs 0 and 2 both survive it. The output happening
 * to equal input 0's count exactly was a coincidence of Indeed being the empty one. Had Indeed been
 * full, the boards would still have vanished.
 *
 * THE ONE EMPTY-INPUT EDGE THAT IS REAL, stated so nobody has to rediscover it: if EVERY input is
 * empty the engine does not run the node at all (`taskDataMain.filter(d => d.length).length !== 0`).
 * That cannot happen on this lane, because Plan Queries throws on an empty plan and each collector
 * emits one source_report unconditionally, so at least one input always carries at least one item.
 *
 * THE COUNT IS NOW GUARDED IN THREE PLACES, because a comment is what failed last time:
 *   - build.js refuses to build a node wired into input N that does not DECLARE at least N+1
 *     inputs under the exact parameter name, and refuses `numberOfInputs` and its cousins by name.
 *   - build.js's read-back re-derives the LIVE effective count (absent means the default) and
 *     fails if it does not cover every wired input.
 *   - config/test-combine-merge.js replays n8n's real Merge semantics over this file's parameters,
 *     including the exact execution-5154 shape.
 */

const { sources } = require('./_lane');

// The three terminal collectors, in input order. Named here once; the Filter node reads this list
// out of the built parameters rather than keeping a second copy.
const INPUTS = [
  { node: 'Extract LinkedIn', source: 'linkedin_guest_search', inputIndex: 0 },
  { node: 'Extract Indeed Jobs', source: 'brightdata_indeed', inputIndex: 1 },
  { node: 'Extract Board Jobs', source: 'board', inputIndex: 2 },
];

(function assertAgainstContract() {
  const SRC = sources().sources;
  for (const i of INPUTS) {
    if (i.source === 'board') continue;
    if (!SRC[i.source]) {
      throw new Error(
        'Combine: the shared contract has no source called ' + i.source + '. It carries: ' +
        Object.keys(SRC).join(', ') + '.\n' +
        '  This node exists to join that branch into the stream. A source renamed in sources.json\n' +
        '  without renaming it here would leave one collector wired to an input nothing reads.'
      );
    }
  }
  const idx = INPUTS.map((i) => i.inputIndex);
  if (idx.join(',') !== '0,1,2') {
    throw new Error('Combine: the three inputs must be 0, 1 and 2 with no gaps, got ' + idx.join(','));
  }
}());

module.exports = {
  name: 'Combine',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [3380, 160],
  connectFrom: INPUTS.map((i) => ({ node: i.node, inputIndex: i.inputIndex })),
  notes: 'Append mode, three inputs: LinkedIn, Indeed, boards. The parameter is numberInputs, not numberOfInputs: the wrong spelling is dropped on save, leaves the count at its default 2, and the third input is never read (execution 5154 lost 748 board rows that way). A branch whose source is switched off never runs and its input arrives as an empty array, which append handles; the Filter emits a disabled source_report for it so Stage F can tell that apart from a source that ran and found nothing.',
  parameters: {
    // `numberInputs` is the real Merge v3 property. See the header: `numberOfInputs` is not a
    // property of this node, n8n drops it on save, and the count falls back to 2. `options` is gone
    // for the same reason: append mode declares no `options` property, so sending one was noise
    // that the box stripped anyway.
    mode: 'append',
    numberInputs: INPUTS.length,
  },
};
