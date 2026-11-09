---
lens: performance
source: performance-optimization
upstream_path: ~/.claude/skills/performance-optimization/SKILL.md
upstream_hash: c924947ef20bdf80fe7a0af2267e02215ecea4b8
---

# Lens: performance

Your lane: **backend, data, query and algorithmic cost**, judged from the code. Runtime front-end performance (Core Web Vitals, images, bundles, re-renders) belongs to the web-quality lens; mark any you report `"lane": "out"`.

You cannot measure here, so every finding is a **hypothesis**: set `"evidence_type": "source"`, put the measurement that would confirm it in `evidence` (the query plan to run, the endpoint to time, the input size where it bites), and cap `confidence` at `medium` unless the pattern is unambiguous from the code alone (a query inside a loop over rows). Report patterns with a plausible cost at realistic data sizes; skip micro-optimizations.

## Patterns to check

- **N+1 queries**: a query, fetch or ORM lazy-load inside a loop over rows. Fix: fetch the relation in the same query (join, include, batch loader).
- **Unbounded fetching**: a list endpoint or query with no limit and stable order; reading a whole table or file into memory. Fix: paginate with a limit and a stable sort.
- **Queries that ignore their index**: filters or sorts on unindexed columns; a function applied to an indexed column (`lower(email)`); a leading wildcard `LIKE '%x'`; a low-selectivity column. Fix names the index shape (equality columns first, then range or sort column) or an expression, partial or trigram index, and the `EXPLAIN ANALYZE` to confirm. A new index is also a write cost: weigh it.
- **Connection handling**: a pool created per request or per call; pool `max` raised with no cap tied to instance count; serverless without a pooling proxy.
- **Caching**: a new cache whose key omits an input the response depends on (tenant, locale, viewer, permissions, flags) is a correctness and data-leak bug: severity `blocker` when it can serve one user's data to another. Also: no stated staleness or invalidation; caching what must be fresh (balances, permissions, checkout inventory); caching an already cheap call; no stampede protection on a hot key.
- **Algorithmic cost**: nested loops over collections that grow with data (O(n²) lookups that want a map), repeated sorting, regex with catastrophic backtracking on user input.
- **Blocking work**: synchronous file, crypto or CPU-heavy work on a request path or event loop; sequential awaits that are independent and could run concurrently.
- **Memory growth**: unbounded in-process caches, listeners or arrays that only grow, large payloads held across requests.
- **Hot-path allocation**: large objects or closures built per item in a tight loop.

Done when every changed data-access path, loop over a data collection, cache and request handler in the diff has been checked against every pattern above.
