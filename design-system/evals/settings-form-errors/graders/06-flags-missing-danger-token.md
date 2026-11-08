---
type: 'llm'
focus: 'last_message'
weight: 1
---

PASS if the final message tells the user that the design system has no danger/error color token (or that one is needed) instead of silently inventing a color.
FAIL if it claims the error styling is complete using a hard-coded or invented color without mentioning the missing token.
