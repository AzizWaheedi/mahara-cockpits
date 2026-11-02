-- Abdo Mohamed is Mahara's new media buyer (Muhammed, 26 October 2026). Meta's activity log names him as the
-- creator of campaigns on 8 client accounts since 21 October, so the launch desk's ownership check counted them
-- as "outside Mahara" and blocked Merge Studio and ARCWANI. The EOD Meta changes read the same list.
INSERT INTO public.cockpit_meta_people(actor_name,kind,note,added_by)
VALUES ('Abdo Mohamed','mahara','New Mahara media buyer, confirmed by Muhammed 26 October 2026','claude-meta-people-1026')
ON CONFLICT (actor_name) DO UPDATE SET kind='mahara',note=EXCLUDED.note;
