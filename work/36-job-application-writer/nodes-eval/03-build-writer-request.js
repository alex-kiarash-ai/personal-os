'use strict';
/*
 * 03-build-writer-request.js - "Build Writer Request". THE ONE PROSE NODE, byte for byte.
 *
 * =============================================================================================
 * THERE IS NO PROMPT IN THIS FILE, AND THAT IS THE ENTIRE DELIVERABLE.
 * =============================================================================================
 * `parameters.jsCode` below is not a copy of the runtime prose node. It IS the runtime prose node:
 * the same string, off the same object, that build.js hands to n8n when it assembles workflow #36.
 * Nothing in nodes-eval/ can paraphrase a prompt it never holds.
 *
 * An eval that tests a paraphrase tests nothing, and this repo has already paid for that lesson
 * once: the live Writer Voice Eval was checking seventeen AI tells while the grader rubric it was
 * supposed to represent held thirteen, and both looked healthy for months. That is why
 * scripts/lib/voice-rules.js exists, and it is why this node holds a reference rather than a copy.
 *
 * =============================================================================================
 * THE OTHER HALF: THE REPO IS NOT THE BOX.
 * =============================================================================================
 * Identity against the repo is free. Identity against the LIVE WORKFLOW is the claim that actually
 * matters, and no offline build can assert it. So writer-node.pin.json carries the sha256 of the
 * live node's jsCode, captured from a read-only GET, and E.writerJsCode() REFUSES TO BUILD when the
 * regenerated code no longer hashes to it. The failure message names both hashes, both legitimate
 * causes and the one re-pin command, because a guard that just says "mismatch" gets deleted.
 *
 * The refusal fires on an ordinary day: soul.md gains a My Words entry, node 29 bakes a new voice
 * block, and the repo is suddenly a prompt ahead of the box. That is not a false alarm. Until the
 * runtime workflow is rebuilt, an eval assembled from the repo would be scoring a prompt that
 * nothing runs, and it would report 6/6 while doing it.
 *
 * =============================================================================================
 * WHY THE NODE KEEPS THE RUNTIME NAME.
 * =============================================================================================
 * "Build Writer Request" is the voice-sync enrolment key. That is per WORKFLOW, and enrolment is by
 * manifest id (sync-n8n-voice.js filters on `voice_sync === true && p.n8n`), so a second workflow
 * carrying the name is not a second sync target: this eval has no manifest row and never will. The
 * precedent settles it anyway, the existing Writer Voice Eval for the other lanes uses the same
 * node name for the same reason. Keeping it means the code below reads its own upstream and
 * downstream node names correctly, and a person comparing the two workflows sees the same node.
 *
 * ONE CONSEQUENCE, STATED SO IT IS NOT DISCOVERED: the sync will never refresh THIS copy, because
 * this workflow is not enrolled. It does not need to. The copy is regenerated from node 29 on every
 * build and it cannot be stale relative to the repo; the pin is what catches it being stale
 * relative to the box.
 */

const E = require('./_eval');

const CODE = E.writerJsCode();
const FP = E.writerFingerprint();

(function assertAgainstUpstream() {
  const seeds = require('./02-build-eval-cases.js');
  if (seeds.name !== 'Build Eval Cases') {
    throw new Error('Build Writer Request (eval): node 02 is named ' + JSON.stringify(seeds.name) + ' and this node connects from "Build Eval Cases".');
  }
  // The prose node reads $input.all() and throws on an empty input. If the seeder ever stops being
  // a Code node that returns items, this harness would fail inside a prompt rather than at build.
  if (seeds.type !== 'n8n-nodes-base.code') {
    throw new Error('Build Writer Request (eval): the seeder is a ' + seeds.type + '. The prose node reads $input.all() and throws on an empty input, so its upstream has to be something that returns items.');
  }
  if (CODE.indexOf('const SYSTEM = ') === -1 || CODE.indexOf('\nconst TONE') === -1) {
    throw new Error(
      'Build Writer Request (eval): the copied code has no `const SYSTEM = ...;` terminated by `const TONE`.\n' +
      '  That pair is how scripts/lib/sync-n8n-voice.js finds the block to refresh. If it is gone from\n' +
      '  the runtime node, the voice sync has silently stopped writing and every letter the live lane\n' +
      '  ships is generic English under his name. This harness is not the place to fix that, but it is\n' +
      '  a good place to notice it.'
    );
  }
  if (CODE.indexOf('<<<SOUL_VOICE_START') === -1) {
    throw new Error('Build Writer Request (eval): the copied code carries no soul voice markers. The runtime node holds a pair rather than write without them, so there is nothing here worth evaluating.');
  }
}());

module.exports = {
  name: 'Build Writer Request',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [520, 0],
  connectFrom: 'Build Eval Cases',
  notes: 'VERBATIM the live prose node: jsCode sha256 ' + FP.sha256 + ', ' + FP.chars + ' characters, taken off nodes/29-build-writer-request.js and refused at build time unless it still hashes to nodes-eval/writer-node.pin.json, which was captured from the live box. No prompt text exists anywhere in nodes-eval/.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: CODE,
  },
};
