"""The three ways a request can end without a proposal, kept apart on purpose.

- Refused: it cannot be done as asked (no recording of the lead, an offer
  option that does not exist). Said once, in a sentence the closer can act
  on, and not retried, because trying again changes nothing.
- NotNow: a service the desk depends on is not configured or not answering
  (no model key, a key the provider refuses, Fathom's key refused). The
  request goes back in the queue untouched, its try not counted, and the
  run's other requests of the same kind wait unclaimed beside it, so one
  outage cannot use up every request's four tries. The other kind goes on:
  a rebuild asks no model, so it never waits behind a draft that cannot be
  written. The closer is told in one sentence (queue.closer_wait).
- anything else: a try that failed (a timeout, an answer that was not JSON).
  Counted, retried up to four times, then parked with its reason.

And one way a request ends because nothing is wanted any more:

- Archived: the closer archived the proposal before its request ran. The
  request is closed as cancelled and the proposal is left archived: never
  drafted, never marked failed.
"""


class Refused(Exception):
    pass


class NotNow(Exception):
    pass


class Archived(Exception):
    pass
