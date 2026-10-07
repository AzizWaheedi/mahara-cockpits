# WhatsApp groups from the setter's personal WhatsApp: research (checked 2026-10-03)

VERIFIED means I opened the cited page and read the text. UNVERIFIED means the claim comes from a search snippet or a third-party page, or it is my own inference. Nothing was sent or written anywhere. The only page action was one pricing toggle on Periskope's public pricing page.

## 1. What WhatsApp allows (personal app and the WhatsApp Business app)

**Group size and creation**
- A group can have up to 1024 members. A group name can be up to 100 characters. Members can be added when the group is made, or later. https://faq.whatsapp.com/3242937609289432 VERIFIED
- An admin can add a person who is not a saved contact by typing their phone number. https://faq.whatsapp.com/841426356990637 VERIFIED
- After adding too many members, a user "might need to wait 24 hours to add more members to groups and create additional groups". The page gives no number. Same page. VERIFIED
- Disappearing messages can be turned on when the group is made, or later. The choices are 24 hours, 7 days or 90 days. Any member can change this unless an admin limits it to admins. https://faq.whatsapp.com/515705483748188 VERIFIED

**Admins and settings**
- Admins choose whether only admins or all members can do each of these: edit group info, send messages, add people, and share invite links.
- "Send new messages" switched off means only admins can send. This is the announcement-only mode.
- "Approve new members" makes admins approve every joiner. It is off by default.
- If the only admin leaves, another member is chosen at random to be the new admin.

Sources: https://faq.whatsapp.com/526742385997912 and https://faq.whatsapp.com/1110600769849613 VERIFIED

**Invite links (chat.whatsapp.com) and QR codes**
- Admins can always create an invite link or QR code. In groups with fewer than 33 members, regular members can too, by default.
- Anyone who has the link can join and can forward it.
- Resetting the link kills the old one for good.
- Admins can see pending invites under "Manage invites".

Source: https://faq.whatsapp.com/3242937609289432 VERIFIED

**When a privacy setting blocks a direct add**
- Each user's group privacy setting is Everyone by default. The other choices are My Contacts and My Contacts Except.
- If the setting blocks the add, the admin gets a pop-up and is offered "Invite to Group". This sends a private group invite in the one-to-one chat. The person has 3 days to accept.

Sources: https://faq.whatsapp.com/1131457590844955 and https://blog.whatsapp.com/new-privacy-settings-for-groups VERIFIED
- Privacy settings never block an invite link. "Joining a group through an invite link is always your choice." https://faq.whatsapp.com/1131457590844955 VERIFIED

**What the lead sees when added by a stranger**
- If the person who adds them is not in their contacts, WhatsApp shows information about the group with "Stay" and "Exit group". After exiting, they can tap "Report to WhatsApp". https://faq.whatsapp.com/424124173736394 VERIFIED

**Removing people, leaving and deleting**
- An admin can delete a group for everyone only after removing every member.
- Deleting does not erase the group on other members' phones. They keep the history, but no one can send messages.
- Removed members show in "Past members", with name and phone number, for up to 60 days.
- A deleted group cannot be restored.

Source: https://faq.whatsapp.com/498814665492149 VERIFIED

**Deep links**
- `https://wa.me/<number>?text=<urlencoded>` opens a one-to-one chat with prefilled text.
- `https://wa.me/?text=...` opens a contact picker with the text prefilled.

Source: https://faq.whatsapp.com/5913398998672934 VERIFIED

- No documented link creates a group or adds members. The only group link is the chat.whatsapp.com invite. This is a negative finding: UNVERIFIED.

**Linked devices**
- A personal account can link up to 4 devices.
- Linked devices work while the phone is offline, but they log out if the phone is unused for over 14 days.
- Inactive linked devices are disconnected after 30 days.
- WhatsApp's warning: "Linking your account to an unofficial app or website, now or in the past, may result in a temporary or permanent account ban."

Source: https://faq.whatsapp.com/378279804439436 VERIFIED

- A linked-device automation service would take one of the 4 slots. This is my inference: UNVERIFIED.

**Usernames**
- Usernames are "rolling out gradually over the next few months". Once a username is active, the phone number is "kept private from anyone who doesn't already have it saved". https://faq.whatsapp.com/1619613329095035 VERIFIED
- Whether this hides phone numbers inside groups, and when it reaches Gulf users: UNVERIFIED.

