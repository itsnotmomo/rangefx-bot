# Range Compound bot — user-facing copy inventory

Every message a user can ever receive from the bot, organized by flow, with the
exact current text and the buttons shown alongside it.

How to read this document:

- Text inside `{curly braces}` is filled in automatically at send time (a
  price, a date, a link). Everything else is sent exactly as written.
- "Buttons" are the tappable options attached beneath a message. Buttons
  marked *(link)* open a web page; all others navigate inside the bot.
- Defaults referenced below: invites expire in **24 hours**; the payment grace
  period is **3 days**. Both are configurable without copy changes.

---

## 1. /start

### 1.1 First start and every return to /start

Sent whenever a user opens the bot or sends /start — first-timers and
returning users see the same message. Users arriving through a website
deep-link (e.g. a "start" link on rangecompound.com) also see exactly this;
the link source is recorded silently.

> Range Compound.
>
> The Compound is a working trading desk you watch operate from the inside.
> Members get the desk’s execution, levels, and reasoning — in real time.

Buttons:
- Join The Compound
- Results · FAQ
- My Subscription · Support

### 1.2 Returning from Stripe after paying

Sent instead of the welcome when the user lands back in the bot straight from
a successful checkout (the invite itself arrives separately — see 3.1).

> Thanks — your payment is processing.
>
> Your personal invite will arrive in this chat within a minute or two.
> If it doesn’t, open “My Subscription” and request a fresh link.

Buttons: same main menu as 1.1.

### 1.3 Returning from Stripe after abandoning checkout

Shows the standard welcome (1.1). No dedicated message.

---

## 2. Main menu

### 2.1 Join The Compound — the plan list

Shown when the user taps **Join The Compound** or sends /plans.

> Join The Compound
>
> Same access on every plan. Longer terms cost less per month.
>
> • Monthly — billed monthly
> • Quarterly — billed every 3 months
> • Annual — billed yearly
>
> Pick a plan to continue to secure checkout.

Buttons:
- Monthly — billed monthly
- Quarterly — billed every 3 months
- Annual — billed yearly
- « Back

### 2.2 A plan is selected — the checkout message

Shown after tapping a plan. The price is read live from Stripe (e.g. "€79").

> {Plan} — {price}, {billing cadence}.
>
> Payment runs through Stripe’s secure checkout. The moment it succeeds, your personal invite arrives in this chat.
> The invite is yours alone — it works once and expires in 24 hours.

If the price can't be fetched at that moment, the first line reads
"{Plan} — {billing cadence}." and the rest is unchanged.

Buttons:
- Open secure checkout *(link)*
- « Back

### 2.3 Results

Shown when the user taps **Results** or sends /results. Figures mirror the
stats section of rangecompound.com.

> Results
>
> Documented month by month since October 2023. Every position logged — entry, stop, and exit.
>
> +72.3% — trailing 12-month return (sum of the last twelve documented months)
> 33 — months documented, unbroken
> 49% — average win rate across every logged position
> 1,059 — positions logged
> +16% — best month (November 2023)
> −2.5% — worst month (June 2025)
>
> Of 33 months, one closed negative — and it stayed on the record.
>
> Past performance does not guarantee future results; every outcome depends on your own execution and risk control.
>
> The full month-by-month record is on the site.

Buttons:
- rangecompound.com *(link)*
- « Back

### 2.4 FAQ

Shown when the user taps **FAQ** or sends /faq.

> FAQ
>
> Pick a question.

Buttons: one per question below, then « Back.

Each answer appears as the question, a blank line, then the answer, with
buttons **More questions** and **« Back**.

**What is The Compound, exactly?**

> The Compound shares its own live trading — entries, levels, reasoning — as it happens. Members watch the desk work in real time. What you do with your own capital is your decision.

**What do I get as a member?**

> The desk’s entries, levels, and reasoning, posted in the group as they happen. Same access on every plan — longer terms simply cost less per month.

**Which pairs does the desk trade?**

> EURUSD, XAUUSD, and EURJPY. The desk trades the range, not the prediction — small, controlled wins, compounded.

**What results can I expect?**

> Look at the record, not at promises. The Results section here carries the desk’s documented figures, and the full month-by-month table is at rangecompound.com. Real numbers only — 33 months on the record, one negative.

**How do payments and renewals work?**

> Billed by Stripe through secure checkout — monthly, quarterly, or annual. Renewal is automatic until you cancel. Your card details never touch this bot, and your invite arrives here the moment payment succeeds.

**How do I cancel?**

> Anytime, from “My Subscription” → “Manage billing”. No forms, no questions. Access runs to the end of the period you’ve paid for.

**How do I get help?**

> Message this bot. It reaches the desk directly, and the reply lands in this chat.

### 2.5 My Subscription

Shown when the user taps **My Subscription** or sends /status.

**Never subscribed:**

> You don’t have a subscription yet.
>
> Pick a plan to join The Compound.

Buttons: the three plan buttons, then « Back.

**Has (or had) a subscription** — the view is assembled from these lines:

> Your subscription
>
> Plan: {Monthly | Quarterly | Annual}
> Status: {see status wording below}
> Renews: {date}
> Group access: {active | not active}

