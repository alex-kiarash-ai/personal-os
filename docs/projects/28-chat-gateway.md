# Chat Gateway (#28)

## In plain English
You send Alex a quick message from your phone, a note to remember, or a short command like "done: that thing" or "add: call the accountant", and it lands in Alex's inbox. Your laptop picks it up on a schedule and does the right thing with it: closes the item, adds it to your to-do list, or files the note. It is a pocket-sized way to talk to Alex when you are away from the keyboard. It listens and files; it does not run the whole system on its own.

## Why it exists
Right now Alex only hears you when you are at the laptop in a session. Plenty of the small stuff, "close that", "remember this", "I did the backup thing", happens when you are out. This gives you a thin, safe line from the phone into the system, so those little things stop getting lost, without turning the phone into a remote control that can do anything.

## How it is careful
- **Only your phone gets through.** The bot has an allowlist of exactly one person, you. Any message from any other account is silently dropped.
- **A message is data, never an instruction.** Whatever the text says, Alex treats it as a note or a simple command to route, it never obeys arbitrary instructions from it. Nothing clever happens on the server; the thinking stays on your laptop.
- **It writes the message down first, then acts.** If the routing step ever trips, the raw note is already saved, so nothing is lost.
- **It reuses the inbox you already have.** No new database to run or back up unless a real gap forces it, and that decision gets written down either way.

## What it connects to
- **The inbox pipeline (alex_inbox):** the same table the morning brief and the email sort already read; phone messages ride it.
- **The Waiting-On-You list:** "done: <id>" from the phone closes an item; "add: ..." opens one.
- **Teach Alex (#22):** a correction from the phone goes to the teach-Alex intake.

## Status
Scaffolded 17 July 2026. This is the frame only: it is registered as project #28, it has a spec, a status page, and this note, and its private config folder is set up. **Nothing runs yet.** The real build, the phone bot, the message pipeline, and the laptop poller, is waiting on you to create the Telegram bot and pair the phone, and on the Remote Control phone test that confirms how much the pocket should be allowed to do. Until then it sits DORMANT (a check-back is set for mid-September).