**Possible new message cap**
- WhatsApp said it would test a monthly cap on messages that get no reply, for people and businesses. The limit is undisclosed. https://techcrunch.com/2025/10/17/whatsapp-will-curb-the-number-of-messages-people-and-businesses-can-send-without-a-response UNVERIFIED (press report; whether it applies in the Gulf now is unknown)

## 2. Linked-device services (all drive a number through WhatsApp's multi-device linking)

### Whapi.Cloud
- **Linking:** "A channel is a single WhatsApp account connected to Whapi.Cloud via a linked-device session." https://whapi.cloud/price VERIFIED
- **Price:** $35 a month per number, or $29 a month if paid yearly. There are no per-message fees. A free sandbox allows 150 messages a day and 5 conversations a month. There is a 5-day trial. Same page (FAQ data). VERIFIED
- **Group calls:**
  - Create: `POST https://gate.whapi.cloud/groups` with `subject` and `participants`.
  - Add: `POST /groups/{GroupID}/participants`.
  - Invite link: `GET /groups/{GroupID}/invite`.
  - Promote admin: `PATCH /groups/{GroupID}/admins`.

  https://whapi.cloud/how-to-automate-whatsapp-groups-api VERIFIED
- **Admins-only messages:** `PATCH /groups/{GroupID}` with `{"setting":"send_messages","policy":"admins"}`. The same call also covers `add_participants` and `edit_group_info`. https://support.whapi.cloud/help-desk/groups/groups-other-questions/admin-only-mode-and-other-group-permissions-how-to-check-and-change-them.md VERIFIED
- **Failed adds and private invites:**
  - A failed add comes back in a `failed` array.
  - `sendgroupinvite` sends the private invite to people who cannot be added directly.
  - Whapi says saving the number as a contact helps. Whapi also says that "does not guarantee" the add will work.

  https://support.whapi.cloud/help-desk/groups/add-new-member-to-group.md and https://support.whapi.cloud/help-desk/faq/why-arent-participants-being-added-to-the-group VERIFIED
- **Delete:** remove the participants, leave the group, then delete the chat. There is no true delete for everyone. https://support.whapi.cloud/help-desk/groups/how-to-delete-a-group.md VERIFIED
- **Join webhook:** event `groups` / `put`, with action `add`, `remove`, `promote`, `demote` or `request`. `"performed_by": "link"` marks a join through the invite link. https://support.whapi.cloud/help-desk/receiving/webhooks/incoming-webhooks-format/groups VERIFIED
- **Data:**
  - The terms are governed by Romanian law.
  - "Provider does not persistently store your message content." Metadata is kept for 24 hours at most.
  - Terms updated 2026-05-14.
  - No server location is stated.

  https://whapi.cloud/terms VERIFIED
- **Ban statement:** "Users understand and agree that their accounts and/or phone numbers could be blocked or banned by WhatsApp's automatic anti-spam system at any time. Whapi.Cloud is not responsible for such blocking or banning." Same page, section 8.5. VERIFIED

### Green-API
- **Price:** Developer is $0 and limited to 3 chats. Business is $12 a month per instance. Chatbot is $24 a month. https://green-api.com/en (pricing section) VERIFIED
- **Group calls:** create group, update name, get group data, update settings, add participant, remove participant, set admin, remove admin, set picture, leave group. https://green-api.com/en/docs/api/groups/ VERIFIED
- **createGroup:**
  - It returns `groupInviteLink`.
  - The docs say to create "no more often than 1 group every 5 minutes".

  https://green-api.com/en/docs/api/groups/CreateGroup/ VERIFIED
- **Invite link from GetGroupData:** the link is empty if the account is not an admin. It may also be empty "when making requests frequently". https://green-api.com/en/docs/api/groups/GetGroupData/ VERIFIED
- **Admins-only messages:** `updateGroupSettings` with `allowParticipantsSendMessages`. This call is marked beta and takes effect "within 5 minutes". https://green-api.com/en/docs/api/groups/UpdateGroupSettings/ VERIFIED
- **addGroupParticipant:** returns `false` when the account is not an admin, the number is not in the phonebook, or the person is already a member. https://green-api.com/en/docs/api/groups/AddGroupParticipant/ VERIFIED
- **Join webhook:** none documented. Only "Group invitation incoming message" is listed. https://green-api.com/en/docs/api/receiving/notifications-format/ VERIFIED that it is not listed. That no join event exists at all: UNVERIFIED.
- **Data:** servers in Russia, Germany, Brazil and India. The customer picks the country. https://green-api.com/en/blog/2025/servers-all-over-the-world-for-stable-operation-of-green-api/ VERIFIED
- **Ban guidance:**
  - "The decision to block an account is made by WhatsApp, it does not depend on our service."
  - At most 200 customers a day.
  - 15 seconds between messages.
  - Message only contacts who saved your number.

  https://green-api.com/en/docs/faq/how-to-protect-number-from-ban/ VERIFIED

