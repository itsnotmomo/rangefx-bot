# Range Compound bot — user-facing copy inventory

Every message a user can ever receive from the bot, organized by flow, with the
exact current text and the buttons shown alongside it. This reflects the
approved copy specification, implemented verbatim.

How to read this document:

- Text inside `{curly braces}` is filled in automatically at send time (a
  price, a date). Everything else is sent exactly as written.
- "Buttons" are the tappable options attached beneath a message. Buttons
  marked *(link)* open a web page — invite links and billing links always
  travel as buttons, never as raw URLs in the text.
- Defaults referenced below: invites expire in **24 hours**; the payment grace
  period is **3 days**. Both are configurable without copy changes.

Standardized button language used throughout:
🚀 Join The Compound · 📊 See The Results · ❓ How It Works · 👤 My Membership ·
💬 Get Help · ⬅️ Back · 💳 Pay by Card — Secure Checkout · 💳 Manage Payment or
Cancel · 🔗 Get a New Group Link · 🚪 Enter The Compound

---

## 1. /start

### 1.1 First start and every return to /start

Sent whenever a user opens the bot or sends /start — first-timers and
returning users see the same message. Users arriving through a website
deep-link also see exactly this; the link source is recorded silently.

> Welcome to The Range Compound
>
> Where you can join a team of professional traders and operate alongside them.
>
> Inside The Compound, you see how the team operates in real time, the key levels, the execution, and the reasoning behind every decision.
>
> Press the button “🚀 Join The Compound” or “❓ How It Works” for more info!
>
> Choose an option below.

Buttons:
- 🚀 Join The Compound
- 📊 See The Results · ❓ How It Works
- 👤 My Membership · 💬 Get Help

### 1.2 Returning after successful payment

Sent instead of the welcome when the user lands back in the bot straight from
a successful checkout (the invite itself arrives separately — see 3.1).

> Payment received
>
> We are confirming your payment now.
>
> Your private link to enter The Compound will be sent in this chat automatically.
> It normally arrives within a minute or two.
>
> If it does not arrive, open My Membership and tap Get a New Group Link.

Buttons:
- 👤 My Membership · 💬 Get Help
- ⬅️ Main Menu

### 1.3 Returning after leaving checkout

Shows the normal welcome message (1.1). No special message.

---

## 2. Main menu

### 2.1 Join The Compound — plan selection

Shown when the user taps **🚀 Join The Compound** or sends /plans.

> Choose your membership
>
> Every plan gives you the exact same access to The Compound.
> The only difference is how often you pay:
>
> Monthly — maximum flexibility
> Quarterly — lower monthly cost
> Annual — lowest monthly cost
>
> Choose the option that works best for you.

Buttons — live prices are shown inside the buttons whenever available:
- 📅 Monthly — {monthly price}
- ⭐ Quarterly — {quarterly price}
- 🏆 Annual — {annual price} · Best Value
- ⬅️ Back

If a price can't be fetched, that button falls back to:
📅 Monthly — Most Flexible · ⭐ Quarterly — Better Value · 🏆 Annual — Best Value

### 2.2 A plan is selected — checkout

Shown after tapping a plan. The price is read live from Stripe.

> {Plan} Membership
>
> Price: {price}
> Payment: {billing cadence}
>
> Tap the button below to pay securely using your debit or credit card.
>
> Your payment is processed by Stripe. After payment, your private Telegram group link will be sent here automatically.
>
> Your membership renews automatically until you cancel. You can manage or cancel it at any time.
>
> Your private group link works once and expires after 24 hours.

If the price cannot be loaded:

> {Plan} Membership
>
> Payment: {billing cadence}
>
> Tap the button below to see the price and pay securely using your debit or credit card.
>
> After payment, your private Telegram group link will be sent here automatically.
>
> Your membership renews automatically until you cancel.

Buttons:
- 💳 Pay by Card — Secure Checkout *(link)*
- ⬅️ Choose Another Plan

### 2.3 Results

Shown when the user taps **📊 See The Results** or sends /results.

> The Range Compound Results
>
> Do not take our word for it. Look at the record.
> Every position has been documented with its entry, stop, and exit.
>
> Trailing 12-month return: +67.7%
> Documented track record: 35 months
> Average win rate: 50%
> Positions logged: 1,090
> Best month: +16%
> Worst month: −2.5%
>
> Only one of the 35 documented months closed negative — and it remains part of the public record.
>
> No deleted losing months. No promises about what happens next. Just the complete record of what has already happened.
>
> Past performance does not guarantee future results. Your outcome depends on your own execution and risk management.

Buttons:
- 📊 View Every Month on the Website *(link)*
- 🚀 Join The Compound
- ⬅️ Back

### 2.4 FAQ

Shown when the user taps **❓ How It Works** or sends /faq.

> How can we help?
>
> Choose a question below.

Buttons: one per question below, then ⬅️ Back.

Each answer appears as the question, a blank line, then the answer, with
buttons **❓ More Questions · 🚀 Join The Compound** and **⬅️ Back**.

