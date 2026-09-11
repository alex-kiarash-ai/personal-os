'use strict';
/*
 * 01-webhook.js - the curl entry point for the one-shot provisioning run.
 *
 * typeVersion 2, confirmed against the live box on 2026-09-11: 13 webhook nodes are running there
 * and every one is v2. Not taken from memory and not taken from the brief, which does not list a
 * webhook typeVersion.
 *
 * responseMode 'responseNode' hands the reply to 09-respond.js, so the caller gets both spreadsheet
 * ids back in the curl response instead of n8n's bare acknowledgement. A provisioning run whose
 * output you have to go and look up in the executions list is a provisioning run whose ids get
 * copied wrong.
 *
 * The path carries a random suffix and lives in the gitignored seed file. A webhook that creates
 * spreadsheets in Shaheen's Drive must not sit on a guessable path in a public repo, and it has no
 * credential-based auth because creating a credential is a mutation this relay seat cannot make.
 * The token check in 03-build-seed.js is the compensating control.
 *
 * NOTE: a webhook answers on the production URL only while the workflow is ACTIVE. build.js never
 * activates. Firing this by curl therefore costs one activation on a box already at 17 active
 * against an unproven ceiling. 02-manual-trigger.js exists so that cost is optional.
 */

const { loadSeed } = require('./_seed');
const seed = loadSeed();

module.exports = {
  name: 'Provision Webhook',
  type: 'n8n-nodes-base.webhook',
  typeVersion: 2,
  position: [0, 0],
  connectFrom: null,
  parameters: {
    httpMethod: 'POST',
    path: seed.provision.webhook_path,
    responseMode: 'responseNode',
    options: {},
  },
};
