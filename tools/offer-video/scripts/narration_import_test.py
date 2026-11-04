import copy
import unittest
from narration_import import validate_receipt, text_sha

class ReceiptTests(unittest.TestCase):
    def setUp(self):
        self.text='Someone sees your ad.'
        self.audio='a'*64
        self.receipt={'schemaVersion':1,'provider':'nabarati','tool':'Nabra v4','voiceName':'Rakan','language':'en','purpose':'audition','textSha256':text_sha(self.text),'audioSha256':self.audio,'generationDate':'2026-10-27','sourceMode':'browser-export','entitlement':{'paidPlanObserved':True,'plan':'Professional','checkedAt':'2026-10-27T12:00:00Z','commercialPolicyUrl':'https://www.nabarati.ai/en'},'settings':{'speed':'Normal'},'copyApproval':{'approved':True,'textSha256':text_sha(self.text),'evidence':'Approved Website audition copy'}}
    def test_exact_receipt_passes(self):
        validate_receipt(self.receipt,self.text,self.audio)
    def test_changed_audio_rejected(self):
        with self.assertRaisesRegex(ValueError,'exact text/audio'):
            validate_receipt(self.receipt,self.text,'b'*64)
    def test_changed_text_rejected(self):
        with self.assertRaises(ValueError): validate_receipt(self.receipt,self.text+' Changed.',self.audio)
    def test_free_plan_cannot_be_relabelled(self):
        self.receipt['entitlement']['paidPlanObserved']=False
        with self.assertRaisesRegex(ValueError,'entitlement'): validate_receipt(self.receipt,self.text,self.audio)
    def test_pending_script_rejected(self):
        self.receipt['copyApproval']['approved']=False
        with self.assertRaisesRegex(ValueError,'explicit approval'): validate_receipt(self.receipt,self.text,self.audio)
    def test_other_script_approval_rejected(self):
        self.receipt['copyApproval']['textSha256']='c'*64
        with self.assertRaisesRegex(ValueError,'exact script'): validate_receipt(self.receipt,self.text,self.audio)
    def test_signed_url_rejected(self):
        self.receipt['entitlement']['commercialPolicyUrl']='https://www.nabarati.ai/en?token=bad'
        with self.assertRaises(ValueError): validate_receipt(self.receipt,self.text,self.audio)
    def test_unrelated_license_host_rejected(self):
        self.receipt['entitlement']['commercialPolicyUrl']='https://example.com/licence'
        with self.assertRaises(ValueError): validate_receipt(self.receipt,self.text,self.audio)
    def test_secret_field_rejected(self):
        self.receipt['api_key']='not-a-real-key'
        with self.assertRaisesRegex(ValueError,'Secret'): validate_receipt(self.receipt,self.text,self.audio)
    def test_aziz_impersonation_rejected(self):
        self.receipt['voiceName']='Aziz clone'
        with self.assertRaisesRegex(ValueError,'Aziz'): validate_receipt(self.receipt,self.text,self.audio)

if __name__=='__main__': unittest.main()
