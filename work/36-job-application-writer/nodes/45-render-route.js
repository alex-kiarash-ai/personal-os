'use strict';
/*
 * 45-render-route.js - "Render Route". Output 0: the two-per-pair render items that get turned into
 * PDFs. Output 1: every pair, every lane report and every stage report, carried straight to Render
 * Results.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CONDITION IS `_kind`, NOT `_call_now`, FOR THE REASON SITE ROUTE GIVES.
 * ---------------------------------------------------------------------------------------------
 * This is the second stage in the workflow whose true side carries a DIFFERENT KIND OF ITEM rather
 * than a subset of the same one. Every pair takes the carry side by definition, so a route on a
 * boolean would be testing "is this not a pair" the long way round, and the thing actually being
 * routed would not be named anywhere in the node.
 *
 * Build Documents stamps `_call_now` as exactly this predicate anyway, so the one-boolean convention
 * holds across the workflow and the two can be checked against each other. The build assertion below
 * is what stops them drifting: if the stamp and this route stopped meaning the same thing, a pair
 * could be routed into a file conversion whose source property it does not carry, and the only
 * symptom would be an empty binary.
 *
 * ---------------------------------------------------------------------------------------------
 * typeValidation: strict, AND WHY IT IS SAFE HERE.
 * ---------------------------------------------------------------------------------------------
 * Under strict validation an item arriving with no `_kind` is an ERROR rather than a false. That is
 * wanted. Every item in this workflow carries one: Build Candidates stamps it on pairs, lane reports
 * and its own stage report, every Code node since has carried it through, and Build Documents stamps
 * it on the render items it invents. An item without one would be an item nobody built, and routing
 * it quietly to the carry side would hide that.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE ROUTE AND THE MERGE EXIST AT ALL, for the fifth time in this workflow.
 * ---------------------------------------------------------------------------------------------
 * n8n does not run a node whose input carries no items. A run with NOTHING to render is ordinary
 * here, not exceptional: both lanes capped out, every qualifier already written, an Anthropic outage
 * at the reader, or every letter held by the blind grade. In a straight chain any one of those would
 * skip the conversion, skip the render, skip the extraction and skip Check Renders, and the branch
 * would end carrying every lane report, every held pair and ten stage reports with it, so the run
 * would finish having written nothing and said nothing about why.
 */

const CONDITION_ID = 'd4b7e9a1-6c35-4f28-8b90-2e17a5c3d6f4';

(function assertAgainstUpstream() {
  const build = require('./44-build-documents.js');
  if (build.name !== 'Build Documents') {
    throw new Error('Render Route: node 44 is named ' + JSON.stringify(build.name) + ' and this node connects from "Build Documents". Rename both in the same edit.');
  }
  const code = String(build.parameters.jsCode || '');

  // Every stamp checked by its exact text, on BOTH sides. A looser check passes on a file that
  // mentions the field once and never stamps a carried item with it, which is the one failure that
  // would send every pair down the error path under strict validation.
  const stamps = [
    ["_kind: 'render',", 'the kind this route sends down output 0'],
    ["_call_now: true,", 'the true boolean on a render item, which must mean the same thing as this route'],
    ['j._call_now = false;', 'the false boolean on every pair and every carried item'],
    ['_call_now: false,', 'the false boolean on the stage report itself'],
  ];
  for (const [needle, what] of stamps) {
    if (code.indexOf(needle) === -1) {
      throw new Error(
        'Render Route: Build Documents no longer contains ' + JSON.stringify(needle) + ', which is ' + what + '.\n' +
        '  Under strict type validation a missing field here is an ERROR rather than a false, so an item\n' +
        '  without it fails the route instead of taking the carry side, and the run loses its reports.\n' +
        '  If the stamp legitimately moved, update this exact string in the same edit.'
      );
    }
  }
  // The field the node on the true side converts into a file. A render item without it would be
  // turned into an empty index.html, which Chromium renders as a blank page that passes R1 on bytes
  // and fails everything after it for reasons nobody could read.
  if (code.indexOf('html: cvHtml,') === -1 || code.indexOf('html: letterHtml,') === -1) {
    throw new Error('Render Route: Build Documents no longer puts `html` on both render items, which is the entire document the node on the true side converts to a file.');
  }
  // Two per pair. Every node after the render call pairs responses back to documents on this count.
  if (code.indexOf('stats.renders_queued += 2;') === -1) {
    throw new Error('Render Route: Build Documents no longer queues exactly two render items per pair. The CV and the letter are one folder, and a stage that can emit one of them is a stage that can upload half an application.');
  }
}());

module.exports = {
  name: 'Render Route',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [11180, 100],
  connectFrom: 'Build Documents',
  notes: 'Output 0 (true): the two render items per shipped pair, one for the CV and one for the cover letter. Output 1 (false): every pair alive or held, every lane report and every stage report, carried straight to Render Results. Strict validation, so an item with no _kind is a loud contract violation rather than a silent reroute. This route is also the authoritative SENT ORDER: Measure PDF reads its output 0 to pair each PDF back to the document it was asked for, rather than trusting whatever came back to be in the order it was sent.',
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: CONDITION_ID,
          leftValue: '={{ $json._kind }}',
          rightValue: 'render',
          operator: { type: 'string', operation: 'equals' },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
};
