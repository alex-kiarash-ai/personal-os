'use strict';
/*
 * 53-create-folder.js - "Create Folder". One Drive folder per shipped pair, inside that lane's own
 * parent folder. The first write this workflow makes outside itself.
 *
 * =============================================================================================
 * 1. THE FOLDER NAME CARRIES THE COMPANY. THE FILES NEVER DO. THAT IS THE DESIGN.
 * =============================================================================================
 * Shaheen, 2026-08-20: a CV or cover letter filename carries his name and nothing else, because the
 * filename travels WITH the attachment and a per company name tells a recruiter, on a forward,
 * exactly who else he applied to. The company, the role and the date have to live somewhere, and
 * the folder is that somewhere: it never leaves this machine and it never leaves his Drive.
 *
 * `folder_name` is READ off the pair. Build Documents composed it, under caps, from the lane label,
 * the date, the employer and the role. This node does not compose one and must not learn how: a
 * second place that knows what a job folder is called is a second thing to keep in step.
 *
 * =============================================================================================
 * 2. THE PARENT IS PER LANE, WHICH IS WHY IT IS AN EXPRESSION AND NOT A CONSTANT.
 * =============================================================================================
 * Two source lanes, two parent folders, one workflow. `drive_parent_folder_id` rides on every pair
 * from Seed Lanes, so the Power BI folder and the AI Automation folder can never be crossed by a
 * node that resolved a constant once. It is the same reason the sheet reads and the sheet writes in
 * this workflow are raw REST rather than the Google node: a node that resolves its target at item
 * zero and uses it for the whole batch cannot serve two lanes.
 *
 * =============================================================================================
 * 3. THIS NODE REPLACES THE ITEM. THAT IS THE SINGLE MOST IMPORTANT FACT ABOUT IT.
 * =============================================================================================
 * The Google Drive node returns the Drive RESOURCE, so the pair that went in does not come out.
 * Everything the rest of the run needs, the pair itself, the two PDFs, the two markdown files, the
 * costs, the reasons, is gone from this item.
 *
 * The staging workflow (v1GbDYganOz9EGpM) hit this in 2026-07 and answered it with a node called
 * Prep for File whose whole job is to put the context back, and which THROWS when no folder id came
 * back rather than carrying on with an undefined. That answer is lifted here, as Attach Folder Ids
 * (node 55), in an N item version. This node does one thing and holds no judgement.
 *
 * =============================================================================================
 * 4. NO RETRY, AND THE REASON IS DIFFERENT FROM EVERY OTHER NO RETRY IN THIS WORKFLOW.
 * =============================================================================================
 * Elsewhere the argument is cost: a retried Anthropic call is a second charge. Drive is free. The
 * argument here is that FOLDER CREATION IS NOT IDEMPOTENT. Google Drive permits two folders with
 * the same name in the same parent, so a retry after a timeout that actually succeeded leaves two
 * folders for one application, one of them empty, and nothing downstream can tell which is which.
 *
 * The recovery already exists and is better: a pair whose folder could not be created is marked
 * error:drive by Attach Folder Ids, its sheet row is LEFT AT `new`, and tomorrow morning offers the
 * same job again. Nothing is lost except one morning.
 *
 * =============================================================================================
 * 5. onError: continueRegularOutput, SO A REFUSED CREATE ARRIVES AS DATA.
 * =============================================================================================
 * Throwing here would take down the whole run: every other shipped pair, every held pair carrying
 * the reason a person needs to read, every lane report, every stage report, and the run row that
 * makes the daily cap true tomorrow. One Drive permission error must not cost all of that. The
 * failed item arrives at Attach Folder Ids carrying an `error` field, the count stays aligned, and
 * exactly one pair is marked.
 */

const LN = require('./_lane');
const W = require('./_write');

(function assertAgainstUpstream() {
  const route = require('./52-folder-route.js');
  if (route.name !== 'Folder Route') {
    throw new Error('Create Folder: node 52 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Folder Route" output 0. The name is the connection key.');
  }
  const build = require('./44-build-documents.js');
  const src = String(build.parameters.jsCode || '');
  if (src.indexOf('j.folder_name = folder.name;') === -1) {
    throw new Error(
      'Create Folder: Build Documents no longer stamps folder_name on the pair, which is the entire\n' +
      '  name this node asks Drive for. It is read rather than composed here so exactly one node in this\n' +
      '  workflow decides what a job folder is called, and that node is the one that also knows the\n' +
      '  length caps and the company and role it is allowed to put in it.'
    );
  }
  // The parent folder id rides from Seed Lanes on every pair. Without it this node would create the
  // folder in the Drive ROOT, which succeeds, returns 200, and scatters job folders across My Drive.
  const seed = require('./03-seed-lanes.js');
  if (String(seed.parameters.jsCode || '').indexOf('drive_parent_folder_id') === -1) {
    throw new Error('Create Folder: Seed Lanes no longer carries drive_parent_folder_id, and without a parent the Drive node creates the folder in the root of My Drive with a perfectly healthy 200.');
  }
  // Both lane entries must actually carry one. _lane.js already refuses an empty value; this asserts
  // the two are DIFFERENT, which is the failure that would silently merge the lanes.
  const lanes = LN.lanes();
  const ids = lanes.map((l) => l.drive_parent_folder_id);
  if (ids[0] === ids[1]) {
    throw new Error(
      'Create Folder: both source lanes point at the SAME Drive parent folder.\n' +
      '  Every Power BI application and every AI Automation application would land in one folder, and\n' +
      '  because a folder name ends with the lane label and the job id they would not even collide, so\n' +
      '  nothing at all would report the mix. Check config/lane.json lanes.bi and lanes.ai.'
    );
  }
}());

module.exports = {
  name: 'Create Folder',
  type: 'n8n-nodes-base.googleDrive',
  typeVersion: 3,
  position: [13260, 0],
  connectFrom: { node: 'Folder Route', outputIndex: 0 },
  // A refused create is DATA. See note 5.
  onError: 'continueRegularOutput',
  notes: 'One folder per shipped pair, named by the pair and created inside that lane own parent folder, which rides on the item so the two lanes can never be crossed. This node REPLACES the item with the Drive resource, which is why Attach Folder Ids exists two nodes later. Never retried: Drive permits two folders with the same name in the same parent, so a retry after a timeout that actually succeeded leaves one application with two folders and one of them empty. A refused create arrives as data and marks exactly one pair error:drive, leaving its sheet row at new so tomorrow offers the job again.',
  credentials: W.googleDriveCredential(),
  parameters: {
    resource: 'folder',
    name: '={{ $json.folder_name }}',
    driveId: { __rl: true, value: 'My Drive', mode: 'list', cachedResultName: 'My Drive' },
    folderId: { __rl: true, value: '={{ $json.drive_parent_folder_id }}', mode: 'id' },
    options: {},
  },
};
