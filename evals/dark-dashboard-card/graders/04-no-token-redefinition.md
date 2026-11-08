---
type: 'regex'
pattern: '--lm-color-[a-z-]+\s*:'
match: 'not_contains'
target: {"source": "file", "path": "src/SalesCard.css"}
weight: 1
---
