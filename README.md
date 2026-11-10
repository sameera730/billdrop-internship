# BillDrop

BillDrop is a made-up invoice review tool for accountants and managers to upload, check, and save supplier bills.

**Live link:** https://billdrop-internship.onrender.com

## Deploy on Render

The repository includes `render.yaml`. In Render, create a Blueprint from this public GitHub repository and choose the free web service. The health check is `/api/health`. Add `OCR_SPACE_API_KEY` and, optionally, `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` in the Render environment settings; never add them to GitHub. The free service sleeps when idle, and its local SQLite data and uploaded files can be lost on restart or redeploy, so use made-up demo data only.

## Recordings

60-second Drive recording: pending. Add a Drive link with “Anyone with the link” access after recording the working flow. Do not upload the recording to YouTube or LinkedIn.

## Test logins

Demo accounts only; these credentials are public and are not secure for real data.

| Role | Email | Password |
|---|---|---|
| Accountant | `accountant@billdrop.demo` | `billdrop-demo-1` |
| Manager | `manager@billdrop.demo` | `billdrop-demo-2` |

## What it does

1. Signs in as a demo accountant or manager.
2. Shows seeded, made-up supplier and bill records.
3. Loads the included sample bill to demonstrate the review flow without API keys.
4. Lets the accountant edit supplier, bill number, date, line amounts, and total.
5. Saves a reviewed bill and shows saved bills and supplier totals to the manager.

## The AI feature

- What it does: extracts supplier, bill number, date, line descriptions, amounts, and total from OCR text into JSON.
- Which free model it uses: the model configured through `OPENROUTER_MODEL`; set a free OpenRouter model ID in the hosting environment.
- What happens if the AI service is not available: the app falls back to basic text extraction; if parsing fails, it leaves fields for manual review.
- A real OCR upload needs an `OCR_SPACE_API_KEY`. The offline sample flow works without external keys.

## My stack

- Node.js built-in HTTP server and SQLite (`node:sqlite`) for the backend and database.
- Plain HTML, CSS, and JavaScript for the interface.
- OCR.Space for OCR and OpenRouter for optional AI extraction. Keys are configured as environment variables and are not stored in GitHub.

## Main design choices

- Tables: `people`, `suppliers`, `batches`, `bills`, and `bill_lines`.
- Bill lines are stored separately so each invoice can have multiple editable items.
- Uploaded files stay in a private server folder and are served only after a login check.
- Only saved bills appear in the manager view; the accountant owns review and correction.
- This is a learning demo. The demo login and in-memory sessions must be replaced before real use.

## How to run it on your computer

Requires Node.js 22.5 or newer.

```powershell
npm start
```

Open `http://localhost:3000`. Optional settings in `.env`: `OCR_SPACE_API_KEY`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `DATA_DIR`, and `PORT`. Start from `.env.example`; never commit real keys.

## How to run the tests

No automated test suite has been added yet. Use the demo accountant login, load the sample bill, review and save it, then sign in as manager to inspect saved records.

## Made-up data

All names, suppliers, bills, amounts, dates, and login accounts in the seed data and `docs/sample-bill.pdf` are invented for this demo. They contain no real customers or customer documents.

## What works

- Fully working: deployed demo login, seeded records, offline sample bill review and save, role-based bill visibility, supplier totals, private file route.
- Partly done: real file uploads need an `OCR_SPACE_API_KEY`; AI extraction needs OpenRouter settings; the required Drive recording link is pending.
- Skipped: batch processing and later-week features outside the first complete bill flow.

## What I would do differently with more time

- Replace demo authentication with a managed authentication service and add persistent secure sessions.
- Add automated checks and deployment configuration after the hosting account and free service credentials are available.
