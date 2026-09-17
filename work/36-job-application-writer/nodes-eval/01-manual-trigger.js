'use strict';
/*
 * 01-manual-trigger.js - "When clicking Test". The only way this harness ever runs.
 *
 * There is no schedule trigger in nodes-eval/ and there must never be one. Six claude-sonnet-5
 * calls a morning to tell nobody anything is not a regression harness, it is a subscription. The
 * eval runs when a person changed the prompt and wants to know whether it still holds, which is
 * exactly when a person is sitting there to read the answer.
 *
 * The name matches the one n8n itself uses on this box and the one nodes/01-manual-trigger.js uses
 * in the runtime workflow. Node names are the connection keys, so this one is referenced verbatim
 * by 02-build-eval-cases.js.
 */

module.exports = {
  name: 'When clicking Test',
  type: 'n8n-nodes-base.manualTrigger',
  typeVersion: 1,
  position: [0, 0],
  connectFrom: null,
  notes: 'Manual run only. The public API cannot start a manual execution, so this is the whole trigger surface. This workflow is never activated and never scheduled.',
  parameters: {},
};
