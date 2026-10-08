BEGIN;
SET LOCAL lock_timeout='5s';
CREATE INDEX cockpit_media_booking_native_grain
 ON public.cockpit_media_booking_events
 (public.cockpit_native_grain_key('bookingEvents',data));
CREATE INDEX cockpit_media_daily_native_grain
 ON public.cockpit_media_daily_stats
 (public.cockpit_native_grain_key('dailyStats',data));
COMMIT;
