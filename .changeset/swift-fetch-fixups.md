---
"@minpeter/opensearch": patch
---

Address PR review findings in the fetch resilience pipeline: stop routing legal (HTTP 451) blocks through the third-party reader so legal takedowns surface as errors, and recognize apex domains under compound TLDs (e.g. `example.co.uk`, `example.com.au`) when generating mobile/apex retry variants.
