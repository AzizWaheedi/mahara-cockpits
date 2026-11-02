#!/usr/bin/env python3
"""Import an authorized browser/API narration export, without making provider calls.

Works on the VPS. It never buys credits, synthesizes speech or grants delivery approval.
The receipt binds the exact text and audio bytes to observed provider evidence.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def text_sha(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def validate_receipt(receipt: dict, text: str, audio_hash: str) -> None:
    required = {'schemaVersion', 'provider', 'tool', 'voiceName', 'language', 'purpose',
                'textSha256', 'audioSha256', 'generationDate', 'sourceMode', 'entitlement',
                'settings', 'copyApproval'}
    if not isinstance(receipt, dict) or not required.issubset(receipt):
        raise ValueError('Incomplete provider receipt')
    if receipt['schemaVersion'] != 1:
        raise ValueError('Unsupported receipt version')
    if receipt['provider'] not in ('nabarati', 'elevenlabs'):
        raise ValueError('Provider is not reviewed')
    if receipt['sourceMode'] not in ('browser-export', 'documented-api'):
        raise ValueError('Source mode is not explicit')
    if receipt['language'] not in ('en', 'ar') or receipt['purpose'] not in ('audition', 'full-narration'):
        raise ValueError('Invalid language or purpose')
    if receipt['textSha256'] != text_sha(text) or receipt['audioSha256'] != audio_hash:
        raise ValueError('Receipt does not match exact text/audio bytes')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', receipt['generationDate']):
        raise ValueError('Generation date is required')
    if not isinstance(receipt['voiceName'], str) or not receipt['voiceName'].strip():
        raise ValueError('Voice name is required')
    if re.search(r'aziz|عبد\s?العزيز|عبد\s?ال?عزيز', receipt['voiceName'], re.I):
        raise ValueError('Synthetic Aziz voice is forbidden')
    entitlement = receipt['entitlement']
    if not isinstance(entitlement, dict) or entitlement.get('paidPlanObserved') is not True:
        raise ValueError('Paid entitlement at generation must be observed')
    if not entitlement.get('plan') or not entitlement.get('checkedAt'):
        raise ValueError('Plan evidence needs a tier and checked time')
    source = urlparse(entitlement.get('commercialPolicyUrl', ''))
    hosts = {'nabarati': {'www.nabarati.ai', 'nabarati.ai'}, 'elevenlabs': {'elevenlabs.io'}}
    if (source.scheme != 'https' or source.hostname not in hosts[receipt['provider']]
            or source.username is not None or source.password is not None
            or source.port not in (None, 443) or source.query or source.fragment):
        raise ValueError('Use the public official licence evidence URL without credentials, a nondefault port, query or fragment')
    approval = receipt['copyApproval']
    if not isinstance(approval, dict) or approval.get('textSha256') != receipt['textSha256']:
        raise ValueError('Copy approval must bind to this exact script')
    if approval.get('approved') is not True or not approval.get('evidence'):
        raise ValueError('Copy must have an explicit approval record before import')
    if not isinstance(receipt['settings'], dict):
        raise ValueError('Generation settings are required')
    # No account IDs, tokens, signed media URLs or credential material in receipts.
    serialized = json.dumps(receipt, ensure_ascii=False)
    if re.search(r'(?i)bearer\s|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|x-amz-|session[_-]?token', serialized):
        raise ValueError('Secret or signed-link material is forbidden in receipts')


def probe_audio(audio: Path) -> dict:
    if audio.suffix.lower() not in ('.wav', '.mp3', '.m4a') or not audio.is_file():
        raise ValueError('Expected an existing WAV, MP3 or M4A export')
    if not 100 < audio.stat().st_size <= 50_000_000:
        raise ValueError('Audio file is empty or exceeds the bounded import limit')
    raw = subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(audio)], text=True, timeout=10)
    data = json.loads(raw)
    streams = data.get('streams', [])
    if len(streams) != 1 or streams[0].get('codec_type') != 'audio':
        raise ValueError('Export must contain one audio stream only')
    raw_duration = data['format']['duration']
    if isinstance(raw_duration, bool):
        raise ValueError('Narration duration must be finite')
    duration = float(raw_duration)
    if not math.isfinite(duration) or not 1 <= duration <= 300:
        raise ValueError('Narration duration is outside 1–300 seconds')
    stream = streams[0]
    return {'durationSeconds': duration, 'sampleRate': int(stream['sample_rate']),
            'channels': int(stream['channels']), 'codec': stream['codec_name'], 'bytes': audio.stat().st_size}


def import_take(audio: Path, script: Path, receipt_path: Path, destination: Path) -> dict:
    if destination.exists():
        raise ValueError('Destination already exists; use a new version, never overwrite a take')
    text = script.read_text().strip()
    receipt = json.loads(receipt_path.read_text())
    validate_receipt(receipt, text, sha256(audio))
    destination.mkdir(parents=True, exist_ok=False)
    created = destination.stat()
    try:
        output = destination / ('source' + audio.suffix.lower())
        shutil.copyfile(audio, output)
        copied_hash = sha256(output)
        if copied_hash != receipt['audioSha256']:
            raise ValueError('Copied audio does not match the approved receipt')
        facts = probe_audio(output)
        (destination / 'script.txt').write_text(text + '\n')
        (destination / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
        manifest = {'schemaVersion': 1, 'provider': receipt['provider'], 'tool': receipt['tool'],
                    'voiceName': receipt['voiceName'], 'language': receipt['language'], 'purpose': receipt['purpose'],
                    'textSha256': text_sha(text), 'audioSha256': copied_hash, 'file': output.name,
                    'facts': facts, 'commercialEvidenceRecorded': True, 'clientReady': False,
                    'review': {'subjectiveListen': False, 'transcriptChecked': False, 'phoneSpeakerListen': False},
                    'remaining': ['Exact transcript review', 'Measured final audio mix', 'Rendered picture review']}
        (destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        return manifest
    except BaseException:
        # Only our new partial directory may be cleaned up. Never remove an
        # existing take, a symlink, or a replacement directory from another run.
        if destination.exists() and not destination.is_symlink():
            current = destination.stat()
            if (current.st_dev, current.st_ino) == (created.st_dev, created.st_ino):
                shutil.rmtree(destination)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audio', required=True, type=Path)
    parser.add_argument('--script', required=True, type=Path)
    parser.add_argument('--receipt', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    manifest = import_take(args.audio, args.script, args.receipt, args.out)
    print(json.dumps({'ok': True, 'out': str(args.out), 'clientReady': manifest['clientReady'], 'facts': manifest['facts']}))

if __name__ == '__main__':
    main()
