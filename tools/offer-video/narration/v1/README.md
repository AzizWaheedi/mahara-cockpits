# Narration v1

This is the approved seven-offer bilingual script batch, six historical auditions and current full-narration production checkpoint, not a client-ready video release. All 14 full recordings were generated; eight are imported and six generated records are export-held because the user stopped further downloads. See `PRODUCTION.md`. `scripts.json` is the full narration source. `APPROVAL.md` is the complete wording/closing approval sheet. The fourteen TXT files mirror the exact script text plus one final newline.

## Decisions and limits

- Use the user's existing Nabarati Professional credits. No new ElevenLabs subscription, purchase or renewal change. The account UI showed 597,378 points before six successful auditions and 595,245 after, on 27 October 2026.
- Native Nabra v4 voice names load in the Arabic UI. The English UI showed empty names. The older package favorite Rashed was rejected by this v4 tool; it is not a valid substitute for native voices. No undocumented API is called or invented. Browser export is the current supported integration.
- Keep No Conversion for Arabic so the provider does not rewrite approved words. Voice auditions use calm, normal, very-clear, professional settings. All three English takes use the same English input and direction; all three Arabic takes use the same approved Arabic excerpt and Kuwaiti setting.
- The API transcription check returned HTTP429. It did not verify words, pronunciation, naturalness or voice quality. `audio-audit.json` contains actual FFprobe/FFmpeg measurements only. No subjective or phone-speaker listening has been claimed.
- The six WAV sources remain on the VPS. Level-matched MP3 comparisons target -16 LUFS with headroom and do not change speed. The current production direction uses Rakan for both languages. The comparison files remain available; no subjective listening judgment is inferred from measurements.
- The user explicitly approved all seven bilingual scripts and the genuine Mahara logo ending on 27 October 2026. `APPROVAL.md` records the original approved sheet hash. This replaces the real Aziz clip requirement for the new series only; never synthesize Aziz. The legacy Website film checker remains unchanged.
- Closer recruitment readiness remains a separate product gate. Prices, ad spend and numerical business results stay out of narration.

## Import an approved take

`../../scripts/narration_import.py` makes no remote calls. It validates exact script/audio hashes, approved-copy evidence and observed paid entitlement, probes the audio, and writes a new immutable version folder. It refuses an existing destination. The manifest always starts with `clientReady: false` and pending review. Do not put tokens, account IDs, signed download URLs or credentials in receipts.

From `tools/offer-video` on the VPS:

```bash
python3 scripts/narration_import.py --audio /path/to/export.wav --script /path/to/approved.txt --receipt /path/to/receipt.json --out /path/to/new/take-v1
python3 -m unittest discover -s scripts -p narration_import_test.py
```

Copy the receipt shape from an audition, update the actual new audio/script hashes, provider settings, entitlement check and exact approval evidence. Never reuse the audition's approval as approval for a full script. An import is not an approval, mix, render, upload or publication.

## How we know it works

Ten focused receipt tests cover changed audio/text, missing approval, wrong script approval, free-plan relabelling, unrelated or signed licence links, credential material and synthetic Aziz voice rejection. All ten passed on the VPS on 27 October 2026. Six WAVs were measured. All 14 full narrations were generated after explicit approval, and eight imported takes have matching script/audio receipts. Further downloads are stopped. The new offline transcription and strict alignment tooling passed 13 focused tests. Actual ASR, complete captions, final audio measurements and rendered-film review are pending. Subjective and phone-speaker listening remain explicit, truthful metadata, not inferred passes or a new approval requirement.

Not in scope: buying subscriptions, modifying provider account settings, undocumented API calls, voice cloning, publishing client media before actual quality review, or bypassing the exact approved copy and genuine-logo ending.
