#!/usr/bin/env python3
"""Inline the updater and stamp a reproducible, verified two-page PWA release.

Run after changes to either page, sw.js, or the update client. Use --check in
validation. No build dependencies, generated asset bundles, or network access.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLIENT_RE = re.compile(r'/\* FRAME_UPDATE_CLIENT_BEGIN \*/[\s\S]*?/\* FRAME_UPDATE_CLIENT_END \*/')
ID_RE = re.compile(r"(/\* FRAME_RELEASE_ID \*/\s*)'[^']*'")
RELEASE_RE = re.compile(r'/\* FRAME_RELEASE_BEGIN \*/[\s\S]*?/\* FRAME_RELEASE_END \*/')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def prepare(check=False):
    client = (ROOT / 'tools/pwa-update-client.js').read_text().rstrip()
    block = '/* FRAME_UPDATE_CLIENT_BEGIN */\n' + client + '\n  /* FRAME_UPDATE_CLIENT_END */'
    pages = {}
    for name in ('index.html', 'compose.html'):
        source = (ROOT / name).read_text()
        if len(CLIENT_RE.findall(source)) != 1 or len(ID_RE.findall(source)) != 1:
            raise SystemExit(f'{name}: expected one updater block and one release-ID marker')
        source = CLIENT_RE.sub(lambda _: block, source)
        pages[name] = ID_RE.sub(lambda match: match[1] + "'RELEASE_ID'", source)
    worker = (ROOT / 'sw.js').read_text()
    if len(RELEASE_RE.findall(worker)) != 1:
        raise SystemExit('sw.js: expected one generated release block')
    template = RELEASE_RE.sub('/* FRAME_RELEASE_BEGIN */\nRELEASE_DATA\n/* FRAME_RELEASE_END */', worker)
    identity = '\0'.join([template] + [name + '\0' + pages[name] for name in sorted(pages)])
    release_id = digest(identity.encode())[:20]
    for name, source in pages.items():
        pages[name] = ID_RE.sub(lambda match: match[1] + repr(release_id), source)
    release = {'id': release_id, 'files': {name: digest(source.encode()) for name, source in pages.items()}}
    release_block = '/* FRAME_RELEASE_BEGIN */\nvar RELEASE = ' + json.dumps(release, separators=(',', ':')) + ';\n/* FRAME_RELEASE_END */'
    outputs = dict(pages, **{'sw.js': RELEASE_RE.sub(lambda _: release_block, worker)})
    stale = [name for name, content in outputs.items() if (ROOT / name).read_text() != content]
    if check:
        if stale:
            raise SystemExit('Release metadata is stale: ' + ', '.join(stale) + '. Run python3 tools/prepare-release.py')
        print('Release ' + release_id + ' verified (both page hashes and inline updater).')
    else:
        for name in stale:
            (ROOT / name).write_text(outputs[name])
        print('Prepared release ' + release_id + (' (' + ', '.join(stale) + ')' if stale else ' (unchanged)'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='fail if release metadata or inline updater is stale')
    prepare(parser.parse_args().check)
