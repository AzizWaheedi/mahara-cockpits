/* Mahara hiring workflows, Phase B, fourth run (2026-10-11): WhatsApp as the backup.
 *
 * Aziz: "For any messages that get sent, make sure to use custom values and
 * make sure to use email and SMS. SMS is WhatsApp, remember but you can also
 * use WhatsApp as a backup, just in case."
 *
 * The same 36 workflows as the third run (2026-09-22): one per role per stage,
 * triggered by a card reaching that stage on that role's board, email first,
 * then SMS. This run adds, and changes nothing else:
 *
 * 1. A WhatsApp step after the SMS, in every workflow whose WhatsApp template
 *    Meta has APPROVED. GoHighLevel cannot branch on "the SMS failed", so the
 *    backup is WhatsApp sent after the SMS rather than instead of it. A
 *    template still PENDING leaves its workflow at two steps; run this again
 *    once Meta approves and the step goes in.
 * 2. The 36 WhatsApp templates (one per role per stage, English, UTILITY),
 *    created once by name and never edited. Every changeable word is a custom
 *    value: the first name, the owner's name, the agency's name and the links
 *    are template variables filled from the same custom values the email and
 *    SMS use. Meta refuses a template that ends on a variable, so the
 *    sign-off moves to the start ("this is Aziz from Mahara Media") and a
 *    message that ended on a link gets a short closing line. CFG.plan[].whatsapp
 *    .changed says exactly what differs from the SMS.
 * 3. "One-to-one": Aziz's word for stage 5. The six "· 5 One to one"
 *    workflows are renamed "· 5 One-to-one" in place (found under the old
 *    name), and "one to one" reads "one-to-one" in their email and SMS.
 *
 * NOTHING IS PUBLISHED. Every workflow keeps the status it has: a draft stays
 * a draft and one you published stays published. This script never calls
 * change-status. Nothing is deleted except a stale trigger aimed at the same
 * stage (as in the third run). If WhatsApp is not connected on the
 * MaharaMedia Hiring sub-account, it stops before writing anything and says so.
 *
 * Your session token never leaves the browser and is never printed.
 *
 * HOW TO RUN
 * 1. In GoHighLevel switch into the sub-account "MaharaMedia Hiring".
 * 2. Automation, then Workflows, then open ANY workflow so the builder loads.
 * 3. Cmd+Option+J, then change the console frame dropdown from "top" to the
 *    entry containing client-app-automation-workflows.leadconnectorhq.com
 * 4. Paste this whole file, press Enter, and wait for DONE.
 * 5. Send hiring-phase-b-v4-result.json (it downloads) to Claude.
 * Run it again a day later: templates Meta approved since then get their step.
 *
 * WA_PHONE: the WhatsApp sender's phone number id. Left empty, the script
 * reads it from the WhatsApp connection or from a WhatsApp step that already
 * exists in this sub-account; if it finds neither it stops before writing
 * anything and says where to copy it from.
 */

