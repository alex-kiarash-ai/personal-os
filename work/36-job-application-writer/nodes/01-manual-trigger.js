'use strict';
/*
 * 01-manual-trigger.js - the Execute button.
 *
 * The n8n public API cannot start a manual execution, so this node is the ONLY way to run #36 on
 * demand: open the workflow in the editor and press Execute. That matters twice here.
 *
 * First, the first-fire drill (seat 8) runs at cap 2 on one lane before this workflow is ever
 * activated, and a manual trigger needs no activation, so the drill costs no scheduler slot.
 * Second, this lane spends real money on every pair. A manual run is the only way to watch it spend
 * before the cron starts spending unattended.
 *
 * The name is the one n8n itself uses on this box, verified by #34 with a read-only GET over every
 * workflow: "When clicking Test" is already a live node name there. Node names are the connection
 * keys, so this one is referenced verbatim by 03-seed-lanes.js.
 */

module.exports = {
  name: 'When clicking Test',
  type: 'n8n-nodes-base.manualTrigger',
  typeVersion: 1,
  position: [0, 0],
  connectFrom: null,
  notes: 'Manual run. The public API cannot start one, so this is the only on demand path and it needs no activation. The first fire drill runs through here.',
  parameters: {},
};
