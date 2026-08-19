"""
Render the FROZEN AI master to the default plain-ATS deliverables (.docx + .pdf).

The master is rendered AS-IS. Nothing is pinned, substituted or "corrected" on the way out,
because Shaheen froze the file on 2026-08-19 with "not a word or a colour or a font" changed.

Font note, recorded 2026-08-19 so nobody re-discovers it and silently "fixes" it:
every body run in the master carries <w:rFonts w:asciiTheme="majorBidi"> (1088 of them, stamped by
the PDF -> docx conversion chain the file came through), and the theme's majorFont <a:cs> typeface
is EMPTY. So the file does not actually name a font for its body text; each renderer falls back to
its own default, and LibreOffice falls back to Times New Roman. The previous lane docx carried 64
explicit w:ascii="Calibri" runs, which is why it rendered Calibri. Pinning Calibri here WOULD render
the old look, but it would also be changing the font, which is exactly what he forbade. So this
script reports the fonts it produced and never overrides them. If he wants Calibri back, that is his
call to make, not a silent repair.

Usage: python scripts/render-cv-ai.py [outdir]     default outdir: outputs/cv/<today>/ai
"""
import os, shutil, subprocess, sys, datetime, tempfile

ROOT    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER  = os.path.join(ROOT, 'vault', 'me', 'cv', 'ai', 'master-ai-cv.docx')
NAME    = 'Shaheen_Kiarash_AI_Automation_Engineer'
SOFFICE = r'C:\Program Files\LibreOffice\program\soffice.exe'

def main():
    outdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        ROOT, 'outputs', 'cv', datetime.date.today().isoformat(), 'ai')
    os.makedirs(outdir, exist_ok=True)
    if not os.path.exists(MASTER):
        raise SystemExit('FATAL: missing %s' % MASTER)

    tmpdir = tempfile.mkdtemp(prefix='cv-render-')
    try:
        tmp = os.path.join(tmpdir, NAME + '.docx')
        shutil.copy(MASTER, tmp)                     # unmodified copy, just renamed for the output
        subprocess.run([SOFFICE, '--headless', '--convert-to', 'pdf', '--outdir', tmpdir, tmp],
                       check=True, capture_output=True)
        pdf_tmp = os.path.join(tmpdir, NAME + '.pdf')
        if not os.path.exists(pdf_tmp):
            raise SystemExit('FATAL: LibreOffice produced no PDF')
        pdf_out, docx_out = os.path.join(outdir, NAME + '.pdf'), os.path.join(outdir, NAME + '.docx')
        shutil.copy(pdf_tmp, pdf_out)
        shutil.copy(MASTER, docx_out)                # the .docx deliverable IS the master, byte-identical
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)    # temp artifacts never survive a run

    import fitz, filecmp
    d = fitz.open(pdf_out)
    fonts = sorted({f[3].split('+')[-1] for p in d for f in p.get_fonts(full=True)})
    text  = '\n'.join(p.get_text() for p in d)
    print('rendered : %s' % pdf_out)
    print('  pages  : %d' % d.page_count)
    print('  text   : %d chars (healthy text layer, ATS-parsable)' % len(text))
    print('  fonts  : %s   <- reported, never overridden' % ', '.join(fonts))
    print('docx     : %s' % docx_out)
    print('  byte-identical to the master: %s' % filecmp.cmp(MASTER, docx_out, shallow=False))
    if d.page_count != 3:
        print('  NOTE: page count changed from the master\'s recorded 3.')

if __name__ == '__main__':
    main()
