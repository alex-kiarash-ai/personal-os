'use strict';
/*
 * 11-respond.js - hands the report back to whoever fired the webhook.
 *
 * 01-webhook.js sets responseMode 'responseNode', so the curl call blocks until this node runs and
 * receives the two spreadsheet ids in its own response body. Without it the caller gets n8n's bare
 * acknowledgement and has to go and dig the ids out of the executions list, which is how an id gets
 * transcribed wrong into a lane file.
 *
 * On a manual run from the editor this node is a harmless no-op: there is no HTTP request waiting,
 * and the Report node's output is already visible in the editor.
 *
 * typeVersion 1.1 confirmed against the live box, which runs both v1 and v1.1. v1.1 is the newer of
 * the two in use.
 */

module.exports = {
  name: 'Respond',
  type: 'n8n-nodes-base.respondToWebhook',
  typeVersion: 1.1,
  position: [2000, 100],
  connectFrom: 'Report',
  parameters: {
    respondWith: 'json',
    responseBody: '={{ JSON.stringify($json) }}',
    options: {},
  },
};
