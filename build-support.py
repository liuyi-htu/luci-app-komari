#!/usr/bin/env python3
"""Inspect the newly built package and deliver it with its checksum."""
import hashlib
import io
import json
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

root, sdk = map(Path, sys.argv[1:3])
target = sys.argv[3]
translation = len(sys.argv) > 4 and sys.argv[4] == 'translation'
name = 'luci-i18n-komari-zh-cn' if translation else 'luci-app-komari'
makefile = (root / 'Makefile').read_text()
version = re.search(r'^PKG_VERSION:=(.+)$', makefile, re.M)[1]
release = re.search(r'^PKG_RELEASE:=(.+)$', makefile, re.M)[1]
version = f'{version}-r{release}'
extension, package_arch = ('apk', 'aarch64_cortex-a53') if target == 'arm64' else ('ipk', 'x86_64')
filename = f'{name}-{version}.apk' if extension == 'apk' else f'{name}_{version}_all.ipk'
package = sdk / 'bin/packages' / package_arch / 'base' / filename
assert package.is_file(), f'Expected build output: {package}'

with tempfile.TemporaryDirectory(prefix='komari-package-') as temporary:
    extracted = Path(temporary)
    if extension == 'apk':
        apk = sdk / 'staging_dir/host/bin/apk'
        metadata = subprocess.check_output([str(apk), 'adbdump', str(package)], text=True)
        assert f'  name: {name}\n' in metadata
        assert f'  version: {version}\n' in metadata
        assert '  arch: noarch\n' in metadata
        subprocess.run([str(apk), 'extract', '--allow-untrusted', '--destination', temporary, str(package)], check=True)
    else:
        with tarfile.open(package, 'r:gz') as outer:
            control_bytes = outer.extractfile('./control.tar.gz').read()
            with tarfile.open(fileobj=io.BytesIO(control_bytes), mode='r:gz') as control:
                metadata = control.extractfile('./control').read().decode()
            fields = dict(line.split(': ', 1) for line in metadata.splitlines() if ': ' in line and not line.startswith(' '))
            assert fields['Package'] == name
            assert fields['Version'] == version
            assert fields['Architecture'] == 'all'
            with tarfile.open(fileobj=io.BytesIO(outer.extractfile('./data.tar.gz').read()), mode='r:gz') as data:
                data.extractall(extracted, filter='data')
    if translation:
        assert 'luci-app-komari' in metadata
        catalogs = list(extracted.rglob('komari.zh-cn.lmo'))
        assert len(catalogs) == 1 and catalogs[0].stat().st_size > 0
        assert not list(extracted.rglob('*.js'))
        subprocess.run(['node', str(root / 'tests/i18n-test.cjs'), str(catalogs[0]),
                        str(sdk / 'feeds/luci/modules/luci-base/htdocs/luci-static/resources/cbi.js')], check=True)
    else:
        assert 'luci-lua-runtime' not in metadata
        for dependency in ('luci-base', 'jsonfilter', 'uclient-fetch', 'ca-bundle', 'coreutils-timeout'):
            assert dependency in metadata, f'Missing dependency: {dependency}'
        js = extracted / 'www/luci-static/resources/view/komari/overview.js'
        subprocess.run(['node', '--check', str(js)], check=True)
        subprocess.run(['node', '--check', str(extracted / 'www/luci-static/resources/komari/agent.js')], check=True)
        built_js = js.read_text()
        assert not re.search(r'[\u4e00-\u9fff]', built_js)
        assert not list(extracted.rglob('*.lmo'))
        i18n = extracted / 'www/luci-static/resources/komari/i18n.js'
        subprocess.run(['node', '--check', str(i18n)], check=True)
        assert not list(extracted.rglob('overview.js.o'))
        assert not list(extracted.rglob('*.lua'))
        acl = json.loads((extracted / 'usr/share/rpcd/acl.d/luci-app-komari.json').read_text())['luci-app-komari']
        assert '/usr/libexec/komari-ui' not in acl['read']['file']
        assert acl['write']['file']['/usr/libexec/komari-ui'] == ['exec']
        for source in (root / 'root').rglob('*'):
            if not source.is_file():
                continue
            delivered = extracted / source.relative_to(root / 'root')
            assert delivered.is_file(), str(delivered)
            assert delivered.read_bytes() == source.read_bytes(), f'Packaged file differs: {source}'
            if source.parent.name in ('libexec', 'init.d', 'uci-defaults'):
                assert delivered.stat().st_mode & 0o111, f'Non-executable runtime script: {delivered}'
                subprocess.run(['busybox', 'ash', '-n', str(delivered)], check=True)
            if source.suffix == '.json':
                json.loads(delivered.read_text())

checksum = hashlib.file_digest(package.open('rb'), 'sha256').hexdigest()
destination = root / 'dist' / filename
destination.parent.mkdir(parents=True, exist_ok=True)
if destination.exists():
    previous = root / '.build-logs/previous-artifacts' / (filename + '.' + hashlib.sha256(destination.read_bytes()).hexdigest())
    previous.parent.mkdir(parents=True, exist_ok=True)
    if not previous.exists():
        shutil.copy2(destination, previous)
shutil.move(str(package), str(destination))
assert hashlib.sha256(destination.read_bytes()).hexdigest() == checksum
destination.with_name(filename + '.sha256').write_text(checksum + '  ' + filename + '\n')
(root / '.build-logs' / f'package-metadata-{target}{"-translation" if translation else ""}.txt').write_text(metadata)
(root / '.build-logs' / f'validation-{target}{"-translation" if translation else ""}.json').write_text(json.dumps({
    'version': version, 'target': target, 'format': extension, 'artifact': str(destination),
    'sha256': checksum, 'validation': 'passed'
}, indent=2) + '\n')
print('Validated package:', destination)
print('SHA256:', checksum)