### Wassenger
- **Pricing and connection type:** the current pricing page sells official Business API plans only. Professional is €39.90 a month, Business €69.90, Enterprise €99.90. "Verified business number required." https://wassenger.com/pricing VERIFIED
- **QR connector vs official API:** its help page still describes a QR connector.
  - The QR connector covers personal or Business app numbers, has Groups "Yes", and is flagged "Number ban risk".
  - The official API has Groups "No".
  - Data residency for the QR connector is "Worker infrastructure".

  https://app.wassenger.com/help/comparison VERIFIED
- **Whether new customers can still buy the QR connector:** UNVERIFIED.
- **Migration page:** says the official API "eliminates the risk of bans and disconnections that can occur with unofficial methods". After migrating, group management works only in the mobile app. https://app.wassenger.com/help/migration VERIFIED
- **Group calls (QR connector):**
  - Create: POST `/v1/devices/{id}/groups`.
  - Add, remove, promote and demote participants.
  - Get or revoke the invite.
  - Leave the group.
  - Permissions `send: admins`.

  https://wassenger.com/blog/en/manage-whatsapp-groups-with-the-api-the-definitive-guide VERIFIED
- **Join webhook:** `group:update` with actions `add`, `remove`, `announce`, `invite` and others. Participant events reach you only when your number is an admin. https://wassenger.com/blog/en/how-to-integrate-webhooks-for-whatsapp-groups VERIFIED

### Periskope
- **Price:** Starter is $25 per user per month, and the first connected phone is free. Pro is $35. The company is Hashlabs Holdings Inc. https://periskope.app/pricing VERIFIED. Whether $25 is the yearly or the monthly rate: UNVERIFIED (the toggle did not change the price shown).
- **Linking:** a phone connects by scanning a QR code. https://docs.periskope.app/llms.txt (Phone object, Get QR) VERIFIED
- **Create group:** `POST https://api.periskope.app/v1/chats/create`.
  - It returns `invite_link`.
  - Options are `messagesAdminsOnly`, `addMembersAdminsOnly` and `infoAdminsOnly`.
  - "Participants whose privacy settings disallow direct adds receive an invite instead."
  - It claims a person is added directly only when their privacy allows it "and they are in your phone contacts". This is a vendor claim. WhatsApp's own page says the default is Everyone.

  https://docs.periskope.app/api-reference/chat/create-group.md VERIFIED
- **Other group calls:**
  - Add (with invite fallback), remove, promote and demote.
  - Refresh the invite link.
  - Update settings, including `ephemeral` and `joinApprovalAdminsOnly`.
  - Leave the group.

  https://docs.periskope.app/llms.txt VERIFIED
- **Join webhook:** `chat.notification.created` fires when "a member is added or removed". Same index. VERIFIED
- **Data:**
  - It claims GDPR compliance and ISO 27001.
  - Data is encrypted at rest. Backups are kept 7 days.
  - No region is stated.

  https://periskope.app/security VERIFIED
- **Storing chats:** it syncs and stores chats, because it is an inbox. This is my inference from its API objects: UNVERIFIED.
- **Ban guidance:**
  - "account status remains under WhatsApp's control".
  - "Just 3-5 reports in a short window can trigger enforcement."
  - Space out group creation.
  - Add at most 15 to 20 contacts per group or per day.
  - Joins through an invite link improve the number's score.
  - It also calls itself a "verified platform". WhatsApp publishes no such list.

  https://docs.periskope.app/get-started/best-practices.md VERIFIED

