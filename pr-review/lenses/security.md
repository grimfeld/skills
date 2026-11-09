---
lens: security
source: security-and-hardening
upstream_path: ~/.claude/skills/security-and-hardening/SKILL.md
upstream_hash: f9f5b22b97f1f0bfe47a30c0ac860c343e332a94
---

# Lens: security

Your lane: **vulnerabilities, hardening, supply chain, privacy, LLM features**. Treat every external input as hostile. Other concerns belong to other lenses; mark any you report `"lane": "out"`.

Worked fixes for each control live in `~/.claude/skills/security-and-hardening/references/hardening-patterns.md`; open the section you need when writing a `suggested_fix`.

## 1. Threat model the diff

1. **Trust boundaries the diff touches**: HTTP handlers, forms, uploads, webhooks, third-party APIs, queues, **LLM output**, and local values another party wrote (another process's arguments or env, filenames on a shared volume, paths in a job payload). Trust follows who _wrote_ a value, not the channel that delivered it.
2. **Assets** at stake: credentials, PII, payment data, admin actions, money movement.
3. **STRIDE** over each boundary: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege.

A boundary the diff adds or changes with no validation is where to dig first.

## 2. Controls to check

- **Injection**: every SQL, NoSQL and shell call parameterized; no string building from input.
- **XSS**: output through framework escaping; raw HTML only after an allowlist sanitizer; no `eval` or `innerHTML` with user data.
- **Access control**: **authorization** on every request, not just authentication: the user owns or is permitted on the specific resource (IDOR).
- **Auth and sessions**: passwords hashed with bcrypt (≥12), scrypt or argon2; session secret from env; cookies `httpOnly`, `secure`, `sameSite` lax/strict, bounded `maxAge`; no auth tokens in localStorage.
- **Headers, CORS, responses**: security headers present; CSP from `default-src 'self'`; CORS from an explicit origin list, never `*` with credentials; sensitive fields stripped; generic error bodies, no stack traces.
- **Input validation and uploads**: schema validation at the boundary, downstream uses the parsed value; uploads allowlist MIME, cap size, check magic bytes.
- **SSRF**: any user-influenced URL fetched server-side has scheme and host allowlisted, all resolved IPs checked against private and reserved ranges (including `169.254.169.254` and IPv6), redirects forbidden.
- **Destructive operations on derived paths**: a delete, move or overwrite whose target comes from input, config or another process needs: symlinks resolved, target under an allowlisted root, at least one level below it, ownership evidence read before the operation.
- **Rate limiting**: auth endpoints strictly limited; a limiter with in-memory counters in front of more than one instance or on serverless is ineffective.
- **Secrets**: none in code, config committed to the repo, logs or test fixtures; `.env*` gitignored. A secret already pushed needs rotation, not only removal: say so in `suggested_fix`.
- **Dependencies and supply chain**: for each added or changed dependency, check typosquat-like names, maintenance, release age, install scripts, and the lockfile diff's transitive changes. Run the detected package manager's audit read-only (`npm audit --json`, `pnpm audit --json`, `yarn npm audit --json`) when a lockfile changed; triage critical and high by reachability.
- **Personal data**: new PII fields classified, collected against a purpose, with retention and a deletion path; no PII in telemetry or sent to third-party vendors without consent.
- **LLM features**: model output treated as untrusted input (never into SQL, shell, DOM, `eval`, file paths); untrusted text in the prompt cannot grant permissions; no secrets, other tenants' data or the full system prompt in context; tool arguments validated and destructive tool actions confirmed; token, rate and recursion caps.

## 3. Changes needing human sign-off

Report as a `major` with category `needs-approval` even when correctly implemented: a new or changed auth flow, a new category of stored sensitive data, a new external integration, a CORS change, a new upload handler, a rate-limit change, new elevated permissions or roles.

## Severity

Exploitable with a plausible path: `blocker`. A missing control with no current exploit path: `major`. Defence-in-depth gaps: `minor`. State the attack path in `evidence`: who controls the input, how it reaches the sink.

Done when every trust boundary the diff touches has been named in your coverage line and checked against every control above that applies to it.
