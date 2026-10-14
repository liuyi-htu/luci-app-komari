#!/usr/bin/env python3
"""Verify installation/image defaults register both services without starting them."""
from pathlib import Path
import os, re, subprocess, tempfile
R=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='komari-boot-test-') as d:
 root=Path(d)
 for p in ['etc/init.d','etc/config','usr/libexec','tmp','var/log','mock']:(root/p).mkdir(parents=True)
 calls=root/'calls'
 for service in ['komari','komari-agent']:
  script=root/'etc/init.d'/service
  script.write_text('#!/bin/sh\nprintf "%s %s\\n" "'+service+'" "$1" >> "'+str(calls)+'"\n')
  script.chmod(0o755)
 for config in ['komari','komari_agent']:(root/'etc/config'/config).write_text("config main 'main'\n option enabled '1'\n")
 (root/'usr/libexec/komari-test').touch()
 mock=root/'mock/uci';mock.write_text('#!/bin/sh\ncase "$*" in *get*) printf "1\\n";; esac\n');mock.chmod(0o755)
 source=(R/'root/etc/uci-defaults/99-luci-app-komari').read_text()
 source=re.sub(r'/etc/|/usr/|/tmp/|/var/',lambda m:str(root)+m[0],source)
 script=root/'defaults';script.write_text(source)
 subprocess.run(['busybox','ash',str(script)],env=dict(os.environ,PATH=str(root/'mock')+':'+os.environ['PATH']),check=True,capture_output=True)
 assert calls.read_text().splitlines()==['komari enable','komari-agent enable']
 for config in ['komari','komari_agent']:
  assert "option enabled '1'" in (root/'etc/config'/config).read_text()
for service in ['komari','komari-agent']:
 source=(R/'root/etc/init.d'/service).read_text()
 assert '[ "$enabled" =' in source,'Boot startup must honor the UCI enabled flag'
print('Image/package defaults enable both boot entries, preserve config, and do not start services passed')