### Maytapi
- **Price:** Developer is $24 a month per phone, with unlimited messages and "Unlimited API Access (Groups...)". There is a free sandbox and a 3-day trial. https://maytapi.com/whatsapp-api-pricing VERIFIED
- **Ban statement:** "being tagged as spam a few times (5 - 10) will get you banned". Same page. VERIFIED
- **Group calls:** `/{phone_id}/createGroup`, `/group/config`, `/group/add`, `/group/remove`, `/group/promote`, `/group/demote`, `/group/revokeInvite`, join-request approve and reject, and `/leaveGroup`. https://maytapi.com/whatsapp-api-documentation VERIFIED
- **Not documented:** a call to fetch the invite link, and a webhook for joins. UNVERIFIED.
- **Data location:** not stated. UNVERIFIED.

### Evolution API (self-hosted)
- **Licence and type:** Apache 2.0 with brand-protection conditions. It has a Baileys (WhatsApp Web) mode and an official Cloud API mode. The README notes the WhatsApp Web mode "may have limitations compared to official APIs". https://github.com/EvolutionAPI/evolution-api (README) VERIFIED
- **Group routes:**
  - create, updateParticipant (add, remove, promote, demote).
  - inviteCode, revokeInviteCode, sendInvite.
  - updateSetting (announcement, not_announcement, locked, unlocked).
  - toggleEphemeral (0, 86400, 604800 or 7776000 seconds).
  - leaveGroup.

  https://raw.githubusercontent.com/EvolutionAPI/evolution-api/main/src/api/routes/group.router.ts and .../src/api/dto/group.dto.ts VERIFIED
- **Join webhook:** `WEBHOOK_EVENTS_GROUP_PARTICIPANTS_UPDATE`. https://raw.githubusercontent.com/EvolutionAPI/evolution-api/main/.env.example VERIFIED
- **Cost and data:** it is free. Data stays on whatever server Mahara runs it on, for example the VPS.

### Baileys (library)
- **Linking:** QR code or pairing code. https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/README.md VERIFIED
- **Group calls:** `groupCreate`, `groupParticipantsUpdate` (add, remove, promote, demote), `groupSettingUpdate('announcement')`, `groupInviteCode`, `groupRevokeInvite`, `groupToggleEphemeral` and `groupLeave`. Join event: `group-participants.update`. Same README. VERIFIED
- **Disclaimer:** "not affiliated, associated, authorized, endorsed by ... WhatsApp". "We discourage any stalkerware, bulk or automated messaging usage." The licence is MIT. Same README. VERIFIED

## 3. Terms and enforcement

### What WhatsApp says (all VERIFIED)
- **Terms of Service, Legal and acceptable use.** You will not use the Services in ways that "(e) involve sending illegal or impermissible communications such as bulk messaging, auto-messaging, auto-dialing, and the like; or (f) involve any non-personal use of our Services unless otherwise authorized by us." https://www.whatsapp.com/legal/terms-of-service
- **Terms of Service, Harm To WhatsApp Or Our Users.** "You must not (or assist others to) directly, indirectly, through automated or other means, access, use ... or otherwise exploit our Services in impermissible or unauthorized manners." Item (e): "create accounts for our Services through unauthorized or automated means". Item (h) bars making the Services available "over a network where they could be used by multiple devices at the same time, except as authorized through tools we have expressly provided". Same page.
- **WhatsApp Business App Terms (effective 2026-09-23).**
  - "(g) develop or use any applications that interact with our Business App Services without our prior written consent".
  - The Company "must also secure all necessary rights, consents, and permissions (for example, opt-in) ... to communicate with its customers".
  - WhatsApp may "limit, throttle, suspend, or terminate" the account.

  https://www.whatsapp.com/legal/WhatsApp-Terms-for-WhatsApp-Business-App
- **About unofficial apps.** "Using these apps or linking your WhatsApp account to unofficial versions of WhatsApp violates our Terms of Service." The account "might also be temporarily or permanently banned, or it could lead to restrictions on your account, including the ability to link devices." https://faq.whatsapp.com/1217634902127718
- **About account bans for unofficial apps.** "Using an unauthorized application and/or unsupported device violates our Terms of Service and can result in your account being banned." https://faq.whatsapp.com/1064395290901991
- **How to use WhatsApp responsibly.**
  - "Don't bulk message, auto-message, or auto-dial ... WhatsApp uses both machine learning technology and reports from users to detect and ban accounts".
  - "don't create accounts or groups in unauthorized or automated ways".
  - "You should get permission from contacts before you add them to a group."
  - "Only send messages to those who have contacted you first or have requested you contact them."

  https://faq.whatsapp.com/361005896189245
