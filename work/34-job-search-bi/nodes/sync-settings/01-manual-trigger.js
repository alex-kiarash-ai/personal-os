'use strict';
/*
 * 01-manual-trigger.js - the only way in, on purpose.
 *
 * NO WEBHOOK. The provisioner started with one and it was removed for two reasons that both apply
 * here unchanged:
 *   1. A webhook answers on the production URL only while the workflow is ACTIVE. Activating this
 *      one would spend a slot on a box whose active cap is unproven (19 workflows, 17 active,
 *      against a documented 16 that is already known to be stale), and an eviction there is silent
 *      and costs live engines.
 *   2. A webhook with no credential auth needs a shared secret to guard it, and that secret then has
 *      to live somewhere. A trigger that is never activated is dead surface carrying a secret.
 *
 * The editor's Execute button needs neither, because the editor already required a login.
 *
 * typeVersion 1, the same value the provisioner's manual trigger shipped with and the value the live
 * box carries on every manualTrigger node.
 */

module.exports = {
  name: 'Manual Run',
  type: 'n8n-nodes-base.manualTrigger',
  typeVersion: 1,
  position: [0, 100],
  connectFrom: null,
  parameters: {},
};
