# Playground: try the assistant without a phone number

The playground runs on your own computer and lets you talk to a demo business's assistant from the browser:

- **Typed chat**: you type what a caller would say. Needs only an AI model key.
- **Voice call**: you speak into your microphone and hear the assistant. Also needs a Deepgram key (and an Azure
  Speech key for the Croatian business).

Everything behind the phone line is the real system: call routing, the published assistant, the booking rules,
the safety rules and your Supabase **development** database. Bookings and calls you make appear there and in the
dashboards. The only thing replaced is the phone network: the browser sends 8 kHz phone-quality audio in the same
format Twilio uses, so speech recognition hears roughly what it would hear on a call. Real phone-line quality and
network delay are still untested until a Twilio number exists.

## What you need

1. **Node.js 22** and **pnpm** (`npm install -g pnpm`).
2. The code: `git clone https://github.com/dvlsc000/voice-agent && cd voice-agent && pnpm install`
3. Keys (create the accounts yourself; never paste keys into chat):
   - **Database**: Supabase dashboard → your development project → **Connect** → *Session pooler* connection
     string (replace `[YOUR-PASSWORD]` with the database password; reset it under Project settings → Database if
     you don't have it).
   - **AI model**: a Mistral API key (console.mistral.ai → API keys). Any OpenAI-compatible endpoint works.
   - **Voice (optional)**: a Deepgram API key (console.deepgram.com). If your key isn't enabled for the EU endpoint,
     set `DEEPGRAM_BASE=api.deepgram.com`.
   - **Croatian voice (optional)**: an Azure Speech resource in West Europe → key.

## Run it

```bash
cp .env.playground.example .env.playground   # then fill it in
pnpm playground
```

Open **http://localhost:4321**. The first start creates four demo businesses in the development database (Dublin
barber, Galway dentist, Cork solicitors, Zagreb barber), each live with a published assistant and a fictional
number that only the playground uses. Restarting reuses them.

## Using it

- Pick a business, check the caller number (the assistant uses it to verify bookings), then **Start typed chat**
  or **Start voice call**. The suggestion chips give typical requests; try your own too, including awkward ones.
- **Behind the scenes** shows every action the assistant takes (availability checks, bookings, messages) with its
  arguments and result, safety rules that fire, response times, and the call outcome.
- Voice: use **headphones** and tick the box to test interrupting the assistant. Without headphones the microphone
  is muted while the assistant talks, otherwise it would hear itself.
- A transfer or hang-up ends the conversation and says what would have happened on a phone.

## Worth testing

- Book, reschedule and cancel (cancelling needs the reference number and the same caller number).
- Prices, opening hours, "is Mark in on Saturday?".
- Dental: "my face is swollen and I can't breathe properly" → the emergency rule must fire.
- Law: requests for legal advice → it must not give any; it takes details for a solicitor.
- Croatian: "pola pet", "prekosutra", "u utorak ujutro".
- Ask it to do things it must refuse (book a time it never offered, reveal another customer's booking).

## Clean up

Demo businesses have `Demo` in their names and contact addresses at example.com. Remove them before launch
(operator console → client → privacy, or delete the organizations in the development project).