(async () => {
  const WA_PHONE = "";
  const CFG = {
    "location": "2FMeC6zxqelIG07OViBj",
    "fromEmail": "{{ custom_values.hiring__reply_to_email }}",
    "fromName": "{{ custom_values.hiring__agency_name }}",
    "plan": [
      {
        "folder": "Media buyer",
        "name": "Media buyer · 3 Case studies",
        "aka": [
          "Media buyer · 3 Loom request"
        ],
        "pipelineId": "9sOXxWOdLQ92CySNRXeJ",
        "stageId": "7ddb2ac4-bbec-4a2d-8c91-5249cee48da5",
        "stageName": "Case studies",
        "subject": "Media buyer at {{ custom_values.hiring__agency_name }}, one thing before we talk",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Thanks for applying for the Media buyer role at {{ custom_values.hiring__agency_name }}. We liked your application.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">There is one thing we need before we talk.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.media_buyer__loom_request }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Reply to this message with it. Take the time it needs, but do not polish it for a week.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.media_buyer__position_breakdown_video }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, {{ custom_values.hiring__agency_name }} here about the Media buyer role. We liked your application. One thing before we talk, check your email for what to send. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_media_buyer_3_case_studies",
          "text": "Hi {{1}}, this is {{2}} from {{3}} about the Media buyer role. We liked your application. One thing before we talk, check your email for what to send.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Media buyer",
        "name": "Media buyer · 4 Group interview",
        "aka": [
          "Media buyer · 4 Group interview"
        ],
        "pipelineId": "9sOXxWOdLQ92CySNRXeJ",
        "stageId": "a15a66fd-ba99-40a8-9fdc-a5ab68490da3",
        "stageName": "Group interview",
        "subject": "Media buyer at {{ custom_values.hiring__agency_name }}, group interview",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You are through to a group interview for the Media buyer role at {{ custom_values.hiring__agency_name }}. It is on Zoom with the other people still in for this one role.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Book the slot that suits you: {{ custom_values.hiring__group_interview_booking_link }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Two things worth knowing. It starts on time, and answers are kept to sixty seconds each, so come with the short version of your story.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you are through to a group interview for the Media buyer role. Book your slot: {{ custom_values.hiring__group_interview_booking_link }} It starts on time. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_media_buyer_4_group_interview",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You are through to a group interview for the Media buyer role. Book your slot: {{4}} It starts on time.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.hiring__group_interview_booking_link}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://api.leadconnectorhq.com/widget/booking/abc123"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Media buyer",
        "name": "Media buyer · 5 One-to-one",
        "aka": [
          "Media buyer · 5 One to one"
        ],
        "pipelineId": "9sOXxWOdLQ92CySNRXeJ",
        "stageId": "7defd9a8-7a90-473e-935e-7be76227dee0",
        "stageName": "One-to-one interview",
        "subject": "Media buyer at {{ custom_values.hiring__agency_name }}, the last two steps",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You are through to the last round for the Media buyer role. There are two things left.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">First, a short piece of real work. It is unpaid, it is deliberately small, and we never use it ourselves.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.media_buyer__test_project }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Second, a one-to-one with me. Book it here: {{ custom_values.hiring__onetoone_booking_link }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Send the work back before the call if you can, and we will go through it together.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you are in the last round for Media buyer. I have emailed you a short unpaid piece of work. Book our one-to-one here: {{ custom_values.hiring__onetoone_booking_link }} {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_media_buyer_5_one_to_one",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You are in the last round for Media buyer. I have emailed you a short unpaid piece of work. Book our one-to-one here: {{4}} Send the work back before the call if you can.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.hiring__onetoone_booking_link}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://api.leadconnectorhq.com/widget/booking/abc123"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable. It closes with the email's own line \"Send the work back before the call if you can.\" so it does not end on the link."
        }
      },
      {
        "folder": "Media buyer",
        "name": "Media buyer · 6 Job offer",
        "aka": [
          "Media buyer · 6 Job offer"
        ],
        "pipelineId": "9sOXxWOdLQ92CySNRXeJ",
        "stageId": "33228863-9454-4ae1-8a3c-b42ed65c8de3",
        "stageName": "Job offer",
        "subject": "An offer from {{ custom_values.hiring__agency_name }}",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">We would like you to join {{ custom_values.hiring__agency_name }} as our Media buyer.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">What the role is: {{ custom_values.media_buyer__daily_responsibilities }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">What it pays: {{ custom_values.media_buyer__compensation }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Reply and tell me yes or no, and the earliest date you could start. If it is a yes I will send the contract and the onboarding call straight after.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, we would like you to join {{ custom_values.hiring__agency_name }} as our Media buyer. The full offer is in your email. Reply yes or no and the earliest you could start. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_media_buyer_6_job_offer",
          "text": "Hi {{1}}, this is {{2}}. We would like you to join {{3}} as our Media buyer. The full offer is in your email. Reply yes or no and the earliest you could start.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Media buyer",
        "name": "Media buyer · 2 Disqualified",
        "aka": [
          "Media buyer · 2 Disqualified"
        ],
        "pipelineId": "9sOXxWOdLQ92CySNRXeJ",
        "stageId": "f7ab945a-0711-4965-bc6f-704afe337a63",
        "stageName": "Disqualified",
        "subject": "Media buyer at {{ custom_values.hiring__agency_name }}",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Thanks for the time you put into applying for the Media buyer role at {{ custom_values.hiring__agency_name }}. We are not taking it further this time.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">That is not a judgement on your work, it is who else applied for this one role. We hire for these roles often, so apply again when you see one open: {{ custom_values.media_buyer__job_post }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, thanks for applying for the Media buyer role at {{ custom_values.hiring__agency_name }}. We are not taking it further this time. We hire these roles often: {{ custom_values.media_buyer__job_post }} {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_media_buyer_2_disqualified",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. Thanks for applying for the Media buyer role. We are not taking it further this time. We hire these roles often: {{4}} Thanks again for your time.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.media_buyer__job_post}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://maharamedia.com/careers/"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable. \"at {{agency}}\" folds into the opening, and it closes with \"Thanks again for your time.\" so it does not end on the link."
        }
      },
      {
        "folder": "Media buyer",
        "name": "Media buyer · 7 Bench",
        "aka": [
          "Media buyer · 7 Bench"
        ],
        "pipelineId": "9sOXxWOdLQ92CySNRXeJ",
        "stageId": "10da7dd6-09f0-495a-81d9-09a8076045d0",
        "stageName": "Bench",
        "subject": "Media buyer at {{ custom_values.hiring__agency_name }}, holding your application",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You did well and I want to be straight with you: we do not have the seat open right now.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">I am keeping your application on hand rather than closing it. When the next Media buyer seat opens you are one of the first people I will message, and you will not start from the beginning.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you did well but the Media buyer seat is not open right now. I am keeping your application on hand and you will hear from me first when it opens. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_media_buyer_7_bench",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You did well but the Media buyer seat is not open right now. I am keeping your application on hand and you will hear from me first when it opens.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Client success manager",
        "name": "Client success manager · 3 Loom request",
        "aka": [
          "Client success manager · 3 Loom request"
        ],
        "pipelineId": "FtmISKtIcYfOyk6LWybh",
        "stageId": "669f2316-a129-4b7f-9c53-293b92033af8",
        "stageName": "Loom request",
        "subject": "Client success manager at {{ custom_values.hiring__agency_name }}, one thing before we talk",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Thanks for applying for the Client success manager role at {{ custom_values.hiring__agency_name }}. We liked your application.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">There is one thing we need before we talk.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.client_success_manager__loom_request }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Reply to this message with it. Take the time it needs, but do not polish it for a week.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.client_success_manager__position_breakdown_video }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, {{ custom_values.hiring__agency_name }} here about the Client success manager role. We liked your application. One thing before we talk, check your email for what to send. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_client_success_manager_3_loom_request",
          "text": "Hi {{1}}, this is {{2}} from {{3}} about the Client success manager role. We liked your application. One thing before we talk, check your email for what to send.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Client success manager",
        "name": "Client success manager · 4 Group interview",
        "aka": [
          "Client success manager · 4 Group interview"
        ],
        "pipelineId": "FtmISKtIcYfOyk6LWybh",
        "stageId": "521154c4-aa5f-4bcd-89cc-741ba18ad3bc",
        "stageName": "Group interview",
        "subject": "Client success manager at {{ custom_values.hiring__agency_name }}, group interview",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You are through to a group interview for the Client success manager role at {{ custom_values.hiring__agency_name }}. It is on Zoom with the other people still in for this one role.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Book the slot that suits you: {{ custom_values.hiring__group_interview_booking_link }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Two things worth knowing. It starts on time, and answers are kept to sixty seconds each, so come with the short version of your story.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you are through to a group interview for the Client success manager role. Book your slot: {{ custom_values.hiring__group_interview_booking_link }} It starts on time. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_client_success_manager_4_group_interview",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You are through to a group interview for the Client success manager role. Book your slot: {{4}} It starts on time.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.hiring__group_interview_booking_link}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://api.leadconnectorhq.com/widget/booking/abc123"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Client success manager",
        "name": "Client success manager · 5 One-to-one",
        "aka": [
          "Client success manager · 5 One to one"
        ],
        "pipelineId": "FtmISKtIcYfOyk6LWybh",
        "stageId": "9a04b2c3-673c-42c3-80a6-a1467c987e6a",
        "stageName": "One-to-one interview",
        "subject": "Client success manager at {{ custom_values.hiring__agency_name }}, the last two steps",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You are through to the last round for the Client success manager role. There are two things left.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">First, a short piece of real work. It is unpaid, it is deliberately small, and we never use it ourselves.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.client_success_manager__test_project }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Second, a one-to-one with me. Book it here: {{ custom_values.hiring__onetoone_booking_link }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Send the work back before the call if you can, and we will go through it together.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you are in the last round for Client success manager. I have emailed you a short unpaid piece of work. Book our one-to-one here: {{ custom_values.hiring__onetoone_booking_link }} {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_client_success_manager_5_one_to_one",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You are in the last round for Client success manager. I have emailed you a short unpaid piece of work. Book our one-to-one here: {{4}} Send the work back before the call if you can.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.hiring__onetoone_booking_link}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://api.leadconnectorhq.com/widget/booking/abc123"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable. It closes with the email's own line \"Send the work back before the call if you can.\" so it does not end on the link."
        }
      },
      {
        "folder": "Client success manager",
        "name": "Client success manager · 6 Job offer",
        "aka": [
          "Client success manager · 6 Job offer"
        ],
        "pipelineId": "FtmISKtIcYfOyk6LWybh",
        "stageId": "64558d99-dd3f-4853-a75d-412ebf0d1141",
        "stageName": "Job offer",
        "subject": "An offer from {{ custom_values.hiring__agency_name }}",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">We would like you to join {{ custom_values.hiring__agency_name }} as our Client success manager.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">What the role is: {{ custom_values.client_success_manager__daily_responsibilities }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">What it pays: {{ custom_values.client_success_manager__compensation }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Reply and tell me yes or no, and the earliest date you could start. If it is a yes I will send the contract and the onboarding call straight after.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, we would like you to join {{ custom_values.hiring__agency_name }} as our Client success manager. The full offer is in your email. Reply yes or no and the earliest you could start. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_client_success_manager_6_job_offer",
          "text": "Hi {{1}}, this is {{2}}. We would like you to join {{3}} as our Client success manager. The full offer is in your email. Reply yes or no and the earliest you could start.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Client success manager",
        "name": "Client success manager · 2 Disqualified",
        "aka": [
          "Client success manager · 2 Disqualified"
        ],
        "pipelineId": "FtmISKtIcYfOyk6LWybh",
        "stageId": "8873a752-547d-4d8f-8802-2576e435d61b",
        "stageName": "Disqualified",
        "subject": "Client success manager at {{ custom_values.hiring__agency_name }}",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Thanks for the time you put into applying for the Client success manager role at {{ custom_values.hiring__agency_name }}. We are not taking it further this time.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">That is not a judgement on your work, it is who else applied for this one role. We hire for these roles often, so apply again when you see one open: {{ custom_values.client_success_manager__job_post }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, thanks for applying for the Client success manager role at {{ custom_values.hiring__agency_name }}. We are not taking it further this time. We hire these roles often: {{ custom_values.client_success_manager__job_post }} {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_client_success_manager_2_disqualified",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. Thanks for applying for the Client success manager role. We are not taking it further this time. We hire these roles often: {{4}} Thanks again for your time.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.client_success_manager__job_post}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://maharamedia.com/careers/"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable. \"at {{agency}}\" folds into the opening, and it closes with \"Thanks again for your time.\" so it does not end on the link."
        }
      },
      {
        "folder": "Client success manager",
        "name": "Client success manager · 7 Bench",
        "aka": [
          "Client success manager · 7 Bench"
        ],
        "pipelineId": "FtmISKtIcYfOyk6LWybh",
        "stageId": "c0849fa8-911f-4223-8925-c33b0c618f6c",
        "stageName": "Bench",
        "subject": "Client success manager at {{ custom_values.hiring__agency_name }}, holding your application",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You did well and I want to be straight with you: we do not have the seat open right now.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">I am keeping your application on hand rather than closing it. When the next Client success manager seat opens you are one of the first people I will message, and you will not start from the beginning.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you did well but the Client success manager seat is not open right now. I am keeping your application on hand and you will hear from me first when it opens. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_client_success_manager_7_bench",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You did well but the Client success manager seat is not open right now. I am keeping your application on hand and you will hear from me first when it opens.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Sales closer (B2B)",
        "name": "Sales closer (B2B) · 3 Loom request",
        "aka": [
          "Sales closer (B2B) · 3 Loom request"
        ],
        "pipelineId": "b0SBRLPFHVbR4UKMVTjv",
        "stageId": "db91433f-89f1-4f67-b6d9-29ed4f82e0d0",
        "stageName": "Loom request",
        "subject": "Sales closer (B2B) at {{ custom_values.hiring__agency_name }}, one thing before we talk",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Thanks for applying for the Sales closer (B2B) role at {{ custom_values.hiring__agency_name }}. We liked your application.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">There is one thing we need before we talk.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.sales_rep_b2b_setter_and_closer__loom_request }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Reply to this message with it. Take the time it needs, but do not polish it for a week.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.sales_rep_b2b_setter_and_closer__position_breakdown_video }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, {{ custom_values.hiring__agency_name }} here about the Sales closer (B2B) role. We liked your application. One thing before we talk, check your email for what to send. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_sales_closer_b2b_3_loom_request",
          "text": "Hi {{1}}, this is {{2}} from {{3}} about the Sales closer (B2B) role. We liked your application. One thing before we talk, check your email for what to send.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Sales closer (B2B)",
        "name": "Sales closer (B2B) · 4 Group interview",
        "aka": [
          "Sales closer (B2B) · 4 Group interview"
        ],
        "pipelineId": "b0SBRLPFHVbR4UKMVTjv",
        "stageId": "071a574d-3cf4-4638-8a66-3ad351199ad3",
        "stageName": "Group interview",
        "subject": "Sales closer (B2B) at {{ custom_values.hiring__agency_name }}, group interview",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You are through to a group interview for the Sales closer (B2B) role at {{ custom_values.hiring__agency_name }}. It is on Zoom with the other people still in for this one role.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Book the slot that suits you: {{ custom_values.hiring__group_interview_booking_link }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Two things worth knowing. It starts on time, and answers are kept to sixty seconds each, so come with the short version of your story.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you are through to a group interview for the Sales closer (B2B) role. Book your slot: {{ custom_values.hiring__group_interview_booking_link }} It starts on time. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_sales_closer_b2b_4_group_interview",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You are through to a group interview for the Sales closer (B2B) role. Book your slot: {{4}} It starts on time.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.hiring__group_interview_booking_link}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://api.leadconnectorhq.com/widget/booking/abc123"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Sales closer (B2B)",
        "name": "Sales closer (B2B) · 5 One-to-one",
        "aka": [
          "Sales closer (B2B) · 5 One to one"
        ],
        "pipelineId": "b0SBRLPFHVbR4UKMVTjv",
        "stageId": "15c4f199-1056-4134-b463-b6060fc9616f",
        "stageName": "One-to-one interview",
        "subject": "Sales closer (B2B) at {{ custom_values.hiring__agency_name }}, the last two steps",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You are through to the last round for the Sales closer (B2B) role. There are two things left.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">First, a short piece of real work. It is unpaid, it is deliberately small, and we never use it ourselves.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.sales_rep_b2b_setter_and_closer__test_project }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Second, a one-to-one with me. Book it here: {{ custom_values.hiring__onetoone_booking_link }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Send the work back before the call if you can, and we will go through it together.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you are in the last round for Sales closer (B2B). I have emailed you a short unpaid piece of work. Book our one-to-one here: {{ custom_values.hiring__onetoone_booking_link }} {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_sales_closer_b2b_5_one_to_one",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You are in the last round for Sales closer (B2B). I have emailed you a short unpaid piece of work. Book our one-to-one here: {{4}} Send the work back before the call if you can.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.hiring__onetoone_booking_link}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://api.leadconnectorhq.com/widget/booking/abc123"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable. It closes with the email's own line \"Send the work back before the call if you can.\" so it does not end on the link."
        }
      },
      {
        "folder": "Sales closer (B2B)",
        "name": "Sales closer (B2B) · 6 Job offer",
        "aka": [
          "Sales closer (B2B) · 6 Job offer"
        ],
        "pipelineId": "b0SBRLPFHVbR4UKMVTjv",
        "stageId": "ae8dfe66-7845-4cba-8877-71ea82a1e957",
        "stageName": "Job offer",
        "subject": "An offer from {{ custom_values.hiring__agency_name }}",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">We would like you to join {{ custom_values.hiring__agency_name }} as our Sales closer (B2B).</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">What the role is: {{ custom_values.sales_rep_b2b_setter_and_closer__daily_responsibilities }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">What it pays: {{ custom_values.sales_rep_b2b_setter_and_closer__compensation }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Reply and tell me yes or no, and the earliest date you could start. If it is a yes I will send the contract and the onboarding call straight after.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, we would like you to join {{ custom_values.hiring__agency_name }} as our Sales closer (B2B). The full offer is in your email. Reply yes or no and the earliest you could start. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_sales_closer_b2b_6_job_offer",
          "text": "Hi {{1}}, this is {{2}}. We would like you to join {{3}} as our Sales closer (B2B). The full offer is in your email. Reply yes or no and the earliest you could start.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Sales closer (B2B)",
        "name": "Sales closer (B2B) · 2 Disqualified",
        "aka": [
          "Sales closer (B2B) · 2 Disqualified"
        ],
        "pipelineId": "b0SBRLPFHVbR4UKMVTjv",
        "stageId": "e11a20c8-11b4-4b23-b817-55c0f3dce29a",
        "stageName": "Disqualified",
        "subject": "Sales closer (B2B) at {{ custom_values.hiring__agency_name }}",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Thanks for the time you put into applying for the Sales closer (B2B) role at {{ custom_values.hiring__agency_name }}. We are not taking it further this time.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">That is not a judgement on your work, it is who else applied for this one role. We hire for these roles often, so apply again when you see one open: {{ custom_values.sales_rep_b2b_setter_and_closer__job_post }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, thanks for applying for the Sales closer (B2B) role at {{ custom_values.hiring__agency_name }}. We are not taking it further this time. We hire these roles often: {{ custom_values.sales_rep_b2b_setter_and_closer__job_post }} {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_sales_closer_b2b_2_disqualified",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. Thanks for applying for the Sales closer (B2B) role. We are not taking it further this time. We hire these roles often: {{4}} Thanks again for your time.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.sales_rep_b2b_setter_and_closer__job_post}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://maharamedia.com/careers/"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable. \"at {{agency}}\" folds into the opening, and it closes with \"Thanks again for your time.\" so it does not end on the link."
        }
      },
      {
        "folder": "Sales closer (B2B)",
        "name": "Sales closer (B2B) · 7 Bench",
        "aka": [
          "Sales closer (B2B) · 7 Bench"
        ],
        "pipelineId": "b0SBRLPFHVbR4UKMVTjv",
        "stageId": "dbd11ce4-6f42-4426-8c0d-b1f23e0c1892",
        "stageName": "Bench",
        "subject": "Sales closer (B2B) at {{ custom_values.hiring__agency_name }}, holding your application",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You did well and I want to be straight with you: we do not have the seat open right now.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">I am keeping your application on hand rather than closing it. When the next Sales closer (B2B) seat opens you are one of the first people I will message, and you will not start from the beginning.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you did well but the Sales closer (B2B) seat is not open right now. I am keeping your application on hand and you will hear from me first when it opens. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_sales_closer_b2b_7_bench",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You did well but the Sales closer (B2B) seat is not open right now. I am keeping your application on hand and you will hear from me first when it opens.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Sales setter (B2B)",
        "name": "Sales setter (B2B) · 3 Loom request",
        "aka": [
          "Sales setter (B2B) · 3 Loom request"
        ],
        "pipelineId": "NtGptsYGW8Ryesq4kQ2O",
        "stageId": "cbc0bddd-c0b6-4a29-9f6c-773ece2d66a1",
        "stageName": "Loom request",
        "subject": "Sales setter (B2B) at {{ custom_values.hiring__agency_name }}, one thing before we talk",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Thanks for applying for the Sales setter (B2B) role at {{ custom_values.hiring__agency_name }}. We liked your application.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">There is one thing we need before we talk.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.sales_setter_b2b__loom_request }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Reply to this message with it. Take the time it needs, but do not polish it for a week.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.sales_setter_b2b__position_breakdown_video }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, {{ custom_values.hiring__agency_name }} here about the Sales setter (B2B) role. We liked your application. One thing before we talk, check your email for what to send. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_sales_setter_b2b_3_loom_request",
          "text": "Hi {{1}}, this is {{2}} from {{3}} about the Sales setter (B2B) role. We liked your application. One thing before we talk, check your email for what to send.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Sales setter (B2B)",
        "name": "Sales setter (B2B) · 4 Group interview",
        "aka": [
          "Sales setter (B2B) · 4 Group interview"
        ],
        "pipelineId": "NtGptsYGW8Ryesq4kQ2O",
        "stageId": "698f8349-321b-490e-947d-6c37fa83507e",
        "stageName": "Group interview",
        "subject": "Sales setter (B2B) at {{ custom_values.hiring__agency_name }}, group interview",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You are through to a group interview for the Sales setter (B2B) role at {{ custom_values.hiring__agency_name }}. It is on Zoom with the other people still in for this one role.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Book the slot that suits you: {{ custom_values.hiring__group_interview_booking_link }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Two things worth knowing. It starts on time, and answers are kept to sixty seconds each, so come with the short version of your story.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you are through to a group interview for the Sales setter (B2B) role. Book your slot: {{ custom_values.hiring__group_interview_booking_link }} It starts on time. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_sales_setter_b2b_4_group_interview",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You are through to a group interview for the Sales setter (B2B) role. Book your slot: {{4}} It starts on time.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.hiring__group_interview_booking_link}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://api.leadconnectorhq.com/widget/booking/abc123"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Sales setter (B2B)",
        "name": "Sales setter (B2B) · 5 One-to-one",
        "aka": [
          "Sales setter (B2B) · 5 One to one"
        ],
        "pipelineId": "NtGptsYGW8Ryesq4kQ2O",
        "stageId": "cb4631c7-58ff-4cd0-bae4-9aa4138c8a4d",
        "stageName": "One-to-one interview",
        "subject": "Sales setter (B2B) at {{ custom_values.hiring__agency_name }}, the last two steps",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You are through to the last round for the Sales setter (B2B) role. There are two things left.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">First, a short piece of real work. It is unpaid, it is deliberately small, and we never use it ourselves.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.sales_setter_b2b__test_project }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Second, a one-to-one with me. Book it here: {{ custom_values.hiring__onetoone_booking_link }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Send the work back before the call if you can, and we will go through it together.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you are in the last round for Sales setter (B2B). I have emailed you a short unpaid piece of work. Book our one-to-one here: {{ custom_values.hiring__onetoone_booking_link }} {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_sales_setter_b2b_5_one_to_one",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You are in the last round for Sales setter (B2B). I have emailed you a short unpaid piece of work. Book our one-to-one here: {{4}} Send the work back before the call if you can.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.hiring__onetoone_booking_link}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://api.leadconnectorhq.com/widget/booking/abc123"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable. It closes with the email's own line \"Send the work back before the call if you can.\" so it does not end on the link."
        }
      },
      {
        "folder": "Sales setter (B2B)",
        "name": "Sales setter (B2B) · 6 Job offer",
        "aka": [
          "Sales setter (B2B) · 6 Job offer"
        ],
        "pipelineId": "NtGptsYGW8Ryesq4kQ2O",
        "stageId": "65103f08-6a16-482a-9a3e-28bece63dfa4",
        "stageName": "Job offer",
        "subject": "An offer from {{ custom_values.hiring__agency_name }}",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">We would like you to join {{ custom_values.hiring__agency_name }} as our Sales setter (B2B).</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">What the role is: {{ custom_values.sales_setter_b2b__daily_responsibilities }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">What it pays: {{ custom_values.sales_setter_b2b__compensation }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Reply and tell me yes or no, and the earliest date you could start. If it is a yes I will send the contract and the onboarding call straight after.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, we would like you to join {{ custom_values.hiring__agency_name }} as our Sales setter (B2B). The full offer is in your email. Reply yes or no and the earliest you could start. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_sales_setter_b2b_6_job_offer",
          "text": "Hi {{1}}, this is {{2}}. We would like you to join {{3}} as our Sales setter (B2B). The full offer is in your email. Reply yes or no and the earliest you could start.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Sales setter (B2B)",
        "name": "Sales setter (B2B) · 2 Disqualified",
        "aka": [
          "Sales setter (B2B) · 2 Disqualified"
        ],
        "pipelineId": "NtGptsYGW8Ryesq4kQ2O",
        "stageId": "82951d4a-7d8b-4e09-a85f-a0f654e43832",
        "stageName": "Disqualified",
        "subject": "Sales setter (B2B) at {{ custom_values.hiring__agency_name }}",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Thanks for the time you put into applying for the Sales setter (B2B) role at {{ custom_values.hiring__agency_name }}. We are not taking it further this time.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">That is not a judgement on your work, it is who else applied for this one role. We hire for these roles often, so apply again when you see one open: {{ custom_values.sales_setter_b2b__job_post }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, thanks for applying for the Sales setter (B2B) role at {{ custom_values.hiring__agency_name }}. We are not taking it further this time. We hire these roles often: {{ custom_values.sales_setter_b2b__job_post }} {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_sales_setter_b2b_2_disqualified",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. Thanks for applying for the Sales setter (B2B) role. We are not taking it further this time. We hire these roles often: {{4}} Thanks again for your time.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.sales_setter_b2b__job_post}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://maharamedia.com/careers/"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable. \"at {{agency}}\" folds into the opening, and it closes with \"Thanks again for your time.\" so it does not end on the link."
        }
      },
      {
        "folder": "Sales setter (B2B)",
        "name": "Sales setter (B2B) · 7 Bench",
        "aka": [
          "Sales setter (B2B) · 7 Bench"
        ],
        "pipelineId": "NtGptsYGW8Ryesq4kQ2O",
        "stageId": "b08930fd-8456-4dc5-bb3d-b2ff69bbc1ee",
        "stageName": "Bench",
        "subject": "Sales setter (B2B) at {{ custom_values.hiring__agency_name }}, holding your application",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You did well and I want to be straight with you: we do not have the seat open right now.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">I am keeping your application on hand rather than closing it. When the next Sales setter (B2B) seat opens you are one of the first people I will message, and you will not start from the beginning.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you did well but the Sales setter (B2B) seat is not open right now. I am keeping your application on hand and you will hear from me first when it opens. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_sales_setter_b2b_7_bench",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You did well but the Sales setter (B2B) seat is not open right now. I am keeping your application on hand and you will hear from me first when it opens.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Call centre agent",
        "name": "Call centre agent · 3 Loom request",
        "aka": [
          "Call centre agent · 3 Loom request"
        ],
        "pipelineId": "vgNIYSGNWwd1FgoeF0bb",
        "stageId": "a6e766b8-a864-4e6f-aab2-77a2f3dd315c",
        "stageName": "Loom request",
        "subject": "Call centre agent at {{ custom_values.hiring__agency_name }}, one thing before we talk",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Thanks for applying for the Call centre agent role at {{ custom_values.hiring__agency_name }}. We liked your application.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">There is one thing we need before we talk.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.call_centre_agent__loom_request }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Reply to this message with it. Take the time it needs, but do not polish it for a week.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.call_centre_agent__position_breakdown_video }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, {{ custom_values.hiring__agency_name }} here about the Call centre agent role. We liked your application. One thing before we talk, check your email for what to send. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_call_centre_agent_3_loom_request",
          "text": "Hi {{1}}, this is {{2}} from {{3}} about the Call centre agent role. We liked your application. One thing before we talk, check your email for what to send.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Call centre agent",
        "name": "Call centre agent · 4 Group interview",
        "aka": [
          "Call centre agent · 4 Group interview"
        ],
        "pipelineId": "vgNIYSGNWwd1FgoeF0bb",
        "stageId": "6b512e20-b9ec-4ab5-9c12-d08449d5fc15",
        "stageName": "Group interview",
        "subject": "Call centre agent at {{ custom_values.hiring__agency_name }}, group interview",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You are through to a group interview for the Call centre agent role at {{ custom_values.hiring__agency_name }}. It is on Zoom with the other people still in for this one role.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Book the slot that suits you: {{ custom_values.hiring__group_interview_booking_link }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Two things worth knowing. It starts on time, and answers are kept to sixty seconds each, so come with the short version of your story.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you are through to a group interview for the Call centre agent role. Book your slot: {{ custom_values.hiring__group_interview_booking_link }} It starts on time. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_call_centre_agent_4_group_interview",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You are through to a group interview for the Call centre agent role. Book your slot: {{4}} It starts on time.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.hiring__group_interview_booking_link}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://api.leadconnectorhq.com/widget/booking/abc123"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Call centre agent",
        "name": "Call centre agent · 5 One-to-one",
        "aka": [
          "Call centre agent · 5 One to one"
        ],
        "pipelineId": "vgNIYSGNWwd1FgoeF0bb",
        "stageId": "e655bdec-6934-45f5-b473-2a63787c8d06",
        "stageName": "One-to-one interview",
        "subject": "Call centre agent at {{ custom_values.hiring__agency_name }}, the last two steps",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You are through to the last round for the Call centre agent role. There are two things left.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">First, a short piece of real work. It is unpaid, it is deliberately small, and we never use it ourselves.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.call_centre_agent__test_project }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Second, a one-to-one with me. Book it here: {{ custom_values.hiring__onetoone_booking_link }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Send the work back before the call if you can, and we will go through it together.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you are in the last round for Call centre agent. I have emailed you a short unpaid piece of work. Book our one-to-one here: {{ custom_values.hiring__onetoone_booking_link }} {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_call_centre_agent_5_one_to_one",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You are in the last round for Call centre agent. I have emailed you a short unpaid piece of work. Book our one-to-one here: {{4}} Send the work back before the call if you can.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.hiring__onetoone_booking_link}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://api.leadconnectorhq.com/widget/booking/abc123"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable. It closes with the email's own line \"Send the work back before the call if you can.\" so it does not end on the link."
        }
      },
      {
        "folder": "Call centre agent",
        "name": "Call centre agent · 6 Job offer",
        "aka": [
          "Call centre agent · 6 Job offer"
        ],
        "pipelineId": "vgNIYSGNWwd1FgoeF0bb",
        "stageId": "9ab78f79-d41c-4e1b-8aab-ad191bceb3da",
        "stageName": "Job offer",
        "subject": "An offer from {{ custom_values.hiring__agency_name }}",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">We would like you to join {{ custom_values.hiring__agency_name }} as our Call centre agent.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">What the role is: {{ custom_values.call_centre_agent__daily_responsibilities }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">What it pays: {{ custom_values.call_centre_agent__compensation }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Reply and tell me yes or no, and the earliest date you could start. If it is a yes I will send the contract and the onboarding call straight after.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, we would like you to join {{ custom_values.hiring__agency_name }} as our Call centre agent. The full offer is in your email. Reply yes or no and the earliest you could start. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_call_centre_agent_6_job_offer",
          "text": "Hi {{1}}, this is {{2}}. We would like you to join {{3}} as our Call centre agent. The full offer is in your email. Reply yes or no and the earliest you could start.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Call centre agent",
        "name": "Call centre agent · 2 Disqualified",
        "aka": [
          "Call centre agent · 2 Disqualified"
        ],
        "pipelineId": "vgNIYSGNWwd1FgoeF0bb",
        "stageId": "1939c454-aea8-4402-a4d9-1c203be50cb0",
        "stageName": "Disqualified",
        "subject": "Call centre agent at {{ custom_values.hiring__agency_name }}",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Thanks for the time you put into applying for the Call centre agent role at {{ custom_values.hiring__agency_name }}. We are not taking it further this time.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">That is not a judgement on your work, it is who else applied for this one role. We hire for these roles often, so apply again when you see one open: {{ custom_values.call_centre_agent__job_post }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, thanks for applying for the Call centre agent role at {{ custom_values.hiring__agency_name }}. We are not taking it further this time. We hire these roles often: {{ custom_values.call_centre_agent__job_post }} {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_call_centre_agent_2_disqualified",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. Thanks for applying for the Call centre agent role. We are not taking it further this time. We hire these roles often: {{4}} Thanks again for your time.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.call_centre_agent__job_post}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://maharamedia.com/careers/"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable. \"at {{agency}}\" folds into the opening, and it closes with \"Thanks again for your time.\" so it does not end on the link."
        }
      },
      {
        "folder": "Call centre agent",
        "name": "Call centre agent · 7 Bench",
        "aka": [
          "Call centre agent · 7 Bench"
        ],
        "pipelineId": "vgNIYSGNWwd1FgoeF0bb",
        "stageId": "971b65b6-4684-42a4-8257-e272f872319b",
        "stageName": "Bench",
        "subject": "Call centre agent at {{ custom_values.hiring__agency_name }}, holding your application",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You did well and I want to be straight with you: we do not have the seat open right now.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">I am keeping your application on hand rather than closing it. When the next Call centre agent seat opens you are one of the first people I will message, and you will not start from the beginning.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you did well but the Call centre agent seat is not open right now. I am keeping your application on hand and you will hear from me first when it opens. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_call_centre_agent_7_bench",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You did well but the Call centre agent seat is not open right now. I am keeping your application on hand and you will hear from me first when it opens.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Video editor",
        "name": "Video editor · 3 Case studies",
        "aka": [
          "Video editor · 3 Loom request"
        ],
        "pipelineId": "X9EkORpj29Kozhhe5Gic",
        "stageId": "81bf1045-5dfb-4c7c-8ea3-e3981ab7b96c",
        "stageName": "Case studies",
        "subject": "Video editor at {{ custom_values.hiring__agency_name }}, one thing before we talk",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Thanks for applying for the Video editor role at {{ custom_values.hiring__agency_name }}. We liked your application.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">There is one thing we need before we talk.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.video_editor__loom_request }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Reply to this message with it. Take the time it needs, but do not polish it for a week.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.video_editor__position_breakdown_video }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, {{ custom_values.hiring__agency_name }} here about the Video editor role. We liked your application. One thing before we talk, check your email for what to send. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_video_editor_3_case_studies",
          "text": "Hi {{1}}, this is {{2}} from {{3}} about the Video editor role. We liked your application. One thing before we talk, check your email for what to send.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Video editor",
        "name": "Video editor · 4 Group interview",
        "aka": [
          "Video editor · 4 Group interview"
        ],
        "pipelineId": "X9EkORpj29Kozhhe5Gic",
        "stageId": "677c1111-410f-4211-958f-328d2295a7f1",
        "stageName": "Group interview",
        "subject": "Video editor at {{ custom_values.hiring__agency_name }}, group interview",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You are through to a group interview for the Video editor role at {{ custom_values.hiring__agency_name }}. It is on Zoom with the other people still in for this one role.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Book the slot that suits you: {{ custom_values.hiring__group_interview_booking_link }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Two things worth knowing. It starts on time, and answers are kept to sixty seconds each, so come with the short version of your story.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you are through to a group interview for the Video editor role. Book your slot: {{ custom_values.hiring__group_interview_booking_link }} It starts on time. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_video_editor_4_group_interview",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You are through to a group interview for the Video editor role. Book your slot: {{4}} It starts on time.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.hiring__group_interview_booking_link}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://api.leadconnectorhq.com/widget/booking/abc123"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Video editor",
        "name": "Video editor · 5 One-to-one",
        "aka": [
          "Video editor · 5 One to one"
        ],
        "pipelineId": "X9EkORpj29Kozhhe5Gic",
        "stageId": "dd9dac08-93ee-4f03-be03-a1ee68ff05a2",
        "stageName": "One-to-one interview",
        "subject": "Video editor at {{ custom_values.hiring__agency_name }}, the last two steps",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You are through to the last round for the Video editor role. There are two things left.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">First, a short piece of real work. It is unpaid, it is deliberately small, and we never use it ourselves.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.video_editor__test_project }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Second, a one-to-one with me. Book it here: {{ custom_values.hiring__onetoone_booking_link }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Send the work back before the call if you can, and we will go through it together.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you are in the last round for Video editor. I have emailed you a short unpaid piece of work. Book our one-to-one here: {{ custom_values.hiring__onetoone_booking_link }} {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_video_editor_5_one_to_one",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You are in the last round for Video editor. I have emailed you a short unpaid piece of work. Book our one-to-one here: {{4}} Send the work back before the call if you can.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.hiring__onetoone_booking_link}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://api.leadconnectorhq.com/widget/booking/abc123"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable. It closes with the email's own line \"Send the work back before the call if you can.\" so it does not end on the link."
        }
      },
      {
        "folder": "Video editor",
        "name": "Video editor · 6 Job offer",
        "aka": [
          "Video editor · 6 Job offer"
        ],
        "pipelineId": "X9EkORpj29Kozhhe5Gic",
        "stageId": "6f3d962d-2029-44de-a8ad-b0f4c288f9dc",
        "stageName": "Job offer",
        "subject": "An offer from {{ custom_values.hiring__agency_name }}",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">We would like you to join {{ custom_values.hiring__agency_name }} as our Video editor.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">What the role is: {{ custom_values.video_editor__daily_responsibilities }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">What it pays: {{ custom_values.video_editor__compensation }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Reply and tell me yes or no, and the earliest date you could start. If it is a yes I will send the contract and the onboarding call straight after.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, we would like you to join {{ custom_values.hiring__agency_name }} as our Video editor. The full offer is in your email. Reply yes or no and the earliest you could start. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_video_editor_6_job_offer",
          "text": "Hi {{1}}, this is {{2}}. We would like you to join {{3}} as our Video editor. The full offer is in your email. Reply yes or no and the earliest you could start.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      },
      {
        "folder": "Video editor",
        "name": "Video editor · 2 Disqualified",
        "aka": [
          "Video editor · 2 Disqualified"
        ],
        "pipelineId": "X9EkORpj29Kozhhe5Gic",
        "stageId": "eb4a3354-0c2a-4a66-8462-055bef2f4c82",
        "stageName": "Disqualified",
        "subject": "Video editor at {{ custom_values.hiring__agency_name }}",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Thanks for the time you put into applying for the Video editor role at {{ custom_values.hiring__agency_name }}. We are not taking it further this time.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">That is not a judgement on your work, it is who else applied for this one role. We hire for these roles often, so apply again when you see one open: {{ custom_values.video_editor__job_post }}</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, thanks for applying for the Video editor role at {{ custom_values.hiring__agency_name }}. We are not taking it further this time. We hire these roles often: {{ custom_values.video_editor__job_post }} {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_video_editor_2_disqualified",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. Thanks for applying for the Video editor role. We are not taking it further this time. We hire these roles often: {{4}} Thanks again for your time.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}",
            "{{custom_values.video_editor__job_post}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media",
            "https://maharamedia.com/careers/"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable. \"at {{agency}}\" folds into the opening, and it closes with \"Thanks again for your time.\" so it does not end on the link."
        }
      },
      {
        "folder": "Video editor",
        "name": "Video editor · 7 Bench",
        "aka": [
          "Video editor · 7 Bench"
        ],
        "pipelineId": "X9EkORpj29Kozhhe5Gic",
        "stageId": "65a11b8a-c134-4806-a139-f9b150b28b51",
        "stageName": "Bench",
        "subject": "Video editor at {{ custom_values.hiring__agency_name }}, holding your application",
        "html": "<p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">Hi {{contact.first_name}},</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">You did well and I want to be straight with you: we do not have the seat open right now.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">I am keeping your application on hand rather than closing it. When the next Video editor seat opens you are one of the first people I will message, and you will not start from the beginning.</span></p><br/><p style=\"margin:0px; line-height: 1.15;margin: 0px;\"><span style=\"font-family: arial\">{{ custom_values.hiring__owner_name }}</span></p>",
        "sms": "Hi {{contact.first_name}}, you did well but the Video editor seat is not open right now. I am keeping your application on hand and you will hear from me first when it opens. {{ custom_values.hiring__owner_name }}",
        "whatsapp": {
          "template": "hiring_video_editor_7_bench",
          "text": "Hi {{1}}, this is {{2}} from {{3}}. You did well but the Video editor seat is not open right now. I am keeping your application on hand and you will hear from me first when it opens.",
          "variables": [
            "{{contact.first_name}}",
            "{{custom_values.hiring__owner_name}}",
            "{{custom_values.hiring__agency_name}}"
          ],
          "examples": [
            "Sara",
            "Aziz",
            "Mahara Media"
          ],
          "changed": "The sign-off moves to the start (\"this is {{owner}} from {{agency}}\"), because Meta refuses a template that ends on a variable."
        }
      }
    ]
  };
  const LOC = CFG.location;
  const BASE = "https://backend.leadconnectorhq.com";
  const STEPS_SMS = 2;

  const looksLikeGhlJwt = s => {
    try {
      if (typeof s !== "string" || s.split(".").length !== 3) return false;
      const p = JSON.parse(atob(s.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return p.aud === "highlevel-backend" && p.exp * 1000 > Date.now();
    } catch { return false; }
  };
  let token = await new Promise(res => {
    let r; try { r = indexedDB.open("firebaseLocalStorageDb"); } catch { return res(null); }
    r.onerror = () => res(null);
    r.onsuccess = () => {
      try {
        const all = r.result.transaction("firebaseLocalStorage", "readonly").objectStore("firebaseLocalStorage").getAll();
        all.onsuccess = () => { for (const row of all.result) { const t = row?.value?.stsTokenManager?.accessToken; if (t) return res(t); } res(null); };
        all.onerror = () => res(null);
      } catch { res(null); }
    };
  });
  if (!looksLikeGhlJwt(token)) {
    outer: for (const store of [localStorage, sessionStorage])
      for (let i = 0; i < store.length; i++) {
        const v = store.getItem(store.key(i)) || "";
        if (looksLikeGhlJwt(v)) { token = v; break outer; }
        for (const c of (v.match(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []))
          if (looksLikeGhlJwt(c)) { token = c; break outer; }
      }
  }
  if (!looksLikeGhlJwt(token)) {
    console.error("No live session token in this frame. Check the console frame dropdown says client-app-automation-workflows.leadconnectorhq.com, then run this again. Nothing was changed.");
    return;
  }

  const H = { "token-id": token, channel: "APP", source: "WEB_USER", version: "2021-04-15", "Content-Type": "application/json" };
  const api = async (m, p, b) => {
    // Publishing is never this script's call.
    if (/change-status|publish/i.test(p)) throw new Error(`refused to call ${p}: this script never publishes`);
    const r = await fetch(BASE + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, json: j };
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); }));
  const scrub = s => String(s)
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[jwt]")
    .replace(/token[-_]?id"\s*:\s*"[^"]+"/gi, 'token-id":"[redacted]"');
  const result = { location: LOC, at: new Date().toISOString(), version: 4, whatsapp: null, templates: [], built: [], failed: [], stopped: null };
  const finish = () => {
    const text = scrub(JSON.stringify(result, null, 2));
    try {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      a.download = "hiring-phase-b-v4-result.json";
      a.click();
    } catch {}
    return result;
  };
  const stop = sentence => {
    result.stopped = sentence;
    console.error(sentence);
    return finish();
  };

  // 1. Is WhatsApp connected on this sub-account at all? -------------------
  console.log("Checking WhatsApp on this sub-account...");
  const wa = await api("GET", `/phone-system/whatsapp/location/${LOC}/is-configured`);
  result.whatsapp = { status: wa.status, isConfigured: wa.json?.isConfigured === true };
  if (wa.status !== 200 || wa.json?.isConfigured !== true)
    return stop("WhatsApp is not connected on MaharaMedia Hiring, so there is nothing to send a backup from. Connect it in Settings, then WhatsApp, then run this again. Nothing was changed.");

  console.log("Reading what is already there...");
  const list = await api("GET", `/workflow/${LOC}/list?limit=500&offset=0`);
  if (list.status !== 200) return stop(`Could not read the workflow list (${list.status}). Nothing was changed.`);
  const existing = list.json?.rows || [];
  const byName = new Map(existing.map(r => [String(r.name).trim(), r]));

  // 2. Which number WhatsApp sends from. ------------------------------------
  const fromConnection = v => v && (v.phoneNumberId || v.phone_number_id || v.phoneNumber?.id || v.phoneNumbers?.[0]?.id || v.phoneNumbers?.[0]?.phoneNumberId);
  let waPhone = String(WA_PHONE || fromConnection(wa.json) || "").trim();
  if (!waPhone) {
    const planned = new Set(CFG.plan.flatMap(p => [p.name, ...(p.aka || [])]));
    const others = existing.filter(r => r.type !== "directory" && !planned.has(String(r.name).trim())).slice(0, 40);
    for (const r of others) {
      const w = await api("GET", `/workflow/${LOC}/${r._id}`);
      const step = (w.json?.workflowData?.templates || []).find(s => s.type === "whatsapp_v2" && s.attributes?.from_phone_number);
      if (step) { waPhone = String(step.attributes.from_phone_number); break; }
    }
  }
  result.whatsapp.fromPhoneNumber = waPhone ? "found" : "missing";
  if (!waPhone)
    return stop("WhatsApp is connected, but this script could not find the id of the number it sends from. Open Settings, then WhatsApp, copy the phone number ID, put it between the quotes of WA_PHONE at the top of this file, and run it again. Nothing was changed.");

  // 3. The templates: create the missing ones, never edit one. --------------
  const listT = async () => {
    const r = await api("GET", `/phone-system/whatsapp/location/${LOC}/template`);
    return Array.isArray(r.json) ? r.json : Array.isArray(r.json?.templates) ? r.json.templates : [];
  };
  let templates = await listT();
  const tByName = () => new Map(templates.map(t => [String(t.name), t]));
  const wanted = [...new Map(CFG.plan.map(p => [p.whatsapp.template, p.whatsapp])).values()];
  for (const w of wanted) {
    const have = tByName().get(w.template);
    if (have) { result.templates.push({ name: w.template, id: have.id, status: have.status, action: "exists" }); continue; }
    const body = {
      cta_url_link_tracking_opted_out: true,
      name: w.template,
      language: "en",
      category: "UTILITY",
      components: [{ type: "BODY", text: w.text, customVariables: w.variables, example: { body_text: [w.examples] } }],
    };
    const r = await api("POST", `/phone-system/whatsapp/location/${LOC}/template`, body);
    result.templates.push({
      name: w.template,
      id: r.json?.id,
      status: r.json?.status,
      action: r.status < 300 ? "created" : "FAILED",
      error: r.status >= 300 ? `${r.status} ${JSON.stringify(r.json).slice(0, 300)}` : undefined,
    });
    await new Promise(res => setTimeout(res, 400));
  }
  templates = await listT();
  const approved = new Map(templates.filter(t => t.status === "APPROVED").map(t => [String(t.name), t]));

  // 4. The workflows. ------------------------------------------------------
  const folders = [...new Set(CFG.plan.map(p => p.folder))];
  const folderId = {};
  for (const f of folders) {
    const name = `Hiring, ${f}`;
    const found = existing.find(r => r.type === "directory" && String(r.name).trim() === name);
    if (found) { folderId[f] = found._id; continue; }
    const made = await api("POST", `/workflow/${LOC}`, { name, type: "directory" });
    folderId[f] = made.json?._id || made.json?.id || null;
    console.log(made.status < 300 ? `  folder: ${name}` : `  folder FAILED: ${name} ${made.status}`);
  }

  for (const p of CFG.plan) {
    try {
      let row = byName.get(p.name);
      // A workflow built under an older name (a renamed stage, "One to one")
      // is renamed in place, so nothing is built twice and its trigger stays.
      if (!row) for (const a of p.aka || []) { const was = byName.get(a); if (was) { row = was; break; } }
      if (!row) {
        const made = await api("POST", `/workflow/${LOC}`, { name: p.name, type: "workflow", parentId: folderId[p.folder] || undefined });
        if (made.status >= 300) throw new Error(`create ${made.status} ${JSON.stringify(made.json).slice(0, 160)}`);
        row = { _id: made.json?._id || made.json?.id, name: p.name };
      }
      const id = row._id;

      // Email, then SMS, then WhatsApp once its template is approved.
      const tpl = approved.get(p.whatsapp.template);
      const emailId = uuid(), smsId = uuid(), waId = uuid();
      const steps = [
        { id: emailId, order: 0, name: "Email", type: "email", next: smsId,
          attributes: { subject: p.subject, from_email: CFG.fromEmail, from_name: CFG.fromName, html: p.html, attachments: [] } },
        { id: smsId, order: 1, name: "SMS", type: "sms", parentKey: emailId, ...(tpl ? { next: waId } : {}),
          attributes: { body: p.sms, attachments: [] } },
      ];
      if (tpl) {
        const message = p.whatsapp.variables.reduce((m, v, i) => m.split(`{{${i + 1}}}`).join(v), p.whatsapp.text);
        steps.push({
          id: waId, order: 2, name: "WhatsApp", type: "whatsapp_v2", parentKey: smsId, workflowsActionType: "INTERNAL",
          attributes: {
            template_id: tpl.id, toggle_branch: false, from_phone_number: waPhone, message,
            ...Object.fromEntries(p.whatsapp.variables.map(v => [v, v])),
            type: "whatsapp_v2", __customInputs__: {}, cat: "", convertToMultipath: false, transitions: [],
            __name__: `WhatsApp backup · ${p.whatsapp.template}`,
          },
        });
      }

      const cur = await api("GET", `/workflow/${LOC}/${id}`);
      if (cur.status !== 200) throw new Error(`read ${cur.status}`);
      const statusBefore = cur.json?.status;
      // Keep the status it already has. Forcing "draft" would unpublish one
      // you published; this script never publishes either.
      const keepStatus = statusBefore === "published" ? "published" : "draft";
      const put = await api("PUT", `/workflow/${LOC}/${id}`, {
        version: cur.json?.version, name: p.name, status: keepStatus,
        allowMultiple: false, workflowData: { templates: steps },
      });
      if (put.status >= 300) throw new Error(`steps ${put.status} ${JSON.stringify(put.json).slice(0, 160)}`);

      // One trigger: this card reached this stage on this board, matched on
      // what it points at, never on its name (third run, 2026-09-22).
      const trigName = `Moved to ${p.stageName}`;
      const trigs = await api("GET", `/workflow/${LOC}/trigger?workflowId=${id}`);
      const aimedHere = t => {
        const c = t.conditions || [];
        const at = f => (c.find(x => x.field === f) || {}).value;
        return at("opportunity.pipelineId") === p.pipelineId && at("opportunity.pipelineStageId") === p.stageId;
      };
      const mine = (trigs.json || []).filter(aimedHere);
      let removed = 0;
      for (const extra of mine.slice(1)) {
        const del = await api("DELETE", `/workflow/${LOC}/trigger/${extra.id || extra._id}`);
        if (del.status < 300) removed += 1;
      }
      const keep = mine[0];
      if (keep && String(keep.name).trim() !== trigName) {
        await api("DELETE", `/workflow/${LOC}/trigger/${keep.id || keep._id}`);
        removed += 1;
      }
      if (!keep || String(keep.name).trim() !== trigName) {
        const t = await api("POST", `/workflow/${LOC}/trigger`, {
          type: "pipeline_stage_updated", name: trigName, active: true,
          workflowId: id, workflow_id: id, location_id: LOC,
          masterType: "highlevel", belongs_to: "workflow", schedule_config: {},
          conditions: [
            { operator: "==", field: "opportunity.pipelineId", value: p.pipelineId, title: "In pipeline", type: "select" },
            { operator: "==", field: "opportunity.pipelineStageId", value: p.stageId, title: "Pipeline stage", type: "select" },
          ],
          actions: [{ workflow_id: id, type: "add_to_workflow" }],
        });
        if (t.status >= 300) throw new Error(`trigger ${t.status} ${JSON.stringify(t.json).slice(0, 160)}`);
      }

      // Read it back rather than trusting the write.
      const back = await api("GET", `/workflow/${LOC}/${id}`);
      const saved = back.json?.workflowData?.templates || [];
      const ids = new Set(saved.map(s => s.id));
      const chainOk = saved.every(s => (!s.next || ids.has(s.next)) && (!s.parentKey || ids.has(s.parentKey)));
      const backTrigs = await api("GET", `/workflow/${LOC}/trigger?workflowId=${id}`);
      const nTrigs = (backTrigs.json || []).length;
      const entry = {
        name: p.name, id, steps: saved.length, expected: steps.length, whatsapp: tpl ? "added" : `waiting for template (${tByName().get(p.whatsapp.template)?.status || "missing"})`,
        chainOk, triggers: nTrigs, statusBefore, statusAfter: back.json?.status, staleTriggersRemoved: removed,
      };
      if (entry.statusAfter !== statusBefore) entry.warning = `status changed from ${statusBefore} to ${entry.statusAfter}`;
      result.built.push(entry);
      console.log(`  ${p.name}  steps ${saved.length}/${steps.length}  WhatsApp ${entry.whatsapp}  triggers ${nTrigs}  ${back.json?.status}`);
    } catch (e) {
      result.failed.push({ name: p.name, error: scrub(e.message || e) });
      console.warn(`  FAILED ${p.name}: ${scrub(e.message || e)}`);
    }
  }

  finish();
  const ok = result.built.filter(b => b.steps === b.expected && b.chainOk && b.triggers >= 1).length;
  const withWa = result.built.filter(b => b.whatsapp === "added").length;
  const live = result.built.filter(b => b.statusAfter === "published").length;
  const moved = result.built.filter(b => b.warning);
  const pending = result.templates.filter(t => t.status && t.status !== "APPROVED").length;
  if (moved.length) console.warn("STATUS CHANGED, tell Claude:", moved.map(b => `${b.name}: ${b.warning}`));
  console.log(
    `DONE. ${ok} of ${CFG.plan.length} workflows have their steps and a trigger; ${withWa} send WhatsApp after the SMS; ${pending} templates are waiting on Meta (run this again once they are approved); ${result.failed.length} failed. ${live} were already published and stayed published; the rest are drafts. Nothing was published by this script. hiring-phase-b-v4-result.json has downloaded.`,
  );
  return result;
})();