**What exactly is The Compound?**

> The Compound is a private Telegram group where you watch the Range trading desk operate live.
>
> You see exactly what the desk is trading — the key levels, the execution, and the reasoning behind every decision as it happens — and you get the opportunity to copy their trades in real time and profit alongside them.
>
> You remain responsible for your own trades. Capital at risk.

**What do I receive?**

> Members receive the desk’s live entries, key levels, execution updates, and trading reasoning inside the private group.
>
> Every membership plan includes the same access. Longer plans simply cost less per month.

**Which markets do you trade?**

> The desk focuses on:
> • EUR/USD
> • Gold
> • EUR/JPY
>
> The focus is on trading controlled ranges rather than trying to predict every market movement.

**What results should I expect?**

> No result is guaranteed.
> Members may enter at different prices and manage risk and positions differently.
>
> Instead of making promises, we show you the complete documented record:
> 35 months documented, 1,090 positions logged, and only one negative month.
>
> You can review the full month-by-month record before joining.

**How do I pay?**

> Choose a monthly, quarterly, or annual membership.
> Then tap Pay by Card — Secure Checkout.
>
> You can pay using a debit or credit card through Stripe.
>
> Once payment succeeds, your private group link is sent in this chat automatically.
>
> Prefer to pay with crypto? Send a DM to @RANGESUPPORT.

**How do renewals work?**

> Your membership renews automatically at the end of each billing period.
>
> Monthly memberships renew monthly, quarterly memberships renew every three months, and annual memberships renew yearly.
>
> You can manage or cancel your membership at any time from My Membership.

**How do I cancel?**

> Open My Membership and tap Manage Payment or Cancel.
>
> You do not need to fill out a form or contact support.
>
> After cancelling, you keep access until the end of the period you have already paid for.

**How do I get help?**

> Tap Get Help or send a normal message directly to this bot.
>
> Your message goes to the desk, and the reply will appear in this chat.

### 2.5 My Membership

Shown when the user taps **👤 My Membership** or sends /status.

**Never subscribed:**

> You are not a member yet
>
> Choose a membership below to enter The Compound.
> Every plan gives you the same access. Longer memberships cost less per month.

Buttons: the three plan buttons (with live prices), then ⬅️ Back.

**Active or previous membership** — the view is assembled from these lines:

> Your Membership
>
> Plan: {Monthly | Quarterly | Annual}
> Status: {see status wording below}
> Next payment: {date}
> Compound access: {Active | Paused}

If cancellation is scheduled:

> Your Membership
>
> Plan: {plan}
> Status: Cancellation scheduled
> Access ends: {date}
> Compound access: Active until {date}

If the payment-management page is temporarily unavailable, this line is
appended:

> We could not open your payment settings right now. Please try again shortly.

Status wording by billing state: **Active** · **Trial active** · **Payment
needs attention** · **Cancellation scheduled** · **Cancelled** · **Payment
incomplete** · **Expired**.

Buttons:
- 💳 Manage Payment or Cancel *(link — only when billing is on file)*
- 🔗 Get a New Group Link *(only while membership access is active)*
- 💬 Get Help
- ⬅️ Back

### 2.6 Support

Shown when the user taps **💬 Get Help** or sends /support.

> How can we help?
>
> Send your message directly in this chat.
> It will be sent to the Range desk, and the reply will appear here.
>
> Common problems
>
> To change your card or cancel, open My Membership and tap Manage Payment or Cancel.
> If your group link expired, open My Membership and tap Get a New Group Link.
> If a payment failed, use the update-card button sent to you. Your access remains active for a short grace period.

Buttons:
- 👤 Open My Membership
- ⬅️ Back

---

## 3. After payment

### 3.1 Successful payment and private invitation

Sent automatically the moment payment succeeds. The invite link is attached to
the button, never shown as a raw link.

> Welcome to The Compound
>
> Your membership is active.
> Tap the button below to enter the private group.
>
> This link belongs to you, works once, and expires after 24 hours.
>
> Once you enter:
> • Turn on notifications
> • Read the pinned information
> • Say hello to the desk
>
> Entries, key levels, execution updates, and reasoning will be posted in the group as they happen.
>
> Need help at any point? Send a message to this bot.

Button:
- 🚪 Enter The Compound *(link)*

### 3.2 New invitation requested

Sent when a member with active access taps **🔗 Get a New Group Link**.

> Your new group link is ready
>
> Tap below to enter The Compound.
> This link works once and expires after 24 hours.

Buttons:
- 🚪 Enter The Compound *(link)*
- 💬 Get Help

---

## 4. Billing lifecycle

### 4.1 Payment failed

Sent when a renewal charge fails. Access continues during the grace period.

> Your payment did not go through
>
> Do not worry — your Compound access is still active during the payment grace period.
>
> Tap below to update your debit or credit card and prevent your access from being interrupted.

