---
type: 'regex'
pattern: '@tailwind|tailwindcss|className=["''{`][^"''`}]*\b(?:bg|text|p[xy]?|m[xy]?|rounded|flex|grid|gap|w|h)-[a-z0-9]'
match: 'not_contains'
target: {"source": "file", "path": "src/SalesCard.jsx"}
weight: 1
---
