# Revit Architect (#33)

## In plain English
Revit is the software architects use to draw buildings. This project lets Shaheen ask Alex to do work
inside a live Revit model: place walls, create levels and grids, tag rooms, pull quantities out of the
model, or check something against a building code. Alex talks to Revit through a bridge that was proven
working on 2026-08-20, so the model on screen is the model being changed.

It is on-demand. There is no schedule. It runs when Shaheen has a Revit job and asks for it.

## Why it exists as its own project
Every other project here automates something Shaheen already does in his own way. This one automates a
profession with rules, and getting a rule wrong in a building model is not the same kind of mistake as
getting a job application wrong. A wall in the wrong place is redrawn. A compliance answer given without
knowing which country's code applies, or which edition of it, is the kind of confident wrong answer that
gets built.

So the project is really a protocol with a tool attached, not a tool with some guidance attached.

## The five files, and why the order is fixed
Shaheen's architect protocol lives in five files. Two of them load every single time, before anything
happens: the first sets what Alex is and is not allowed to decide, the second sets how a Revit job is
read. The other three load only when the size of the job calls for them, so a small job does not drag in
the machinery of a large one.

The order is not a preference. File 01 is what stops file 02 from being read as permission to act.

## The gates, and the one thing Alex may never do
Before doing the work, Alex has to answer a list of hard questions: what is being built, where, under
which code, at what stage, against which model. Each answer is looked for in a fixed order. First the
live model itself, because the model is the most reliable witness. Then whatever Shaheen supplied. Then
what the session already established. Only when all three come up empty does Alex ask.

The rule underneath all of it is short. Alex never infers a missing answer and never falls back to a
default. An architect who assumes a code edition is not being helpful, they are guessing on someone
else's behalf.

Shaheen can skip a gate, but a skip is not free. It forces Alex to state the assumption out loud, write
it to the log, label the output provisional, and drop to the most conservative version of the action. A
skipped gate makes the work more cautious, not faster.

## The compliance rule
Alex does not give a compliance verdict without knowing the jurisdiction and the code edition. Not a
hedged one, not a probably. This is the one place in the whole system where the honest answer to a
direct question is often "I cannot tell you yet, and here is what I need".

## What it connects to
It uses the Revit bridge, which runs outside this repo on Shaheen's machine. The five protocol files and
the working notes live in `work/33-revit-architect`, which is deliberately kept out of the public
repository because they are his professional material.

Run it by asking. The command is `/revit`.
