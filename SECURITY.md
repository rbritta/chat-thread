# Security policy

## Supported versions

Fixes go into the latest minor release only.

| Version | Supported |
| --- | --- |
| 0.5.x | Yes |
| older | No |

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub instead: on the repository's **Security** tab, choose **Report a vulnerability** ([direct link](https://github.com/rbritta/chat-thread/security/advisories/new)).

Say which version or commit you used, what an attacker can do, and the smallest example that shows it. You will get an answer as soon as possible; once a fix is released, the advisory is published with credit to you, unless you would rather stay anonymous.

## What counts

chat-thread draws text it does not control, so these are in scope:

- markup or script that gets through `renderThread`, `createChat` or `createThreads` from a message, an author, an option or a string (cross-site scripting);
- a URL that gets past `safeUrl` (a `javascript:` link, say);
- anything that breaks the strict Content-Security-Policy the library promises to work under;
- the SQLite store or the HTTP handler writing or reading what they should not, given the routes the README documents.

The HTTP handler has no authentication or CSRF protection of its own by design: the README asks the app to put both in front of it. A report that it lacks them is not a vulnerability.
