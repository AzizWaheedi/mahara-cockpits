# Cameraman film photographic pass

These two Python tools form an isolated, deterministic picture pass. They do not modify the general Offer Studio generator or the frontend. The accompanying four Higgsfield images are fictional examples, not records of Mahara client shoots. Every photo scene displays “AI-generated example”.

Build in a new destination:
1. Use offer_series.py from commit 2d0b8fbad0b0b09d5a256bef371ee856ea0b773e (SHA256 d19a716452b86411b0905e29445a3149ba9b0d01788776f180b8cced07a51d38) to generate Cameraman English with the reviewed original aligned-cameraman-en-20261028-internal-v1/timing.json bundle and existing approved fonts/logo/media.
2. python3 consolidate_cameraman_closing.py --base GENERATED --output WHOLE_CLOSE
3. python3 cameraman_photoreal.py --base WHOLE_CLOSE --photos cameraman-art --output PHOTOREAL

Each output directory must be new. Original audio, all subtitle bytes, original word timing, total duration and approval facts are preserved. The closing consolidation holds the complete approved sentence over its original 32.58–36.28s spoken segment. The picture pass replaces all 12 pictorial scenes with photographs and purposefully eases only longer pictures; typography stays still. Short scenes stay still. No models/providers are called.

Reproduction test used the unmodified first generated Cameraman composition and found all presentation HTML/audio/subtitle files byte-identical to the reviewed final v2 film source. See cameraman-reproduction-check.json.

Runtime: official isolated HyperFrames 0.8.211. Run check with browser snapshots, review all scenes/phone/seams, then render strict/no-best-effort with one worker at 1080p30. Recheck available disk >=5 GiB. This source bundle does not assert subjective listening, provider upload, or client publication readiness.

Media provenance: cameraman-art/provenance.json records each provider job and source hash. Do not mistake the photographs for real Mahara results or remove the disclosure.

Final reviewed private source:
/home/hermes/upsell-studio-video/all-offers/cameraman-photoreal-20261028/v2/en.
Original private source/assets and former film remain intact for rollback.
