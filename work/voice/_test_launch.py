import sys, time
sys.path.insert(0, ".")
from alex_voice import Alex
t0 = time.time()
try:
    a = Alex()                      # launches claude via shutil.which + cmd/c, reads until 'init'
    print(f"\nLAUNCH OK in {time.time()-t0:.1f}s  (no WinError 2, session init received)")
    a.close()
except FileNotFoundError as e:
    print("STILL BROKEN (WinError 2):", e)
except Exception as e:
    print("other error:", type(e).__name__, e)
