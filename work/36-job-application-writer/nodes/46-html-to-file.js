'use strict';
/*
 * 46-html-to-file.js - "HTML to File". Turns the `html` string on a render item into a binary file
 * called index.html, which is the only thing the Gotenberg Chromium route will accept.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. THE FILE NAME IS NOT COSMETIC. IT IS THE API.
 * ---------------------------------------------------------------------------------------------
 * Gotenberg's /forms/chromium/convert/html route dispatches on the name of the uploaded file: the
 * document it renders MUST be called index.html, and the request fails if no file in the form has
 * that name. Any other asset in the form would be a sibling resource the page can reference. So
 * `options.fileName` here is load bearing in a way a file name almost never is, and it is the same
 * literal string for both documents on purpose: the CV and the letter are two requests, never two
 * files in one request, and the name a recruiter sees is applied to the PDF at the other end by
 * Check Renders, from the pair, never here.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. utf8, STATED.
 * ---------------------------------------------------------------------------------------------
 * The encoding option defaults to utf8 and it is written down anyway. A Swedish company name, a
 * Swedish city and his own surname all sit in these documents, and an encoding that changed under a
 * default would not error: it would produce a PDF with mojibake in the middle of a name, which every
 * check downstream would happily pass because the text layer still parses and still carries his
 * name. The HTML document itself also declares its charset in a meta tag, built by node 44. Two
 * declarations of one fact, deliberately: Chromium reads the meta tag, n8n writes the bytes, and
 * they have to agree.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. THE MIME TYPE, AND THE HONEST NOTE ABOUT IT.
 * ---------------------------------------------------------------------------------------------
 * The approved plan pins text/html and it is set. The published n8n documentation for this operation
 * lists only File Name and Encoding under its options, so THIS SEAT CANNOT PROVE FROM HERE that the
 * mimeType key is read rather than dropped, and n8n drops an unknown parameter on save without an
 * error. Stated rather than assumed, with the consequence: if it is dropped, the binary is labelled
 * text/plain and the multipart part carries that content type. GOTENBERG DOES NOT CARE, because it
 * keys on the file NAME, which is the paragraph above. So the render still works either way, and the
 * only thing at risk is a label. Seat 8's live drill is what settles it.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. THE OUTPUT BINARY PROPERTY IS `data`, THE n8n DEFAULT, AND EVERY NODE AFTER THIS ONE SAYS SO.
 * ---------------------------------------------------------------------------------------------
 * Render PDF sends `data`, Extract PDF Text reads `data`, Measure PDF asks the helper for `data`.
 * The chain is four nodes long and the name is the same string in all of them; the build assertions
 * in those files check each other rather than each trusting a default.
 */

(function assertAgainstUpstream() {
  const route = require('./45-render-route.js');
  if (route.name !== 'Render Route') {
    throw new Error('HTML to File: node 45 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Render Route" output 0. Rename both in the same edit.');
  }
  const build = require('./44-build-documents.js');
  const code = String(build.parameters.jsCode || '');
  const charsetLine = "'<meta charset=' + DQ + 'utf-8' + DQ + '>'";
  if (code.indexOf(charsetLine) === -1) {
    throw new Error(
      'HTML to File: Build Documents no longer writes ' + charsetLine + ' into the HTML document.\n' +
      '  The file this node produces is utf8 bytes and Chromium has to be told so in the document\n' +
      '  itself. Without the declaration a Swedish name renders as mojibake, and every check after the\n' +
      '  render passes it: the text layer still parses, the page count is still one, and his name is\n' +
      '  still findable because the mangled characters are in the middle of somebody else name.'
    );
  }
}());

const FILE_NAME = 'index.html';
const MIME = 'text/html';
const ENCODING = 'utf8';

module.exports = {
  name: 'HTML to File',
  type: 'n8n-nodes-base.convertToFile',
  typeVersion: 1.1,
  position: [11440, 0],
  connectFrom: { node: 'Render Route', outputIndex: 0 },
  notes: 'Writes the `html` string of a render item into a binary file named index.html on the default `data` property. The name is the API rather than a label: the Gotenberg Chromium route dispatches on it and refuses a form with no index.html in it. utf8 is stated rather than defaulted, because an encoding that changed under a default would produce mojibake inside a name and every check downstream would still pass.',
  parameters: {
    operation: 'toText',
    sourceProperty: 'html',
    options: {
      fileName: FILE_NAME,
      mimeType: MIME,
      encoding: ENCODING,
    },
  },
};
