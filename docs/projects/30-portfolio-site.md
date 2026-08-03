# Portfolio Website (#30)

## In plain English
Shaheen's modeling website, shaheenkiarash.com, rebuilt properly. Today it is a folder of hand-edited HTML on his laptop that he uploads by hand. The new version is a real project: the photos and the words live in a public code repository, and every time he saves a change there, a robot rebuilds the whole site and publishes it automatically, in about a minute, with no upload step and no chance of forgetting a file.

The site itself stays simple on purpose. Four pages, a film section, and a photo grid. A visitor's browser receives plain finished pages, so it loads fast and there is nothing running on a server that could break or need security patches.

## Why it exists
Two reasons at once, which is what makes it worth the effort. It is his working portfolio, the thing a casting director or a brand actually looks at. And it is a piece of proof for job interviews: a public repository with a clean history, a documented deployment, a tested restore, and a written record of every decision. Interviewers can look at the whole thing. That is why the plumbing is built to a professional standard rather than the quickest thing that works.

## The one decision worth knowing about
The original plan was to host the site on Shaheen's own rented server. Alex argued against it and won, on evidence: that server is the production machine running the job-application engines and the dashboard, and its web ports are already taken by the software fronting them. Putting a public website on the same box would mean editing the configuration of the thing running production, and repointing the domain would put his own email address at risk, since it runs on the same domain settings. So the site stays where it already is, on Cloudflare's network, which is free, fast worldwide, and has one-click undo built in. The automatic-publishing part, which was the actual point, is kept in full.

The honest version of that for an interview is better than the original plan anyway: "I evaluated self-hosting on my own server and decided against it, to keep a public website away from my production infrastructure." Deciding not to build something, for a stated reason, is the senior move.

## How it is careful
- **No secrets in the repository, ever.** The repository is public from the first commit. The one password-like thing involved, the key that lets the robot publish, is stored in GitHub's own secret vault, and it can only do that one job and nothing else.
- **The photos are protected.** Only web-sized versions go in the public repository; the full-resolution originals stay private. The code carries an open license, the photographs explicitly do not. If the photographer is not comfortable with his work sitting in a public repository, there is already a fallback that keeps the photos private without rebuilding anything.
- **Private life stays out, including the history.** The rule that Shaheen's partner never appears on the public profile now also covers file names, captions and the record of every change ever made, because a public repository remembers everything forever. Anything with the wrong name gets renamed before the first save, not cleaned up later.
- **Publishing is checked, not assumed.** After every automatic publish, the system fetches the live page and compares it against what was built, confirms the new images load and the private ones do not, and checks the link-preview card. "It uploaded" never counts as done.
- **Shaheen presses the button.** Alex prepares changes; the site only goes public when Shaheen approves the change into the main branch.

## What it connects to
- **The domain's email:** shaheen@shaheenkiarash.com, the contact address on the site, runs on the same domain settings, so this project never touches them.
- **The photographer:** he shot the portfolio work, and the question of publishing it in a public repository is his to answer. His details stay in the private vault, not here.
- **The retired modeling system:** project 30 used to be the casting-and-content loop, which was retired on 3 August 2026. This project took the number and the photos, nothing else.

## Status
Registered 3 August 2026. Definition phase. Nothing is built yet, and deliberately so: the plan's own rule is that no code gets written until the photographs are chosen and the design is decided, because building first and choosing later is how sites end up shaped around whatever was easy. Waiting on Shaheen for the photo selection, three reference sites he likes, the go-ahead on the hosting decision, and the permission question to the photographer. The current site stays live and untouched the whole time; it only gets replaced at the end, and the old version stays one click away.
