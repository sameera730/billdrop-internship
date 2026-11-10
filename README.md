# BillDrop

BillDrop is a made-up invoice review tool for accountants and managers to upload, check, and save supplier bills.

**Live link:** https://billdrop-internship.onrender.com

## Deploy on Render

The repository includes `render.yaml`. In Render, create a Blueprint from this public GitHub repository and choose the free web service. The health check is `/api/health`. Add `OCR_SPACE_API_KEY` and, optionally, `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` in the Render environment settings; never add them to GitHub. The free service sleeps when idle, and its local SQLite data and uploaded files can be lost on restart or redeploy, so use made-up demo data only.

## Recordings

Drive recording: [Watch the BillDrop review flow](https://drive.google.com/file/d/14sG-loSwoEKYliVz3bwW8IK3DUJQL9Rz/view?usp=drive_link). The uploaded recording is 20:01; the internship brief asks for a 60-second clip. Do not upload the recording to YouTube or LinkedIn.

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
