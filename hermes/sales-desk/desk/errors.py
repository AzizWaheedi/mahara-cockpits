"""The three ways a request can end without a proposal, kept apart on purpose.

- Refused: it cannot be done as asked (no recording of the lead, an offer
  option that does not exist). Said once, in a sentence the closer can act
  on, and not retried, because trying again changes nothing.
- NotNow: a service the desk depends on is not configured or not answering
  (no model key, a key the provider refuses, Fathom's key refused). The
  request goes back in the queue untouched, its try not counted, and the
  run stops, so one outage cannot use up every request's four tries.
- anything else: a try that failed (a timeout, an answer that was not JSON).
  Counted, retried up to four times, then parked with its reason.
"""


class Refused(Exception):
    pass


class NotNow(Exception):
    pass