- **Unauthorized use of automated or bulk messaging.** "Our products are not intended for bulk or automated messaging." WhatsApp says it takes legal action against "automated or bulk messaging, or non-personal use", including on off-platform evidence, since 2019-12-07. https://faq.whatsapp.com/5957850900902049

### What lowers ban risk: vendor claims only, not WhatsApp's
- **Whapi:**
  - At most 2 messages a minute, 6 hours a day, 3 days in a row.
  - "Mass group creation appears suspicious".
  - Wait a day or more after registering a number before scanning the QR code.
  - Promote a backup admin.

  https://support.whapi.cloud/help-desk/blocking/how-to-not-get-banned and https://whapi.cloud/how-to-automate-whatsapp-groups-api VERIFIED as their claims
- **Green-API:** at most 1 group every 5 minutes, and see the guidance in the Green-API section above. VERIFIED as their claims
- **Periskope:** invite-link joins help, 3 to 5 reports can trigger enforcement, and space adds 2 to 4 hours apart. VERIFIED as their claims
- **Overall:** no vendor can prevent or reverse a ban (Whapi terms section 8.5; Green-API FAQ). Even WhatsApp's own advice does not make an unofficial link compliant: WhatsApp says the link itself violates its terms.

## 4. WhatsApp Business app (free) on a phone
- The app is free and "intended to feel and work just like WhatsApp Messenger", so groups work the same way. The same number cannot run in WhatsApp Messenger and the Business app at the same time. https://faq.whatsapp.com/641572844337957 VERIFIED
- Two apps with two different numbers on one phone: UNVERIFIED.
- **Linked devices:** 4 linked devices plus the phone. The phone can be offline, with the same 14-day logout. Broadcast lists do not work on linked devices. https://faq.whatsapp.com/647349420360876 VERIFIED
- **Multi-agent:** up to 10 devices and chat assignment, only with a Meta Verified or Meta One subscription. https://faq.whatsapp.com/395911122612120 VERIFIED
- **Quick replies:** up to 50 stored, with media allowed. Type "/" in a chat to use them. https://faq.whatsapp.com/1791149784551042 VERIFIED
- **Labels:** labels are now lists. Up to 20 labels. A broadcast made from a label "can't be sent to groups". https://faq.whatsapp.com/3398508707096369 VERIFIED
- **Catalog:** a catalog of products or services shows on the business profile. https://faq.whatsapp.com/405903568419894 VERIFIED
- **Other features:** greeting and away messages. https://whatsappbusiness.com/products/business-app-features/ VERIFIED

## Comparison of services

| | Whapi.Cloud | Green-API | Wassenger | Periskope | Maytapi | Evolution API / Baileys |
|---|---|---|---|---|---|---|
| How it links | Linked-device session (QR) | QR instance | QR connector (sales page now sells official API only) | QR | QR | QR or pairing code, self-hosted |
| Create group | Yes | Yes (1 per 5 min) | Yes (QR only) | Yes | Yes | Yes |
| Add directly | Yes, failures listed | Yes, `false` if not allowed | Yes | Yes, falls back to an invite | Yes | Yes |
| Private invite when blocked | `sendgroupinvite` | Not documented | UNVERIFIED | Automatic | UNVERIFIED | `sendInvite` (Evolution) |
| Fetch invite link | Yes | Yes (admin, may be empty) | Yes | Yes, plus refresh | Revoke only documented | Yes |
| Post messages | Yes | Yes | Yes | Yes | Yes | Yes |
| Remove participants | Yes | Yes | Yes | Yes | Yes | Yes |
| Admins-only messages | Yes | Yes (beta) | Yes | Yes | `group/config` (details UNVERIFIED) | Yes |
| Leave / delete | Remove all, leave, delete chat | Leave | Leave | Leave | Leave | Leave (no true delete anywhere) |
| Join webhook | Yes, `performed_by: link` | Not documented | Yes, admin only | Yes | UNVERIFIED | Yes |
| Price a month | $35, or $29 yearly | $12 | €39.90+ (official API plans) | $25/user, first phone free | $24 | Free, plus VPS |
| Data location | Not stated; Romanian law; no message storage claimed | RU, DE, BR or IN (customer picks) | "Worker infrastructure" | Not stated; ISO 27001 claim | Not stated | Mahara's own server |
| Ban statement | Not liable for bans | "made by WhatsApp" | QR has "Number ban risk" | "under WhatsApp's control" | 5 to 10 spam tags means a ban | Not affiliated; discourages automation |

