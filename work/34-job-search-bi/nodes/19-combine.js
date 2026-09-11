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
 * numberOfInputs: 3 IS LOAD BEARING. It defaults to 2. With three wires and the default, the third
 * source connects to an input slot the node does not have and its items are dropped silently, which
 * on this lane means every board row disappearing with a green run report. It is asserted at build
 * time here and it must be READ BACK off the box after the apply, because the n8n node
 * configuration skill records that this field name has shifted across n8n versions.
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
  notes: 'Append mode, three inputs: LinkedIn, Indeed, boards. A branch whose source is switched off never runs and its input stays empty, which Merge handles; Stage F reads disabled_sources from Plan Queries to tell that apart from a source that ran and found nothing.',
  parameters: {
    mode: 'append',
    numberOfInputs: INPUTS.length,
    options: {},
  },
};
