# Day 7 — Reporting API contract (Dev A → Dev B)

**Status:** proposed by Dev A, 2026-09-12. Build against this; ping me on `GLOBAL.md` if anything is missing before I freeze it.

The point of writing this before either of us codes: the Management Dashboard and the Reports must never show different numbers for the same week. Dev B raised this on Day 6, and it is the one failure that surfaces in front of the client rather than in review.

---

## 1. The simplification worth knowing first

**Daily, Weekly and Monthly are not three reports.** They are one aggregation over three date scopes.

So this is **one screen with a scope selector**, not three screens. The only genuinely different shapes are:

| Report | Endpoint | Why it differs |
|---|---|---|
| Daily / Weekly / Monthly / 15-day / Custom | `GET /api/reports/performance` | Same shape, different `scope` |
| Lead Source | `GET /api/reports/sources` | Grouped by source, not by agent |
| Punctuality | `GET /api/reports/punctuality` | Attendance data, not call data |
| Raw data view / export | `GET /api/reports/raw` | Row-level, not aggregated |

---

## 2. Shared query parameters

Every endpoint accepts the same filter set. Unsupported filters are ignored rather than erroring, so you can send the whole filter object to any endpoint.

| Param | Values | Notes |
|---|---|---|
| `scope` | `today` `yesterday` `week` `last-week` `month` `last-month` `15d` `custom` | Defaults to `today` |
| `from`, `to` | ISO date `YYYY-MM-DD` | **Required when `scope=custom`**, ignored otherwise |
| `agentId` | user id | Optional |
| `source` | source label string | Optional |
| `disposition` | `NO_ANSWER` `CALL_BACK_LATER` `NOT_INTERESTED` `DO_NOT_CALL` `EMAIL` `QUALIFIED` | Optional |

`week` and `month` mean **calendar** week/month to date, not rolling 7/30 days. Rolling windows are what the dashboard uses; a report labelled "This month" that silently means "last 30 days" is the kind of thing a client notices at a board meeting.

---

## 3. Shared response envelope

Every endpoint returns the same wrapper, so you can render the header and the active-filter chips generically:

```jsonc
{
  "range": {
    "scope": "week",
    "from": "2026-09-07T00:00:00.000Z",
    "to":   "2026-09-12T23:59:59.999Z",
    "label": "This week (7–12 Sep)"     // ready to render, no formatting needed
  },
  "filters": { "agentId": null, "source": null, "disposition": null },
  "generatedAt": "2026-09-12T09:14:00.000Z",
  "data": { /* endpoint-specific, below */ }
}
```

`label` is server-rendered on purpose: if the report header and the query disagree about what "this week" means, the header is what the client screenshots.

---

## 4. `GET /api/reports/performance`

`data`:

```jsonc
{
  "totals": {
    "leadsAssigned":  120,   // assignments opened in range
    "leadsWorked":    84,    // last_disposition_at in range  ← the agreed definition
    "callsMade":      213,
    "talkTimeSec":    18430,
    "avgTalkSec":     104,   // over calls WITH a duration — see §7
    "callbacksSet":   31,
    "callbacksDone":  22,
    "qualified":      17,
    "conversionPct":  20.2   // qualified ÷ leadsWorked
  },
  "outcomes": { "NO_ANSWER": 96, "CALL_BACK_LATER": 31, "NOT_INTERESTED": 44,
                "DO_NOT_CALL": 8, "EMAIL": 17, "QUALIFIED": 17,
                "undispositioned": 0 },
  "byAgent": [ { "agentId": "...", "fullName": "...", "leadsWorked": 22,
                 "calls": 51, "talkTimeSec": 4200, "avgTalkSec": 96,
                 "qualified": 5, "conversionPct": 22.7,
                 "callbacksSet": 8, "callbacksDone": 6 } ],
  "byDay":   [ { "date": "2026-09-07", "calls": 41, "leadsWorked": 18, "qualified": 3 } ]
}
```

`byDay` is there so you can draw a trend line without a second request.

**No monitoring fields.** Active/idle/break/productivity are not in any reports payload — they belong to `monitoring.view` on your dashboard. If a report needs them, that is a separate decision and a separate permission check.

---

## 5. `GET /api/reports/sources`

```jsonc
{
  "sources": [
    { "source": "Q4 Trade Show", "imported": 50, "assigned": 44, "worked": 31,
      "contacted": 24, "qualified": 7, "doNotCall": 2,
      "conversionPct": 22.6, "workedPct": 62.0 }
  ],
  "totals": { /* same keys, summed */ }
}
```

Definitions, matching your Day 6 note:
- **worked** = has a `last_disposition_code`
- **contacted** = worked with an outcome other than `NO_ANSWER` — someone actually spoke to them
- **conversionPct** = qualified ÷ **worked**, never ÷ imported. A source with a big untouched backlog is unworked, not underperforming.

---

## 6. `GET /api/reports/punctuality`

```jsonc
{
  "shift": { "startTime": "09:00", "graceMinutes": 10, "timeZone": "UTC" },
  "rows": [
    { "agentId": "...", "fullName": "...", "date": "2026-09-11",
      "firstLoginAt": "...", "lateMinutes": 0, "onTime": true, "sessionCount": 2 }
  ],
  "summary": [
    { "agentId": "...", "fullName": "...", "daysPresent": 5, "daysLate": 1,
      "totalLateMinutes": 14, "onTimePct": 80.0 }
  ]
}
```

**⚠️ COORDINATION ITEM — please read before touching `src/app/api/hr/attendance/route.ts`.**

The lateness calculation currently lives **inline inside that route handler**, not in an exported function. If I write my own copy for this report, the HR attendance screen and the Punctuality report will drift the moment either is tweaked — the exact failure you flagged for "worked".

**Proposal:** I extract it to `src/server/reports/punctuality.ts` and switch your route to call it. Same output, one source of truth. It is a mechanical refactor, but it touches your file on a day you are also working — so if you would rather do it yourself, say so on `GLOBAL.md` and I will consume whatever you export instead.

No monitoring metrics here either: punctuality is first-login versus shift start, which is what MG-07 asks for.

---

## 7. `GET /api/reports/raw`

Row-level data for your export and raw-data view. Paginated.

```jsonc
{
  "rows": [
    { "callId": "...", "at": "...", "agent": "Agent One",
      "company": "Acme Corp", "contact": "John Smith", "phone": "+14155550132",
      "source": "Q4 Trade Show", "outcome": "No Answer", "outcomeCode": "NO_ANSWER",
      "durationSec": 42, "channel": "CLIPBOARD", "notes": "...",
      "callbackAt": null }
  ],
  "total": 213, "offset": 0, "limit": 200
}
```

Flat and pre-labelled so it maps straight onto spreadsheet columns — no lookups needed on your side. **Tell me if the export needs columns that are not here**; adding them now is far cheaper than a second endpoint later.

---

## 8. Two things I need from you

1. **Export columns.** §7 is my guess at what an Excel/PDF export wants. You own the export; if it needs anything else, say so before I freeze the shape.
2. **The punctuality refactor in §6** — you do it, or I do it, but not both.

## 9. Two things I am committing to

1. **Reusing `src/server/dashboard/metrics.ts`** rather than writing a second set of aggregations, as you asked. Where a report needs something it does not expose, I add to that file rather than forking it.
2. **`avgTalkSec` divides by calls that HAVE a duration**, not all calls. `MANUAL`-channel rows (an outcome recorded without pressing Call) carry `duration_sec = null` by design, and including them in the denominator understates average talk time. Worth aligning your dashboard's `avgTalkSec` the same way — I flagged this on Day 5 and it is still your call.
