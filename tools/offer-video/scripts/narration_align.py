#!/usr/bin/env python3
"""Bundle a strictly matched ASR take for internal narrated-film review.

Word boundaries come from observed ASR. No invented words, interpolation,
automatic semantic approval, provider calls or client-ready override exists.
"""
from __future__ import annotations
import argparse
import json
import shutil
from pathlib import Path
from narration_transcribe import finite_duration, normalized, preflight, sha, text_sha, validate_words
from narration_import import validate_receipt


def align_exact(script: dict, observed: dict) -> tuple[list[dict], list[dict]]:
    text = script['text']
    if text_sha(text) != script['textSha256'] or observed.get('scriptSha256') != script['textSha256']:
        raise ValueError('ASR does not bind the exact approved script')
    if '\n\n'.join(segment['text'] for segment in script['segments']) != text:
        raise ValueError('Script segments do not reconstruct the approved wording')
    words = observed['words']
    validate_words(words, observed['duration'])
    tokens = text.split()
    if len(tokens) != len(words) or any(normalized(t) != normalized(w['text']) for t, w in zip(tokens, words)):
        raise ValueError('ASR is not an exact normalized token match; review the differences, never invent timing')
    canonical, previous = [], 0.0
    for token, word in zip(tokens, words):
        if word['end'] <= word['start'] or word['start'] < previous - .04:
            raise ValueError('Observed word boundaries are empty or overlap')
        canonical.append({'text': token, 'start': word['start'], 'end': word['end'],
                          'observedText': word['text'], 'timingSource': 'observed-asr-word'})
        previous = word['end']
    segments, offset = [], 0
    for segment in script['segments']:
        count = len(segment['text'].split())
        selected = canonical[offset:offset + count]
        segments.append(dict(segment, start=selected[0]['start'], end=selected[-1]['end']))
        offset += count
    return segments, canonical


def bundle(args) -> dict:
    if args.out.exists():
        raise ValueError('Output already exists; use a new version')
    source = args.take / 'source.wav'
    source_text, receipt, raw_duration = preflight(source, args.take / 'script.txt', args.take / 'receipt.json', args.language)
    validate_receipt(receipt, source_text, sha(source))
    if receipt['purpose'] != 'full-narration':
        raise ValueError('Only full narrations can be assembled as offer films')
    catalog = json.loads(args.catalog.read_text())
    if catalog.get('approval', {}).get('approved') is not True or catalog.get('closing', {}).get('approved') is not True:
        raise ValueError('Batch and genuine-logo ending approvals are required')
    offer = next(item for item in catalog['offers'] if item['kind'] == args.kind)
    script = offer['languages'][args.language]
    if script.get('approval') != 'approved' or script.get('approvalSheetSha256') != catalog['approval']['sheetSha256']:
        raise ValueError('Language copy lacks exact approval binding')
    if source_text != script['text']:
        raise ValueError('Imported take wording differs from approved catalog')
    observed = json.loads(args.asr.read_text())
    if observed.get('language') != args.language or observed.get('audioSha256') != receipt['audioSha256']:
        raise ValueError('ASR audio/language binding failed')
    observed_duration = finite_duration(observed.get('duration'))
    raw_duration = finite_duration(raw_duration)
    if abs(observed_duration - raw_duration) > .05:
        raise ValueError('ASR duration differs from the source audio')
    segments, words = align_exact(script, observed)
    args.out.mkdir(parents=True, exist_ok=False)
    created = args.out.stat()
    try:
        # The internal pilot keeps the source PCM unchanged. Loudness processing and
        # measured final mix remain explicit later steps, never inferred from naming.
        shutil.copyfile(source, args.out / 'voice.wav')
        if sha(args.out / 'voice.wav') != receipt['audioSha256']:
            raise ValueError('Bundled audio does not match the approved receipt')
        (args.out / 'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
        (args.out / 'asr.json').write_text(json.dumps(observed, ensure_ascii=False, indent=2) + '\n')
        timing = {'schemaVersion': 1, 'kind': args.kind, 'language': args.language,
            'scriptSha256': script['textSha256'], 'audioFile': 'voice.wav',
            'sourceAudioSha256': receipt['audioSha256'], 'audioSha256': sha(args.out / 'voice.wav'),
            'duration': raw_duration, 'segments': segments, 'words': words,
            'receiptFile': 'receipt.json', 'asrFile': 'asr.json', 'asrSha256': sha(args.out / 'asr.json'),
            'copyApproved': True, 'commercialEvidenceRecorded': receipt['entitlement']['paidPlanObserved'] is True,
            'transcriptChecked': False, 'subjectiveListen': False, 'phoneSpeakerListen': False,
            'audioMeasured': False, 'normalizationStatus': 'source-PCM-unprocessed',
            'clientReady': False,
            'unresolvedIssues': ['Independent transcript/meaning review', 'Measured final audio mix', 'Rendered picture review']}
        (args.out / 'timing.json').write_text(json.dumps(timing, ensure_ascii=False, indent=2) + '\n')
        return {'ok': True, 'timing': str(args.out / 'timing.json'), 'clientReady': False}
    except BaseException:
        if args.out.exists() and not args.out.is_symlink():
            current = args.out.stat()
            if (current.st_dev, current.st_ino) == (created.st_dev, created.st_ino):
                shutil.rmtree(args.out)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--take', type=Path, required=True)
    parser.add_argument('--asr', type=Path, required=True)
    parser.add_argument('--catalog', type=Path, required=True)
    parser.add_argument('--kind', required=True)
    parser.add_argument('--language', choices=('en', 'ar'), required=True)
    parser.add_argument('--out', type=Path, required=True)
    print(json.dumps(bundle(parser.parse_args())))


if __name__ == '__main__':
    main()
