"""Small offline checkpoints; the Windows test sends a real console Ctrl+C event."""
import json
import os
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing
from pathlib import Path

from clean_muse import LOCAL
from reccobeats_batch import SimulatedClock
from reccobeats_full import graceful_interrupt
from reccobeats_research import MODE, ResearchCheckpoint, ResearchEngine, ResearchTransport


GROUPS={str(i).zfill(22):[dict(external_id=str(i),title='Song',artist='Artist')] for i in range(100)}


def checkpoint(path):
    return ResearchCheckpoint(path,GROUPS,{},dict(mode=MODE,fixture='interrupt-offline'))


def engine(cp,send,clock,stop=None,sleep=None):
    return ResearchEngine(cp,ResearchTransport(cp,execute=True,send=send),clock=clock,
                          sleep=sleep or clock.sleep,stop_requested=stop)


def console_child(path):
    clock=SimulatedClock()
    def send(*args):
        # Same hidden PowerShell subprocess mechanism as the real transport, no HTTP.
        ready=str(path/'ready').replace("'","''")
        script="[IO.File]::WriteAllText('"+ready+"','ready'); Start-Sleep -Milliseconds 2000; [Console]::Out.Write('ok')"
        response=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',script],
            capture_output=True,text=True,timeout=30,creationflags=subprocess.CREATE_NO_WINDOW)
        assert response.returncode==0 and response.stdout=='ok'
        return 200,{},dict(content=[])
    with graceful_interrupt() as stop:
        with checkpoint(path/'checkpoint') as cp:
            outcome=engine(cp,send,clock,stop).run()
    (path/'result.json').write_text(json.dumps(dict(outcome=outcome)),encoding='utf-8')


class InterruptTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=LOCAL)
        self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)
        self.clock=SimulatedClock()

    def test_ctrl_c_finishes_request_then_resume_skips_completed(self):
        previous=signal.getsignal(signal.SIGINT)
        def send(*args):
            signal.raise_signal(signal.SIGINT)
            signal.raise_signal(signal.SIGINT)  # Repeated Ctrl+C must not interrupt the commit.
            return 200,{},dict(content=[])
        with graceful_interrupt() as stop:
            with checkpoint(self.path) as cp:
                self.assertEqual(engine(cp,send,self.clock,stop).run(),'interrupted_by_user')
                self.assertEqual(cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0],1)
                self.assertEqual(cp.db.execute("SELECT count(*) FROM jobs WHERE state='inflight'").fetchone()[0],0)
                completed=tuple(cp.db.execute('SELECT * FROM attempts').fetchone())
        self.assertEqual(signal.getsignal(signal.SIGINT),previous)
        self.assert_resume(completed)

    def assert_resume(self,completed):
        with checkpoint(self.path) as cp:
            self.assertEqual(cp.db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertFalse(cp.db.execute('PRAGMA foreign_key_check').fetchall())
            sent=[]
            send=lambda *args:(sent.append(args[1]) or (200,{},dict(content=[])))
            with graceful_interrupt() as stop:
                self.assertEqual(engine(cp,send,self.clock,stop).run(),'completed')
            self.assertEqual(len(sent),9)
            self.assertEqual(tuple(cp.db.execute('SELECT * FROM attempts WHERE job_key=? AND attempt=?',
                                                completed[:2]).fetchone()),completed)
            self.assertEqual(engine(cp,lambda *a:self.fail('Completed replay'),self.clock).run(),'completed')

    def test_ctrl_c_during_wait_preserves_deadline_and_makes_no_request(self):
        with checkpoint(self.path) as cp:
            with cp.db: cp.put('not_before',120)
            def sleep(seconds):
                self.clock.sleep(seconds)
                signal.raise_signal(signal.SIGINT)
            with graceful_interrupt() as stop:
                self.assertEqual(engine(cp,lambda *a:self.fail('Request during stop'),self.clock,stop,sleep).run(),
                                 'interrupted_by_user')
            self.assertEqual(float(cp.get('not_before')),120)
            self.assertEqual(cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0],0)

    def test_forced_interruption_is_uncertain_and_never_auto_replayed(self):
        def interrupt(*args): raise KeyboardInterrupt
        with checkpoint(self.path) as cp:
            with self.assertRaises(KeyboardInterrupt): engine(cp,interrupt,self.clock).run()
        with checkpoint(self.path) as cp:
            self.assertEqual(engine(cp,lambda *a:self.fail('Uncertain replay'),self.clock).run(),
                             'operator_review_required')
            self.assertEqual(cp.db.execute("SELECT count(*) FROM jobs WHERE state='uncertain'").fetchone()[0],1)
            self.assertEqual(cp.db.execute('PRAGMA integrity_check').fetchone()[0],'ok')

    @unittest.skipUnless(os.name=='nt','Windows console test')
    def test_windows_powershell_real_ctrl_c_during_hidden_child_request(self):
        # Give the fixture its own hidden console so the user's console is never signalled.
        startup=subprocess.STARTUPINFO()
        startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW
        startup.wShowWindow=0
        quote=lambda value:"'"+str(value).replace("'","''")+"'"
        command='& '+quote(sys.executable)+' -B '+quote(Path(__file__).resolve())+' --console-child '+quote(self.path)
        process=subprocess.Popen(['powershell.exe','-NoProfile','-Command',command],
            creationflags=subprocess.CREATE_NEW_CONSOLE,startupinfo=startup,
            stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            deadline=time.monotonic()+20
            while not (self.path/'ready').exists() and time.monotonic()<deadline:
                if process.poll() is not None: self.fail('Fixture exited before console event')
                time.sleep(.05)
            self.assertTrue((self.path/'ready').exists())
            # Separate sender never detaches or changes this test runner's console.
            sender="import ctypes,time; k=ctypes.windll.kernel32; k.FreeConsole(); assert k.AttachConsole("+str(process.pid)+"); k.SetConsoleCtrlHandler(None,True); assert k.GenerateConsoleCtrlEvent(0,0); time.sleep(.2); k.FreeConsole()"
            subprocess.run([sys.executable,'-c',sender],check=True,timeout=10,
                           creationflags=subprocess.CREATE_NO_WINDOW,capture_output=True)
            deadline=time.monotonic()+15
            while not (self.path/'result.json').exists() and time.monotonic()<deadline:
                time.sleep(.05)
            self.assertTrue((self.path/'result.json').exists(),'Ctrl+C did not exit safely')
            self.assertEqual(json.loads((self.path/'result.json').read_text())['outcome'],'interrupted_by_user')
            process.wait(timeout=10)
            with closing(sqlite3.connect(self.path/'checkpoint/checkpoint.sqlite')) as db:
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
                self.assertEqual(db.execute("SELECT count(*) FROM jobs WHERE state='done'").fetchone()[0],1)
                self.assertEqual(db.execute('SELECT count(*) FROM attempts WHERE status=200').fetchone()[0],1)
                self.assertEqual(db.execute("SELECT count(*) FROM jobs WHERE state IN ('inflight','uncertain')").fetchone()[0],0)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=10)


if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--console-child': console_child(Path(sys.argv[2]))
    else: unittest.main()
