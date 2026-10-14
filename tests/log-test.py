#!/usr/bin/env python3
"""Verify file clearing, category isolation, and native logread settings."""
from pathlib import Path
import subprocess
import tempfile
R=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='komari-file-log-test-') as temp:
 root=Path(temp);logs=root/'logs';logs.mkdir()
 source=(R/'root/usr/libexec/komari-system-log').read_text().replace('/var/log/komari',str(logs))
 helper=root/'helper';helper.write_text(source)
 def run(action,category):
  return subprocess.run(['busybox','ash',str(helper),action,category],text=True,capture_output=True)
 for category in ['server','agent','server-update','agent-update']:
  (logs/(category+'.log')).write_text(category+' ready\n')
  (logs/(category+'.log.old')).write_text('retained history\n')
 for category in ['server','agent','server-update','agent-update']:
  assert run('read',category).stdout==category+' ready\n'
 assert run('clear','server').returncode==0
 assert (logs/'server.log').stat().st_size==0
 assert run('read','agent').stdout=='agent ready\n'
 assert (logs/'server.log.old').read_text()=='retained history\n'
 with (logs/'server.log').open('a') as stream:stream.write('new entry\n')
 assert run('read','server').stdout=='new entry\n'
 assert run('clear','../outside').returncode!=0
 writer=(R/'root/usr/libexec/komari-log-writer').read_text().replace('/var/log/komari',str(logs)).replace('/sbin/logread',str(root/'logread'))
 writer=writer.replace('size="$(uci -q get system.@system[0].log_size)"','size=128')
 (root/'writer').write_text(writer)
 (root/'logread').write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n');(root/'logread').chmod(0o755)
 result=subprocess.run(['busybox','ash',str(root/'writer'),'agent'],capture_output=True,text=True,check=True)
 assert result.stdout.splitlines()==['-f','-F',str(logs/'agent.log'),'-e',r'^komari-agent-run\[[0-9][0-9]*\]:','-S','128']
for name in ['komari-log-limit','komari-agent-log-limit','komari-run-logged','komari-log-filter']:
 assert not (R/'root/usr/libexec'/name).exists()
print('Independent log files, direct truncation, isolated clearing and native system-size rotation passed')
