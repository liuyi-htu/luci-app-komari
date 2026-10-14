#!/usr/bin/env python3
"""Exercise service arguments and updater behavior in isolated router paths."""
import io
import os
import re
from pathlib import Path
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
COMMON = (ROOT / 'root/usr/libexec/komari-common').read_text()

def ash(script, *args, env=None):
    return subprocess.run(['busybox', 'ash', '-c', script, 'test', *args],
                          text=True, capture_output=True, env=env)

for host, port, directory, valid in [
    ('0.0.0.0', '25774', '/etc/komari', True),
    ('::', '65535', '/mnt/usb/komari', True),
    ('localhost', '80', '/etc/komari', True),
    ('$(touch /tmp/unsafe)', '80', '/etc/komari', False),
    ('0.0.0.0', '0', '/etc/komari', False),
    ('0.0.0.0', '65536', '/etc/komari', False),
    ('0.0.0.0', '12x', '/etc/komari', False),
    ('0.0.0.0', '25774', '../data', False),
    ('0.0.0.0', '25774', '/mnt/../etc', False),
    ('0.0.0.0', '25774', '/', False),
]:
    result = ash(COMMON + '\nlisten_host="$1"; listen_port="$2"; data_dir="$3"; komari_validate', host, port, directory)
    assert (result.returncode == 0) == valid, (host, port, directory, result.stderr)

with tempfile.TemporaryDirectory(prefix='komari-backend-') as temporary:
    sandbox = Path(temporary)
    binary = sandbox / 'usr/bin'; binary.mkdir(parents=True)
    uploads = sandbox / 'tmp/komari/uploads'; uploads.mkdir(parents=True)
    libexec = sandbox / 'usr/libexec'; libexec.mkdir(parents=True)
    (libexec / 'komari-common').write_text(COMMON)
    (libexec/'komari-log-writer').write_text('#!/bin/sh\nexit 0\n'); (libexec/'komari-log-writer').chmod(0o755)
    mock = sandbox / 'mock'; mock.mkdir()
    (mock / 'pidof').write_text('#!/bin/sh\n[ "${MOCK_RUNNING:-0}" = 1 ]\n')
    (mock / 'pidof').chmod(0o755)
    (mock / 'uname').write_text('#!/bin/sh\necho mips\n')
    (mock / 'uname').chmod(0o755)
    (mock / 'uclient-fetch').write_text('#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -O ]; then shift; echo "{}" > "$1"; exit 0; fi; shift; done\n')
    (mock / 'uclient-fetch').chmod(0o755)
    env = dict(os.environ, PATH=str(mock) + ':' + os.environ['PATH'])
    update = (ROOT / 'root/usr/libexec/komari-update').read_text()
    update = re.sub(r'/usr/libexec/|/usr/bin/|/tmp/komari|/var/log/', lambda m: str(sandbox) + m[0], update)
    update = update.replace('set -u', 'set -u\nlogger() { :; }\npidof() { "$MOCK_DIR/pidof" "$@"; }\nuname() { "$MOCK_DIR/uname" "$@"; }')
    env['MOCK_DIR'] = str(mock)
    updater = sandbox / 'update'; updater.write_text(update)
    def run(*args, **overrides):
        return subprocess.run(['busybox', 'ash', str(updater), *args], text=True,
                              capture_output=True, env=dict(env, **overrides))
    def candidate(version):
        source = sandbox / 'core.c'
        source.write_text('#include <stdio.h>\nint main(void){puts("Komari Monitor ' + version + ' (hash: test)");return 0;}\n')
        subprocess.run(['cc', str(source), '-o', str(uploads / 'komari-upload.tar.gz')], check=True)
    candidate('1.5.1')
    result = run('local', str(uploads / 'komari-upload.tar.gz'))
    assert result.returncode == 0, result.stderr
    installed = (binary / 'komari').read_bytes()
    assert ash(COMMON + '\nkomari_version "$1"', str(binary / 'komari')).stdout.strip() == '1.5.1'
    candidate('1.4.0')
    assert run('local', str(uploads / 'komari-upload.tar.gz')).returncode == 0
    assert (binary / 'komari').read_bytes() == installed, 'Downgrade replaced the installed binary'
    candidate('1.6.0')
    assert run('local', str(uploads / 'komari-upload.tar.gz'), MOCK_RUNNING='1').returncode != 0
    assert (binary / 'komari').read_bytes() == installed
    candidate('1.6.0')
    core = (uploads / 'komari-upload.tar.gz').read_bytes()
    with tarfile.open(uploads / 'komari-upload.tar.gz', 'w:gz') as archive:
        member = tarfile.TarInfo('release/komari-linux-amd64'); member.size = len(core)
        archive.addfile(member, io.BytesIO(core))
    assert run('local', str(uploads / 'komari-upload.tar.gz')).returncode == 0
    candidate('1.7.0')
    core = (uploads / 'komari-upload.tar.gz').read_bytes()
    with tarfile.open(uploads / 'komari-upload.tar.gz', 'w:gz') as archive:
        member = tarfile.TarInfo('../komari'); member.size = len(core)
        archive.addfile(member, io.BytesIO(core))
    # BusyBox tar normalizes ../ in its listing. Streaming remains safe even
    # when that version accepts the normalized member name.
    run('local', str(uploads / 'komari-upload.tar.gz'))
    assert not (sandbox / 'tmp/komari/update/komari').exists()
    upload = uploads / 'komari-upload.tar.gz'; upload.write_text('#!/bin/sh\necho Komari Monitor 9.9.9\n')
    assert run('local', str(upload)).returncode != 0, 'Non-ELF upload was accepted'
    assert run('online').returncode != 0
    assert 'does not support this CPU architecture' in (sandbox / 'tmp/komari/update/status').read_text()
    assert not (sandbox / 'tmp/komari/update/lock').exists()
    assert not (sandbox / 'tmp/komari/operation-lock').exists()

# The read-only RPC helper must reject every mutating operation before execution.
reader = (ROOT / 'root/usr/libexec/komari-read').read_text()
for command in ['service', 'save-settings', 'update-online', 'update-local', 'clear-log']:
    assert ash(reader, command).returncode != 0

print('Configuration validation, ELF uploads, archive traversal, downgrade protection, running guard, architecture rejection and read-only permissions passed')
