#!/usr/bin/env python3
"""Validate Agent settings and test offline core installation in isolated paths."""
import io
import os
import re
import subprocess
import tempfile
from pathlib import Path
R = Path(__file__).resolve().parents[1]
common = (R / 'root/usr/libexec/komari-agent-common').read_text()
def validate(endpoint, token, interval='3', remote='1', tls='0', nics='', mounts='', month='0', memory='0', nicip='0'):
 script=common+'\nendpoint="$1"; token="$2"; interval="$3"; disable_web_ssh="$4"; ignore_unsafe_cert="$5"; include_nics="$6"; exclude_nics=""; include_mountpoints="$7"; month_rotate="$8"; memory_include_cache="$9"; get_ip_addr_from_nic="${10}"; komari_agent_validate'
 return subprocess.run(['busybox','ash','-c',script,'test',endpoint,token,interval,remote,tls,nics,mounts,month,memory,nicip],capture_output=True).returncode
assert validate('http://127.0.0.1:25774', 'node-token') == 0
assert validate('https://example.com/base', 'node-token', nics='eth0,br-lan', mounts='/;/overlay') == 0
for endpoint,token,interval in [('ftp://panel','token','3'),('https://panel/$(id)','token','3'),('http://panel','','3'),('https://panel','bad token','3'),('https://panel','token','0'),('https://panel','token','3601')]:
 assert validate(endpoint,token,interval) != 0
assert validate('https://panel','token',remote='2') != 0
assert validate('https://panel','token',month='32') != 0
assert validate('https://panel','token',month='31',memory='1',nicip='1') == 0
assert validate('https://panel','token',nics='eth0;id') != 0
with tempfile.TemporaryDirectory(prefix='agent-test-') as temp:
 root=Path(temp); (root/'var/log').mkdir(parents=True); (root/'usr/bin').mkdir(parents=True); lib=root/'usr/libexec';lib.mkdir()
 (lib/'komari-agent-common').write_text(common)
 (lib/'komari-log-writer').write_text('#!/bin/sh\nexit 0\n'); (lib/'komari-log-writer').chmod(0o755)
 uploads=root/'tmp/komari-agent/uploads';uploads.mkdir(parents=True)
 updater=(R/'root/usr/libexec/komari-agent-update').read_text()
 updater=re.sub(r'/usr/libexec/|/usr/bin/|/tmp/komari-agent|/var/log/',lambda m:str(root)+m[0],updater)
 updater=updater.replace('set -u','set -u\nlogger() { :; }\npidof() { [ "${MOCK_RUNNING:-0}" = 1 ]; }')
 update=root/'update';update.write_text(updater)
 def candidate(version):
  source=root/'fixture.c'; source.write_text('#include <stdio.h>\nconst char v[]="\\0" "'+version+'"; int main(){puts("komari agent");puts(v+1);return 0;}\n')
  subprocess.run(['cc',str(source),'-o',str(uploads/'komari-agent-upload.tar.gz')],check=True)
 def run(running='0'):
  return subprocess.run(['busybox','ash',str(update),'local',str(uploads/'komari-agent-upload.tar.gz')],env=dict(os.environ,MOCK_RUNNING=running),capture_output=True)
 candidate('1.5.11'); result=run();assert result.returncode==0,result.stderr
 original=(root/'usr/bin/komari-agent').read_bytes()
 candidate('1.4.0');assert run().returncode==0;assert (root/'usr/bin/komari-agent').read_bytes()==original
 candidate('1.6.0');assert run('1').returncode!=0;assert (root/'usr/bin/komari-agent').read_bytes()==original
 candidate('1.6.0');assert run().returncode==0
assert '/komari-monitor/komari-agent/releases/latest' in (R/'root/usr/libexec/komari-agent-update').read_text()
assert 'AGENT_TOKEN="$token"' in (R/'root/etc/init.d/komari-agent').read_text()
print('Agent URL/token/interval validation, offline ELF installation, downgrade/running guards and official release URL passed')
