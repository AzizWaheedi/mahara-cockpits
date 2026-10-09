// Outputs recorded from the paused media Convex code on 2026-10-09 by running
// the original pure functions (convex/writeback.ts kpiBand, money,
// decisionComment; convex/changeLog.ts; convex/dosDonts.ts cleanDosDonts;
// convex/tracking.ts weekKey; convex/sync.ts daysAgo with the 7-day sum loop).
// The parity tests compare the native ports against these values. Regenerate
// only from the Convex sources, never from the native code.
// deno-fmt-ignore-file
export const GOLDEN = {
 "kpiBandCpl": [
  [
   0,
   "Above KPI"
  ],
  [
   11.25,
   "Above KPI"
  ],
  [
   11.26,
   "At KPI"
  ],
  [
   15,
   "At KPI"
  ],
  [
   15.01,
   "Below KPI"
  ],
  [
   22.5,
   "Below KPI"
  ],
  [
   22.51,
   "911"
  ],
  [
   100,
   "911"
  ]
 ],
 "kpiBandCpb": [
  [
   45,
   "Above KPI"
  ],
  [
   45.01,
   "At KPI"
  ],
  [
   60,
   "At KPI"
  ],
  [
   60.5,
   "Below KPI"
  ],
  [
   90,
   "Below KPI"
  ],
  [
   90.01,
   "911"
  ]
 ],
 "money": [
  [
   null,
   "—"
  ],
  [
   12.345,
   "$12.35"
  ],
  [
   0,
   "$0.00"
  ],
  [
   1234.5,
   "$1234.50"
  ]
 ],
 "decisionComment": [
  [
   {
    "action": "Told the client the CPL is down",
    "kind": "touch",
    "evidence": "CPL $9.10 on $300 spend"
   },
   "🎯 Cockpit · CLIENT UPDATED — Told the client the CPL is down\n\nWhy: CPL $9.10 on $300 spend\nSent by the media buyer via the Media Buyer Cockpit. Proactive touchpoint — the client has been told."
  ],
  [
   {
    "action": "Left the budget",
    "kind": "left",
    "evidence": "Still learning",
    "reason": "Wait 3 days",
    "snooze": "14 Oct"
   },
   "🎯 Cockpit · LEFT AS IS — Left the budget\n\nWhy: Still learning\nNote: Wait 3 days\nChecked again: 14 Oct\nLogged by: media buyer via the Media Buyer Cockpit. Checked again in 7 days."
  ],
  [
   {
    "action": "Landing page or tracking is broken",
    "kind": "rerouted",
    "evidence": "Form not firing",
    "reroutedTo": "tech"
   },
   "🎯 Cockpit · SENT TO TECH — Landing page or tracking is broken\n\nWhy: Form not firing\nLogged by: media buyer via the Media Buyer Cockpit. Checked again in 7 days."
  ],
  [
   {
    "action": "Need new creatives",
    "kind": "rerouted",
    "evidence": "Fatigue"
   },
   "🎯 Cockpit · SENT TO ANOTHER TEAM — Need new creatives\n\nWhy: Fatigue\nLogged by: media buyer via the Media Buyer Cockpit. Checked again in 7 days."
  ],
  [
   {
    "action": "Paused the worst ad",
    "kind": "decision",
    "evidence": "CPL $40",
    "byEmail": "nada@maharamedia.com"
   },
   "🎯 Cockpit · CHANGE MADE — Paused the worst ad\n\nWhy: CPL $40\nLogged by: nada@maharamedia.com via the Media Buyer Cockpit. Checked again in 7 days."
  ]
 ],
 "changeComment": [
  [
   {
    "by": "nada@maharamedia.com",
    "campaignName": "Castello Leads",
    "adName": "Video 3",
    "what": "Raised budget to $40",
    "at": 1791532800000
   },
   "🎯 Cockpit · CHANGE MADE — Raised budget to $40\n\nCastello Leads · Video 3\n\nMade by nada@maharamedia.com in the Media Buyer Cockpit on 9 Oct 2026. Three days before this is judged."
  ],
  [
   {
    "by": "cockpit",
    "campaignName": "Castello Leads",
    "what": "Turned off campaign \"Castello Leads\" from the cockpit",
    "at": 1791363600000
   },
   "🎯 Cockpit · CHANGE MADE — Turned off campaign \"Castello Leads\" from the cockpit\n\nCastello Leads\n\nMade by the media buyer in the Media Buyer Cockpit on 7 Oct 2026."
  ],
  [
   {
    "by": "Built from the cockpit",
    "campaignName": "Castello",
    "what": "Built a campaign",
    "at": 1791450001000
   },
   "🎯 Cockpit · CHANGE MADE — Built a campaign\n\nCastello\n\nMade by the media buyer in the Media Buyer Cockpit on 8 Oct 2026. Three days before this is judged."
  ],
  [
   {
    "by": "",
    "campaignName": "Arcturus",
    "what": "Changed copy",
    "at": 1791498600000
   },
   "🎯 Cockpit · CHANGE MADE — Changed copy\n\nArcturus\n\nMade by the media buyer in the Media Buyer Cockpit on 9 Oct 2026. Three days before this is judged."
  ]
 ],
 "isChange": [
  [
   "Asked Aziz: can we raise?",
   false
  ],
  [
   "Is this right?",
   false
  ],
  [
   "Paused ad",
   true
  ],
  [
   "",
   false
  ],
  [
   "   ",
   false
  ],
  [
   "Raised budget؟",
   false
  ],
  [
   "asked nobody",
   false
  ],
  [
   "Asked",
   false
  ]
 ],
 "cardFor": [
  [
   "Castello Leads",
   {
    "taskId": "t1",
    "ownCard": true,
    "campaign": {
     "campaignName": "Castello Leads",
     "clientName": "Castello Industries",
     "clientTag": "castello industries",
     "taskId": "t1",
     "spend7d": 100
    }
   }
  ],
  [
   "Castello Retarget",
   {
    "taskId": "t1",
    "ownCard": false,
    "campaign": {
     "campaignName": "Castello Retarget",
     "clientName": "Castello Industries",
     "clientTag": "castello industries",
     "spend7d": 300
    }
   }
  ],
  [
   "Castello Industries",
   {
    "taskId": "t1",
    "ownCard": false
   }
  ],
  [
   "castello-industries",
   {
    "taskId": "t1",
    "ownCard": false
   }
  ],
  [
   "Arcturus A",
   null
  ],
  [
   "Unknown",
   null
  ],
  [
   "Ardon",
   {
    "taskId": "t9",
    "ownCard": true,
    "campaign": {
     "campaignName": "Ardon",
     "clientName": "Ardon",
     "clientTag": "ardon",
     "taskId": "t9",
     "spend7d": 5
    }
   }
  ]
 ],
 "boardStatusAfter": [
  [
   null,
   null,
   null
  ],
  [
   null,
   "Live",
   null
  ],
  [
   null,
   "Paused",
   null
  ],
  [
   null,
   "Dead Campaign",
   null
  ],
  [
   null,
   "Lost Client",
   null
  ],
  [
   null,
   "Onboarding",
   null
  ],
  [
   "ACTIVE",
   null,
   "Live"
  ],
  [
   "ACTIVE",
   "Live",
   null
  ],
  [
   "ACTIVE",
   "Paused",
   "Live"
  ],
  [
   "ACTIVE",
   "Dead Campaign",
   "Live"
  ],
  [
   "ACTIVE",
   "Lost Client",
   "Live"
  ],
  [
   "ACTIVE",
   "Onboarding",
   "Live"
  ],
  [
   "PAUSED",
   null,
   "Paused"
  ],
  [
   "PAUSED",
   "Live",
   "Paused"
  ],
  [
   "PAUSED",
   "Paused",
   null
  ],
  [
   "PAUSED",
   "Dead Campaign",
   null
  ],
  [
   "PAUSED",
   "Lost Client",
   null
  ],
  [
   "PAUSED",
   "Onboarding",
   "Paused"
  ],
  [
   "ARCHIVED",
   null,
   null
  ],
  [
   "ARCHIVED",
   "Live",
   null
  ],
  [
   "ARCHIVED",
   "Paused",
   null
  ],
  [
   "ARCHIVED",
   "Dead Campaign",
   null
  ],
  [
   "ARCHIVED",
   "Lost Client",
   null
  ],
  [
   "ARCHIVED",
   "Onboarding",
   null
  ]
 ],
 "cleanDosDonts": [
  [
   "DO:\n- use testimonials\n- show prices\nDON'T:\n- use stock photos",
   {
    "text": "DO\n- Use testimonials\n- Show prices\n\nDON'T\n- Use stock photos",
    "notes": []
   }
  ],
  [
   "✅ show the team\n❌ mention competitors\nnever promise results\nNotes: client prefers Arabic\nnotes\n- call before 5pm",
   {
    "text": "DO\n- Show the team\n\nDON'T\n- Mention competitors\n- Never promise results",
    "notes": [
     "Client prefers Arabic",
     "Call before 5pm"
    ]
   }
  ],
  [
   "1. Use Arabic\n2) dont show faces\n* Avoid red\nDo's & Don'ts:\n**DO**\n- Bright colours",
   {
    "text": "DO\n- Use Arabic\n- Bright colours\n\nDON'T\n- Don't show faces\n- Avoid red",
    "notes": []
   }
  ],
  [
   "Do: everything. (see brief)\n\n\nDon't: “discounts”",
   {
    "text": "DO\n- Everything (see brief)\n\nDON'T\n- \"discounts\"",
    "notes": []
   }
  ],
  [
   "DO\n- A\n\nDON'T\n- B",
   {
    "text": "DO\n- A\n\nDON'T\n- B",
    "notes": []
   }
  ],
  [
   "",
   {
    "text": "",
    "notes": []
   }
  ],
  [
   "  \n  ",
   {
    "text": "",
    "notes": []
   }
  ],
  [
   "NOTES: only notes here",
   {
    "text": "",
    "notes": [
     "Only notes here"
    ]
   }
  ]
 ],
 "weekKey": [
  [
   "2026-01-01T00:00:00Z",
   "2026-W01"
  ],
  [
   "2026-10-09T10:00:00Z",
   "2026-W41"
  ],
  [
   "2026-12-31T22:00:00Z",
   "2027-W01"
  ],
  [
   "2026-03-01T20:59:00Z",
   "2026-W10"
  ],
  [
   "2026-03-01T21:00:00Z",
   "2026-W10"
  ]
 ],
 "cplWindow": [
  {
   "now": "2026-10-09T09:00:00Z",
   "since7": "2026-10-02",
   "spend": 67.5,
   "leads": 4,
   "cpl": 16.875
  },
  {
   "now": "2026-10-09T20:59:59Z",
   "since7": "2026-10-02",
   "spend": 67.5,
   "leads": 4,
   "cpl": 16.875
  },
  {
   "now": "2026-10-09T21:00:00Z",
   "since7": "2026-10-03",
   "spend": 47.5,
   "leads": 2,
   "cpl": 23.75
  }
 ]
} as const;
