import unittest
from datetime import datetime, timezone
from unittest.mock import patch
import inbox

class ClientIdentityTests(unittest.TestCase):
    def contact(self, value="client-one", location=inbox.CLIENT_LOCATION):
        return {"id": "contact-one", "locationId": location, "customFields": [{"id": inbox.CLIENT_ID_FIELD, "value": value}]}

    def test_only_exact_client_id_from_correct_account(self):
        self.assertEqual(inbox.client_id(self.contact(), inbox.CLIENT_LOCATION), "client-one")
        self.assertIsNone(inbox.client_id(self.contact(""), inbox.CLIENT_LOCATION))
        self.assertIsNone(inbox.client_id(self.contact(location="wrong"), inbox.CLIENT_LOCATION))
        c = self.contact(); c["customFields"] *= 2
        self.assertIsNone(inbox.client_id(c, inbox.CLIENT_LOCATION))

    def test_unlinked_contact_never_fetches_messages_or_drafts(self):
        class Store:
            def patch(self, path, body): self.patched = body
        store = Store()
        with patch.object(inbox, "ghl", return_value={"contact": self.contact("")}) as read:
            self.assertEqual(inbox.pull_thread(store, "synthetic", inbox.CLIENT_LOCATION, {"id": "thread-one", "contactId": "contact-one"}, datetime.now(timezone.utc)), 0)
            self.assertEqual(read.call_count, 1)
            self.assertEqual(read.call_args[0][0], "/contacts/contact-one")
            self.assertEqual(store.patched, {"client_task_id": None})

    def test_different_contact_receipt_cannot_link_a_thread(self):
        class Store:
            def patch(self, path, body): pass
        c = self.contact(); c["id"] = "other-contact"
        with patch.object(inbox, "ghl", return_value={"contact": c}) as read:
            self.assertEqual(inbox.pull_thread(Store(), "synthetic", inbox.CLIENT_LOCATION, {"id": "thread-one", "contactId": "contact-one"}, datetime.now(timezone.utc)), 0)
            self.assertEqual(read.call_count, 1)

if __name__ == "__main__": unittest.main()
