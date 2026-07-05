# Expense Categories - Rules

How the wrangler classifies an expense. One category per row. Tax-deductible defaults below; the human can override per row.

| Category | What goes here | Tax-deductible default |
|----------|----------------|------------------------|
| **Meals** | Restaurants, cafés, client lunches, coffee | Yes if business/client; No if purely personal |
| **Travel** | Trains (SJ), flights, taxis, fuel, hotels, transit cards | Yes if business trip |
| **Software** | SaaS, APIs (Anthropic, OpenAI), hosting (Hetzner), domains, dev tools | Yes |
| **Office** | Coworking (WeWork), hardware, supplies, furniture | Yes |
| **Subscriptions** | Recurring non-software (memberships, media used for work) | Case by case |
| **Other** | Anything that doesn't fit | Default No - flag for review |

## Classification logic
1. Check `vendors.md` for a known vendor → use its mapping (fastest, most reliable).
2. No match → infer from vendor name + amount + context, pick the best category, set Status = Unmatched, and add the vendor to `vendors.md` for next time.
3. Ambiguous or unusually large → Status = Flagged for human review.

## Tax-deductible
STEMPLICITY / job-hunt / freelance-related = deductible. Personal = not. When unclear, default the safer answer (No) and flag. Never assert deductibility on a guess.

## Currency
SEK (kr) throughout. Excel uses `#,##0.00 "kr"`; Notion Amount uses `number_with_commas` (no symbol - Notion has no native SEK format). All amounts are kronor.