## What this means for the plan

1. **WhatsApp itself offers no automation for a personal or Business app number.** No link or official tool creates a group or adds people. Any "automatic" group on the setter's number needs an unofficial linked device. WhatsApp's own pages say that violates its terms and "may result in a temporary or permanent account ban". They also say "don't create ... groups in unauthorized or automated ways". The Business App Terms bar third-party apps without written consent. The ban would hit the setter's own personal number.

2. **A linked device sees every chat on the account.** A service linked to the setter's personal number receives their family and personal chats too. With Periskope, Whapi or Green-API, those chats pass through the vendor. With Evolution API on the VPS, Mahara would hold them. That needs the setter's informed, written consent, and the CEO should decide it explicitly. Filtering to work chats would happen only in our code. This is my inference from how linked devices work: UNVERIFIED.

3. **Recommended first release: a cockpit-guided group, made by the setter in the official app.** WhatsApp Web or Desktop, as official linked devices, also count. At about 60 demos a month this is roughly 1 to 2 minutes per demo.
   - On the call, the setter asks the lead's permission to add them to a group with the closer, as WhatsApp's best practice asks. The cockpit records this as `setter_asked`.
   - A "Make the WhatsApp group" card shows a copyable name, for example "{Company} and Mahara Media" (100 characters at most), and the welcome text. The setter creates the group, adds the closer and the lead, turns on "Approve new members", and turns off members' invite links. If the lead's privacy blocks the add, WhatsApp itself offers the private invite, which lasts 3 days.
   - The setter taps "Group made" and "The lead is in". These taps are the only record: nothing reaches HighLevel or the cockpit by itself.
   - At close (2 days after the demo, or when the deal is won or lost), the cockpit reminds the setter. The setter posts the closing line, removes the lead and the closer, and exits and deletes. The lead keeps a read-only copy, and the setter's number stays in "Past members" for 60 days.

4. **If the CEO wants the group fully automatic, pilot it under these limits:**
   - **Number:** use a separate work number in the WhatsApp Business app on the setter's phone, not the personal number. Two apps on one phone is UNVERIFIED.
   - **Vendor:** pick one. Whapi is the cheapest full set: private-invite call, link-join webhook, no-storage claim. Periskope builds in the invite fallback and stores chats. Evolution API keeps the data on the VPS.
   - **Volume:** at most about 3 groups a day, at least 5 minutes apart, and only leads who agreed on the call.
   - **Admins:** make the closer a second admin.
   - **Health:** a health line for disconnects, with a plain sentence when the link drops. Missing is never zero.
   - **Fallback:** keep route C (one chat on the official line) for when the link is down or the lead declines.
   - **Avoid** Wassenger (its sales page now sells only the official API, which has no groups) and Green-API if join signals matter.

5. **Exposure:**
   - The lead sees the setter's and the closer's phone numbers.
   - A lead who has not saved the setter's number gets a "Stay / Exit group" screen with a report option. Reports are the main ban trigger, by vendor claims.
   - Sending a one-to-one message first, or using the invite link, lowers that risk. The invite link is the lead's own choice.
   - Usernames may hide numbers later. Whether they do inside groups is UNVERIFIED.

6. **Terms point for the CEO.** WhatsApp Messenger's terms forbid "non-personal use" unless authorized. The authorized tool for business is the WhatsApp Business app. If the setter's personal number is used for leads, moving it to the free Business app is the cleaner reading, and it adds quick replies and lists. The same number cannot run in both apps.

7. **Changes to the spec (r5.md):**
   - Route "group" becomes "setter_phone".
   - Thread rows hold `group_made_at`, `lead_joined_at` and `closed_at`, from the setter's taps or, in a pilot, a webhook.
   - Store no invite link unless a pilot needs it.
   - The demo-chat test still compares by assignment.
   - Group messages are invisible to HighLevel, so the "reply within 15 minutes" metric cannot be measured for groups without a linked service.

Out of scope here: the closer's Zoom licence. The context file says the closer's Mahara Zoom user is Basic today.