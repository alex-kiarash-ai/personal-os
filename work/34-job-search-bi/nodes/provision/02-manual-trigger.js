'use strict';
/*
 * 02-manual-trigger.js - the zero-activation way in.
 *
 * Why a second trigger. A webhook answers on the production URL only while the workflow is ACTIVE,
 * and the n8n public API cannot start a manual execution, so "fire it with one curl" means
 * "activate it first". The box is at 19 workflows with 17 active against a documented cap of 16
 * that the orchestrator already proved stale, and an eviction there is silent and costs live
 * engines. Adding an eighteenth active workflow to create two spreadsheets is a poor trade if it
 * can be avoided.
 *
 * With this node it can be. Open the workflow in the editor, press Execute, done. No activation, no
 * token, because the editor already required a login.
 *
 * Two triggers feeding one node is fine: only the trigger that actually fired produces items, so
 * Build Seed Payload runs exactly once either way.
 *
 * typeVersion 1 per the brief's platform facts (section C).
 */

module.exports = {
  name: 'Manual Run',
  type: 'n8n-nodes-base.manualTrigger',
  typeVersion: 1,
  position: [0, 200],
  connectFrom: null,
  parameters: {},
};
