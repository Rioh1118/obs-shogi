---
type: 'regex'
pattern: '#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\('
match: 'not_contains'
target: {"source": "file", "path": "src/PricingPage.css"}
weight: 1
---