Variations:
- If cancellation is scheduled, the "Renews" line is replaced by:
  > Ends: {date} (cancellation scheduled)
- If the billing page can't be opened at that moment, this line is appended:
  > Billing portal is temporarily unavailable — try again shortly.

Status wording by billing state: **Active** · **Trialing** · **Payment
failing** (payment problems) · **Cancelled** · **Unpaid** · **Incomplete** ·
**Expired**.

Buttons:
- Manage billing *(link — only when billing is on file)*
- Get a fresh group invite *(only while group access is active)*
- « Back

### 2.6 Support

Shown when the user taps **Support** or sends /support.

> Support
>
> Send a message here — it goes straight to the desk. Replies land in this chat.
>
> Quick answers:
> • Manage or cancel: “My Subscription” → “Manage billing”.
> • Missing invite? Open “My Subscription” — if your access is active you can request a fresh link.
> • Payment failed? You’ll receive a link to update your card. There’s a short grace period before access pauses.

Buttons:
- « Back

---

## 3. After payment

### 3.1 "You're in" — the invite message

Sent automatically the moment payment succeeds.

> You’re in.
>
> Your personal invite — works once, expires in 24 hours:
> {invite link}
>
> Say hello when you land — the desk reads everything.
> Levels and execution post in the group as they happen.
> Need anything? Message this bot — it reaches the desk directly.

Buttons: none.

### 3.2 Fresh invite reissue

Sent when a member with active access taps **Get a fresh group invite** in
My Subscription (e.g. their original link expired unused).

> Your fresh invite — works once, expires in 24 hours:
> {invite link}

Buttons: none.

---

## 4. Billing lifecycle messages

### 4.1 Payment failed

Sent when a renewal charge fails. Access continues during the grace period.

> A payment on your Range Compound subscription didn’t go through.
>
> You still have access for now. Update your card here to avoid interruption:
> {billing link}

Buttons: none.

### 4.2 Grace warning

Sent one day into a failed-payment period, before access is paused.

> Your Range Compound payment is still failing.
>
> Access will pause in about 3 day(s) unless the payment is fixed.
> Update your card here:
> {billing link}

Buttons: none.

### 4.3 Access removed

Sent when the subscription ends (cancellation took effect, or the grace
period ran out) and the member is removed from the group.

> Your Range Compound subscription has ended and group access has been removed.
>
> No hard feelings. If you resubscribe later, you’ll get a fresh invite automatically.

Buttons: none.

### 4.4 Cancellation scheduled

Sent when the user schedules a cancellation in the billing portal.

> Your subscription is set to cancel.
>
> You’ll keep access until {date}. You can undo this anytime from “Manage billing”.

Buttons: none.

### 4.5 Plan changed

**No message exists for this today.** A member who switches plans in the
billing portal receives nothing from the bot — the change is recorded
silently. Flagged here as a gap for copy review: decide whether a
confirmation is wanted.

---

## 5. Follow-up messages

Sent to users who looked at plans or opened checkout but didn't pay. Two
touches maximum, ever; paying (or already being a member) cancels them.

### 5.1 Touch 1 — one hour later

> One line, in case it wasn’t clear:
>
> The Compound is a live look inside a working trading desk — its execution, levels, and reasoning, as they happen.
>
> Plans below if you want in.

Buttons: the three plan buttons, then « Back.

### 5.2 Touch 2 — twenty-four hours later

> Two facts, then we’ll leave it with you:
>
> 33 months documented, month by month, since October 2023 — one closed negative, and it stayed on the record.
> +72.3% trailing 12-month return across 1,059 logged positions.
>
> If that’s what you’re looking for, the plans are below.
> Either way, this is the last message you’ll get about it.

Buttons: the three plan buttons, then « Back.

---

## 6. Support conversation

### 6.1 Acknowledgment

Sent immediately after any plain (non-command) message a user sends the bot.

> Received. The desk will reply here.

Buttons: none.

### 6.2 The desk's reply

When an admin answers, the user receives the admin's message **exactly as the
admin wrote it** — free text, no wrapper, no signature. It reads as a normal
chat message from the bot.

---

## 7. Errors and edge cases

### 7.1 Checkout couldn't start

Shown if opening Stripe checkout fails after picking a plan.

> Couldn’t start checkout just now. Please try again in a moment.

Buttons: « Back

### 7.2 Fresh invite couldn't be created

Shown if the invite reissue fails (e.g. Telegram briefly unavailable).

> Couldn’t create an invite just now. Try again in a moment.

Buttons: « Back

### 7.3 Fresh invite requested without active access

Shown if a user without live group access somehow requests an invite.

> Your access isn’t active. Pick a plan to join The Compound.

Buttons: the three plan buttons, then « Back.

### 7.4 Unknown commands

A message starting with "/" that isn't a recognized command gets **no reply
at all** — deliberate silence rather than an error. (Plain text, by contrast,
is always treated as a support message and acknowledged — see 6.1.)

### 7.5 Broadcasts

Users may occasionally receive one-off announcements (text, or a photo with a
caption) written by the desk. That content is freeform and not part of this
inventory.
