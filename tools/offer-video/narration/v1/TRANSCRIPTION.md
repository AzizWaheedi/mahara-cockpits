# Offline transcription, held for coordinated capacity

Current preparation: the isolated runtime and pinned model are now installed on the VPS. The runtime is `/home/hermes/upsell-studio-video/all-offers/asr-runtime-v1/venv/bin/python`; the local model is `/home/hermes/upsell-studio-video/all-offers/models/faster-whisper-small-536b066`. The preparation receipt records 23 binary wheels, a successful dependency check and 486,215,847 model bytes with source hashes verified. No inference or model load has run. Heavy inference remains held until the concurrent CSM release is cleared.

Historical API attempt: the six OpenAI API transcription attempts returned HTTP 429. This is a failed transcription check, not evidence that the spoken words match. At that earlier read-only check, neither transcription package nor a suitable model cache existed. The isolated preparation above supersedes that environment status.

The prepared, bounded VPS transcription profile is:

- Python 3.9 or later in a separate virtual environment.
- `faster-whisper==1.2.1`, verified from the PyPI metadata on 27 October 2026, with its resolved dependencies locked after installation.
- Multilingual CTranslate2 model `Systran/faster-whisper-small`, revision `536b0662742c02347bc0e980a01041f333bce120`, verified through the model metadata API. Use this multilingual model for both English and Arabic, not an English-only distillation.
- CPU `compute_type="int8"`, `cpu_threads=2`, `num_workers=1`; process one file at a time. No GPU, Docker or service is required for this profile.
- Explicit language `en` or `ar`, `beam_size=5`, `word_timestamps=True`, `condition_on_previous_text=False`. Store all segment/word timings with the source WAV SHA256 and exact package/model versions. Do not seed the transcript with the full desired script, since that can conceal omissions.
- Cache the pinned model in a new dedicated VPS folder, then load that local path with `local_files_only=True`. First check current free disk and RAM, coordinate against renders/builds, and record actual download size. Do not download on the Mac or into a shared production virtual environment.

This is an optional quality-assistance path, not an approval substitute. ASR may normalize Gulf dialect, numbers and brand names incorrectly. Compare against canonical Arabic/English, keep substantive mismatches for human listening, and never turn a model transcript into automatic client-ready approval. The next authorized production scope is the eight already imported full takes, starting with the UGC pair after compute clearance. The six missing provider exports remain stopped. No transcription script grants client readiness automatically.

References: [official faster-whisper documentation](https://github.com/SYSTRAN/faster-whisper), [package metadata](https://pypi.org/project/faster-whisper/), [multilingual small model](https://huggingface.co/Systran/faster-whisper-small).

`../../scripts/narration_transcribe.py` verifies the pinned model file hashes and imported source/script receipt before offline inference, stores all observed word timings and an unresolved canonical-text comparison, and refuses an existing output folder. `../../scripts/narration_align.py` accepts only exact normalized one-to-one token coverage with real observed bounds for the internal picture pilot. It does not interpolate missing words or grant a transcript pass. These two tools have 13 focused tests; no ASR inference is implied by those tests.
