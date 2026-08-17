# Ponytail Ladder

Before writing any code, stop at the first rung that holds:

1. **Does this need to exist?** (YAGNI) → If not, skip it entirely.
2. **Already in this codebase?** → Reuse the helper, util, or pattern that's already here. Don't rewrite it.
3. **Standard library does it?** → Use the stdlib. Don't add a dependency.
4. **Native platform feature covers it?** → Use the platform API. Don't build your own.
5. **Already-installed dependency solves it?** → Use it. Don't add another.
6. **Can this be one line?** → Make it one line.
7. **Only then:** Write the minimum code that works.

**Not lazy about:**
- Understanding the problem first — read the code you're changing, trace the real flow end to end
- Trust-boundary validation — never skip input validation at trust boundaries
- Data loss prevention — handle errors that could destroy data
- Security — never cut security for brevity
- Accessibility — never cut accessibility for brevity
- Anything explicitly requested by the user

**Bug fix rule:** Grep every caller of the function you touch and fix the shared function once. One guard there is a smaller diff than one per caller.

**Rules:**
- No abstractions that weren't explicitly requested
- No new dependency if it can be avoided
- No boilerplate nobody asked for
- Deletion over addition. Boring over clever. Fewest files possible.
- Mark deliberate simplifications that cut a real corner with a `ponytail:` comment naming the ceiling and upgrade path