Buttons:
- 💳 Update My Card *(link — omitted if the billing page is unavailable)*
- 💬 Get Help

### 4.2 Grace-period warning

Sent one day into a failed-payment period. The pause date is exact, computed
from the grace deadline.

> Payment still needs attention
>
> We still could not process your Range Compound payment.
> Your access will pause on {date} unless your payment method is updated.
>
> Tap below to update your card and keep your access active.

Buttons:
- 💳 Update My Card *(link — omitted if the billing page is unavailable)*
- 💬 Get Help

### 4.3 Access removed

Sent when the membership ends (cancellation took effect, or the grace period
ran out) and the member is removed from the private group.

> Your Compound access has paused
>
> Your membership has ended, so you have been removed from the private group.
>
> You can rejoin whenever you are ready. After a new payment, a fresh group link will be sent here automatically.

Buttons:
- 🔄 Rejoin The Compound *(opens plan selection)*
- 💬 Get Help

### 4.4 Cancellation scheduled

Sent when the user schedules a cancellation in the billing portal.

> Cancellation confirmed
>
> Your membership will not renew.
> You will keep full access to The Compound until {date}.
>
> You can reverse the cancellation before that date from My Membership → Manage Payment or Cancel.

Buttons:
- 👤 Open My Membership
- ⬅️ Main Menu

### 4.5 Plan changed

Sent when a member switches plans in the billing portal and the change takes
effect immediately.

> Your membership has been updated
>
> New plan: {plan}
> New billing schedule: {billing cadence}
> Next payment: {date}
>
> Your access to The Compound remains active. You do not need a new group link.

Buttons:
- 👤 View My Membership
- 💬 Get Help

If the change takes effect later (a scheduled switch at the end of the
period):

> Your plan change is scheduled
>
> Your membership will change to {new plan} on {date}.
>
> Your current access remains active and nothing else needs to be done.

Buttons: none.

---

## 5. Follow-up messages

Sent only to users who opened the plans or checkout but did not pay. Two
touches maximum, ever; becoming a member stops them immediately.

### 5.1 Follow-up one — one hour later

> Still deciding? Here is exactly what you receive.
>
> Inside The Compound, you can watch the Range desk operate in real time:
> • Live entries and key levels
> • Execution and position updates
> • The reasoning behind the trades
> • Access to the private member group
>
> Every plan gives you the same access.
> Choose your membership below when you are ready.

Buttons: the three plan buttons (with live prices), then 📊 See The Results.

### 5.2 Follow-up two — twenty-four hours later

> One final message from us
>
> Before you decide, here is the record:
>
> 35 months documented
> 1,090 positions logged
> +67.7% trailing 12-month return
> One negative month
>
> Every position is recorded with its entry, stop, and exit.
>
> We cannot promise what will happen next. We can only show you exactly what has already happened.
>
> If you want to watch the desk operate from inside, choose a membership below.
> We will not send you any more joining reminders after this message.

Buttons: the three plan buttons (with live prices), then 📊 View Full Results.

---

## 6. Support conversation

### 6.1 Automatic acknowledgment

Sent immediately after any plain (non-command) message a user sends the bot.

> Message sent
>
> The Range desk has received your message and will reply in this chat.

Buttons: none.

### 6.2 Reply from the desk

When an admin answers, the user receives the admin's message **exactly as the
admin wrote it** — free text, no wrapper, no signature. It reads as a normal
chat message from the bot.

---

## 7. Errors and edge cases

### 7.1 Checkout could not open

Shown if opening the payment page fails after picking a plan.

> Checkout could not open
>
> Something went wrong while opening the payment page.
> Tap below to try again. You have not been charged.

Buttons:
- 🔄 Try Checkout Again *(retries the same plan)*
- ⬅️ Choose Another Plan
- 💬 Get Help

### 7.2 New invitation could not be created

Shown if the group-link reissue fails.

> We could not create your group link
>
> Your membership is still active.
> Tap below to try again. If it continues, send us a message and we will help you enter.

Buttons:
- 🔄 Try Again
- 💬 Get Help
- ⬅️ Back

### 7.3 Invitation requested without active membership

Shown if a user without active membership requests a group link.

> Your membership is not active
>
> A private group link can only be created for active members.
> Choose a membership below to rejoin The Compound.

Buttons: the three plan buttons (with live prices), then 💬 Get Help.

### 7.4 Unknown command

A message starting with "/" that isn't a recognized command always gets this
response — never silence. (Admin-only commands typed by regular users get the
same response.)

> I did not understand that command
>
> Use one of the buttons below.
> To speak with the Range desk, simply send a normal message without starting it with “/”.

Buttons: the full main menu (as in 1.1).

### 7.5 Broadcasts

Users may occasionally receive one-off announcements (text, or a photo with a
caption) written by the desk. That content is freeform and not part of this
inventory. Guidance: every promotional broadcast should ideally end with one
clear action button (🚀 Join The Compound · 📊 See The Full Record ·
👤 Open My Membership) rather than relying on a raw link.
