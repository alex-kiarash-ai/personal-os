#!/usr/bin/env python
"""
Build the AI-lane master CV text mirror from the FROZEN .docx.

Why this exists (2026-08-19, Shaheen's order): the AI-lane master is now a .docx that must be
used exactly as he wrote it. Nothing downstream can read a .docx:
`work/03-application-engine/config/resync-cv-2026-07-14.js` does fs.readFileSync(..., 'utf8')
and pushes the text as a JS string literal into two n8n Code nodes. So the .docx is the source
of truth and this script derives the text mirror the machines actually consume.

Contract, do not break:
  * master-ai-cv.md is GENERATED. Never hand-edit it; edits die on the next run.
  * The notes ride under the EXACT heading "## WRITER-AGENT NOTES (not printed)". The resync
    script's printable() splits on that string so negative marks are checked against the
    recruiter-facing half only, and one POSITIVE mark lives inside the notes.
  * Same idiom as soul-core.md: generated artifact, stamped with the source hash.

Run:  python scripts/build-cv-master.py [--check]
      --check exits 1 if the mirror is stale instead of writing it.
"""
import hashlib, io, os, sys, datetime

ROOT  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR   = os.path.join(ROOT, 'vault', 'me', 'cv', 'ai')
DOCX  = os.path.join(DIR, 'master-ai-cv.docx')
NOTES = os.path.join(DIR, 'writer-notes-ai.md')
OUT   = os.path.join(DIR, 'master-ai-cv.md')
NOTES_HEADING = '## WRITER-AGENT NOTES (not printed)'

def sha(path):
    with open(path, 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()

def docx_to_md(path):
    from docx import Document
    d = Document(path)
    lines, header_done = [], False
    for p in d.paragraphs:
        t = p.text.rstrip()
        if not t:
            continue
        st = p.style.name
        if st == 'Title':
            lines.append('# ' + t)
        elif st == 'Heading 1':
            header_done = True
            lines.append('')
            lines.append('## ' + t)
        elif st == 'Heading 2':
            lines.append('')
            lines.append('### ' + t)
        elif st == 'List Paragraph':
            lines.append('- ' + t)
        else:  # Normal / Body Text
            lines.append('')
            lines.append(t)
    # collapse runs of blank lines, drop leading blanks
    out, prev_blank = [], True
    for l in lines:
        blank = (l == '')
        if blank and prev_blank:
            continue
        out.append(l)
        prev_blank = blank
    return '\n'.join(out).strip() + '\n'

def notes_body(path):
    """Take the '## Notes' bullet list plus any trailing sections, drop the file's own preamble."""
    txt = io.open(path, encoding='utf-8').read()
    i = txt.find('\n## Notes')
    if i < 0:
        raise SystemExit('FATAL: "## Notes" section not found in %s' % path)
    body = txt[i + len('\n## Notes'):].strip()
    return body + '\n'

def build():
    body  = docx_to_md(DOCX)
    notes = notes_body(NOTES)
    parts = [
        '# MASTER CV (AI) - Shaheen Kiarash',
        '> GENERATED FILE. Source of truth is master-ai-cv.docx in this folder, FROZEN by Shaheen 2026-08-19.',
        '> Never hand-edit this file and never write an AI CV from memory. Reuse his exact sentences,',
        '> words and tense; tailoring means selecting, reordering and keyword-mirroring, never rewriting.',
        '> Rebuild with: python scripts/build-cv-master.py',
        '',
        '---',
        '',
        body.strip(),
        '',
        '---',
        '',
        NOTES_HEADING,
        '',
        notes.strip(),
        '',
    ]
    return '\n'.join(parts)

def stamp_line(content):
    return 'SOURCE-STAMP: docx-sha256=%s notes-sha256=%s content-sha256=%s generated-at=%s\n' % (
        sha(DOCX), sha(NOTES),
        hashlib.sha256(content.encode('utf-8')).hexdigest()[:16],
        datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))

def current_content():
    if not os.path.exists(OUT):
        return None
    txt = io.open(OUT, encoding='utf-8').read()
    return txt.split('\nSOURCE-STAMP:')[0]

def main():
    check = '--check' in sys.argv
    for p in (DOCX, NOTES):
        if not os.path.exists(p):
            raise SystemExit('FATAL: missing %s' % p)
    content = build()
    if current_content() == content:
        print('no-op: master-ai-cv.md already matches the docx + notes (nothing written)')
        return 0
    if check:
        print('STALE: master-ai-cv.md does not match its sources. Run without --check to rebuild.')
        return 1
    with io.open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)
        f.write('\n' + stamp_line(content))
    print('wrote %s (%d chars)' % (OUT, len(content)))
    print('  docx  sha256 %s' % sha(DOCX))
    print('  notes sha256 %s' % sha(NOTES))
    return 0

if __name__ == '__main__':
    sys.exit(main())
