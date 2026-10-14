#!/usr/bin/env python3
"""Verify asynchronous cache fills, request deduplication and core replacement."""
from pathlib import Path
import subprocess, tempfile, time
R=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='komari-version-test-') as d:
 root=Path(d);helper=root/'helper';binary=root/'core';binary.write_text('1.5.1\n');binary.chmod(0o755)
 source=(R/'root/usr/libexec/komari-cached-version').read_text()
 source=source.replace('/usr/bin/komari-agent',str(binary)).replace('/usr/bin/komari',str(binary)).replace('/usr/libexec/komari-cached-version',str(helper)).replace('/tmp/komari-versions',str(root/'cache'))
 for name,fn in [('komari-common','komari_version'),('komari-agent-common','komari_agent_version')]:
  common=root/name;common.write_text(fn+'() { echo scan >> "'+str(root/'scans')+'"; sleep 0.4; cat "$1"; }\n')
  source=source.replace('/usr/libexec/'+name,str(common))
 helper.write_text(source);helper.chmod(0o755)
 def read():return subprocess.run([str(helper),'read','agent'],text=True,capture_output=True,check=True).stdout.strip()
 start=time.monotonic();assert read()=='Checking version...';assert time.monotonic()-start<0.3
 for i in range(8):assert read()=='Checking version...'
 def wait_version(expected):
  deadline=time.monotonic()+4
  while time.monotonic()<deadline:
   if read()==expected:return
   time.sleep(.05)
  raise AssertionError('Cache did not fill')
 wait_version('1.5.1')
 assert (root/'scans').read_text().count('scan')==1,'Concurrent status requests repeated the expensive scan'
 for i in range(5):assert read()=='1.5.1'
 assert (root/'scans').read_text().count('scan')==1
 replacement=root/'new-core';replacement.write_text('1.5.2\n');replacement.chmod(0o755);replacement.replace(binary)
 assert read()=='Checking version...';wait_version('1.5.2')
 assert (root/'scans').read_text().count('scan')==2
 binary.unlink();assert read()=='Not installed'
print('Immediate cold-cache response, one concurrent scan, cached reads and replacement invalidation passed')
