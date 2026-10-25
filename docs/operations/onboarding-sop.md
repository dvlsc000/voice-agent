# New client onboarding (standard procedure)

Target: under 15 minutes of operator time once you have the client's details, number decision and approval.

**Before the call with the client**, ask for: business name, address, website, opening hours, services with durations
and prices they're happy to quote, staff names, the number callers should reach in an emergency/outage (fallback),
owner's email, whether they use Google Calendar, and which plan they want.

1. **Create client** — operator console → Clients → Create client. Pick the industry; services come from the template.
2. **Set up and go live** page:
   1. *Read website* → tick the suggestions that are right → Apply. Prices arrive unapproved.
   2. *Phone number* → connect a number from your Twilio account, or record the number the client will forward to.
3. **Client's own settings** (owner gets an invitation email; or do it with them on a screen share):
   - Staff and working hours, closures (bank holidays), answers to common questions.
   - Services: correct durations, tick "Quote this price" for prices they approve.
   - Calendar: Connect Google Calendar and map each person, if they use it.
4. **Assistant** page → adjust name/capabilities if needed → *Run test calls* → read any failures → *Publish*.
5. **Supervised test call** with the client on the phone: book, ask an unknown question, ask for a person, (dental/legal:
   say something urgent and check it escalates). Then *Test call went well*.
6. **Go live**. If the client forwards calls, ask them to switch on forwarding now and make one more test call.
7. **Billing**: the owner chooses a plan on the Billing page (or you mark them as a trial).

Special care:
- **Dental / medical**: confirm their urgent-care protocol and fallback number; transcripts default off; never enable recording without a legal decision.
- **Solicitors**: confirm what intake fields they want; remind them the assistant never gives advice; conflict checks stay with the firm.
- **Croatian clients**: confirm a Croatian voice is configured (`AZURE_SPEECH_KEY`); otherwise calls are transferred, not answered.
