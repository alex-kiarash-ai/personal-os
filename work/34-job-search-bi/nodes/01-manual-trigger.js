'use strict';
/*
 * 01-manual-trigger.js - the Execute button.
 *
 * The n8n public API cannot start a manual execution, so this node is the ONLY way to run the lane
 * on demand: open the workflow in the editor and press Execute. That matters more than it sounds.
 * The box is at 19 workflows with 17 active against a documented cap of 16 that is already known to
 * be stale, and an eviction is silent. A manual trigger needs no activation, so every test run
 * before final activation costs nothing.
 *
 * The name is the one n8n itself uses on this box (verified by a read-only GET over all 19
 * workflows: "When clicking Test" is already a live node name here). Node names are the connection
 * keys, so this one is referenced verbatim by 03-read-settings.js.
 */

module.exports = {
  name: 'When clicking Test',
  type: 'n8n-nodes-base.manualTrigger',
  typeVersion: 1,
  position: [0, 0],
  connectFrom: null,
  notes: 'Manual run. The public API cannot start one, so this is the only on demand path and it needs no activation.',
  parameters: {},
};
