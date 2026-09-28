# Production Application Mindset

The application we are building is a **real production application**, not a prototype, demo, proof of concept, tutorial project, or throwaway implementation.

Every feature, component, API, database change, workflow, and user interaction must be approached with the mindset that **real users will depend on this application and real data will pass through it.**

Do not optimize for merely "making the feature work." Optimize for making it **correct, reliable, understandable, maintainable, secure, resilient, and pleasant to use.**

---

## 1. Never Do Half-Assed Implementations

Do not implement the minimum possible solution just to satisfy the immediate request.

Before implementing something, think through:

* What exactly is the user trying to accomplish?
* What happens before this feature?
* What happens after this feature?
* What other parts of the application depend on this?
* What happens if the user does something unexpected?
* What happens if the user does the same action twice?
* What happens if the request fails halfway through?
* What happens if data is missing?
* What happens if data is malformed?
* What happens if the user has no permission?
* What happens if the user refreshes the page?
* What happens if the user navigates away?
* What happens if the network disappears?
* What happens if the backend is unavailable?
* What happens if the database contains old or unexpected data?
* What happens when the amount of data becomes large?
* What happens when multiple users perform the same operation simultaneously?

A feature is not complete merely because the happy path works.

---

# 2. Think About the Entire System, Not Just the Requested File

Never treat a task as an isolated code change.

Before making changes, understand how the relevant parts of the system connect:

**UI → state → API → business logic → database → external services → response → UI state**

Consider the effect of a change across the entire chain.

For example, if a database field changes, consider:

* Backend models
* Validation
* API schemas
* Existing records
* Database migrations
* Queries
* Business logic
* Frontend types
* Forms
* Tables
* Filters
* Search
* Sorting
* API responses
* Caching
* Permissions
* Reports
* Exports
* Background jobs
* Tests
* Documentation

Do not fix one layer while silently breaking another.

Always ask:

> "What else depends on this?"

---

# 3. Think From the User's Perspective

Before considering a feature technically complete, mentally use the application as a real user.

Ask:

* Is it obvious what I should do?
* Do I understand what this button does?
* Is the terminology consistent?
* Is the interface confusing?
* Do I know whether my action succeeded?
* Do I know whether something is still loading?
* Do I know what went wrong when something fails?
* Can I recover from mistakes?
* Am I being asked for information I shouldn't have to provide?
* Is there unnecessary friction?
* Does the UI behave differently in similar situations?
* Is important information hidden?
* Are destructive actions sufficiently clear?
* Does the interface give me confidence that my data is safe?

Never assume that because something makes sense to the developer, it makes sense to the user.

---

# 4. Design for the Complete State Space

For every meaningful UI component or workflow, consider at minimum:

* Initial state
* Loading state
* Success state
* Empty state
* Error state
* Partial-data state
* Disabled state
* Unauthorized state
* Offline/network failure state
* Slow-response state
* Retry state
* Duplicate-action state
* Validation-error state
* Unexpected-data state

For example, a data table should not only have:

> "Here are the rows."

It should also properly handle:

> Loading → No results → Search has no matches → API failure → Permission denied → Pagination → Large datasets → Refresh → Retry → Stale data.

Every important state should have an intentional UX.

---

# 5. Empty States Are Features

Never leave users staring at a blank screen because there is no data.

Determine why the data is empty.

These are different situations:

* The user has never created anything.
* There is genuinely no data.
* A search returned no results.
* A filter removed all results.
* The user doesn't have permission to see the data.
* The API failed and returned nothing.
* Data is still loading.

Do not treat all of these as the same "empty state."

Provide appropriate messaging and, where useful, an actionable next step.

---

# 6. Errors Must Be Designed, Not Hidden

Never simply catch an error and show:

> "Something went wrong."

Whenever possible:

1. Understand the error.
2. Log useful technical information.
3. Show the user an understandable message.
4. Tell the user what they can do next.
5. Preserve their work whenever possible.
6. Allow retrying when retrying makes sense.

Never expose sensitive implementation details, stack traces, database errors, secrets, internal URLs, or infrastructure information to users.

Errors should be useful to both:

* the user
* the developer/operator diagnosing the problem

---

# 7. Never Assume the Happy Path

Always consider hostile, unusual, and accidental inputs.

Examples:

* Empty strings
* Extremely long strings
* Special characters
* Unicode
* Emojis
* Duplicate records
* Duplicate clicks
* Missing fields
* Null values
* Incorrect types
* Invalid IDs
* Expired sessions
* Stale data
* Deleted records
* Concurrent updates
* Large files
* Huge datasets
* Slow APIs
* Network interruptions
* Browser refreshes
* Back-button navigation
* Multiple browser tabs
* Mobile screens
* Very wide desktop screens

The application should fail **predictably and safely**.

---

# 8. Security Is Part of the Feature

Do not treat security as something to add later.

For every feature involving data or actions, consider:

* Authentication
* Authorization
* Role-based access
* Ownership
* Input validation
* Injection attacks
* XSS
* CSRF where relevant
* File upload security
* Rate limiting
* Sensitive data exposure
* Secrets
* API access
* ID enumeration
* Privilege escalation
* Insecure direct object references
* Logging of sensitive information

Never trust the frontend to enforce security.

If something must be restricted, enforce it on the backend.

---

# 9. Preserve Data Integrity

Real applications contain real data.

Never casually modify or delete data.

Before changing database behavior, think about:

* Existing records
* Backward compatibility
* Migrations
* Null/legacy values
* Referential integrity
* Unique constraints
* Foreign keys
* Transactions
* Partial failures
* Concurrent writes
* Rollbacks
* Data corruption scenarios

When an operation consists of multiple database changes that must succeed together, consider whether it requires a transaction.

---

# 10. Think About Idempotency and Duplicate Actions

Users double-click buttons.

Networks retry requests.

Browsers resend requests.

Background workers retry jobs.

Do not assume an operation happens exactly once.

For operations such as:

* Payments
* Orders
* Emails
* File processing
* Record creation
* Imports
* Webhooks
* Background jobs

consider whether the operation needs idempotency or duplicate protection.

---

# 11. Think About Concurrency

Assume multiple users, browser tabs, background workers, and requests can interact with the same data.

Consider:

* Race conditions
* Lost updates
* Duplicate creation
* Conflicting edits
* Stale state
* Concurrent deletes
* Concurrent status changes

Do not rely on frontend state to guarantee consistency.

---

# 12. Performance Matters

Do not prematurely optimize, but do not knowingly build obviously inefficient systems.

Think about:

* Database query count
* N+1 queries
* Large API responses
* Pagination
* Filtering
* Sorting
* Search performance
* Indexes
* Caching
* Unnecessary frontend renders
* Large bundle sizes
* Image sizes
* File processing
* Expensive computations

Always ask:

> "What happens when this feature has 10 users?"

Then:

> "What happens when it has 10,000 users?"

And where relevant:

> "What happens when the database has millions of records?"

---

# 13. Do Not Build UI That Only Works With Perfect Data

Real data is messy.

The UI must handle:

* Long names
* Missing names
* Missing images
* Long descriptions
* Large numbers
* Unexpected characters
* Null values
* Old records
* Deleted relationships
* Different date formats
* Different time zones
* Permission-dependent fields

Do not design only around the sample data.

---

# 14. Consistency Across the Application

The application should feel like one coherent product.

Maintain consistency in:

* Terminology
* Buttons
* Colors
* Typography
* Spacing
* Forms
* Validation
* Error messages
* Notifications
* Loading indicators
* Modals
* Tables
* Navigation
* Date/time formatting
* Empty states
* Confirmation dialogs

If the same concept is called "Customer" in one place and "Client" somewhere else, determine whether that is intentional.

Do not introduce a new pattern when an existing application pattern already solves the problem.

---

# 15. Don't Reinvent Existing Patterns

Before creating a new:

* Component
* Hook
* Utility
* API pattern
* Validation mechanism
* Modal
* Notification
* Table
* Form pattern
* State-management approach

look for existing implementations in the codebase.

Prefer consistency and reuse when appropriate.

However, do not blindly reuse something that is poorly designed just because it exists. Understand the existing pattern first.

---

# 16. Avoid Technical Debt That Is Easy to Prevent

Do not knowingly introduce:

* Dead code
* Duplicate logic
* Magic numbers
* Magic strings
* Unclear naming
* Giant components
* Giant functions
* Unnecessary abstractions
* Copy-pasted business logic
* Temporary hacks presented as permanent solutions
* Commented-out old code
* Debug logs
* Hardcoded credentials
* Environment-specific assumptions

If a shortcut is genuinely necessary, make its limitation explicit rather than pretending it is production-ready.

---

# 17. Maintainability Is a Requirement

Code should be understandable by another developer six months from now.

Prefer:

* Clear names
* Small focused functions
* Explicit data flow
* Sensible abstractions
* Consistent architecture
* Strong typing where applicable
* Useful comments for non-obvious decisions
* Predictable folder structure

Comments should explain **why**, not merely repeat **what** the code does.

---

# 18. Backward Compatibility Matters

Before changing an existing API, database structure, component contract, or shared utility, determine what depends on it.

Do not assume you can change an interface simply because the current feature works.

Consider:

* Existing clients
* Existing records
* Existing API consumers
* Background jobs
* Scripts
* Integrations
* Tests
* Cached data

---

# 19. UX Should Account for Human Mistakes

Users will:

* Click the wrong button
* Submit incomplete forms
* Navigate away
* Refresh accidentally
* Enter incorrect data
* Upload the wrong file
* Delete something accidentally
* Double-click
* Misunderstand terminology

Design the application so mistakes are:

**easy to prevent, easy to understand, and where possible, easy to recover from.**

For destructive actions, use appropriate confirmation or undo mechanisms.

---

# 20. Forms Need Serious Thought

For every form, consider:

* Required vs optional fields
* Validation
* Validation timing
* Clear error messages
* Field dependencies
* Default values
* Disabled states
* Loading state
* Submit state
* Duplicate submissions
* Unsaved changes
* Server-side validation
* Partial failures
* Reset behavior
* Keyboard navigation
* Accessibility

Never assume client-side validation is enough.

---

# 21. Loading States Should Feel Intentional

Do not freeze the interface while waiting for an API.

For operations that take time:

* Show appropriate loading feedback.
* Disable actions that should not be repeated.
* Preserve useful context.
* Avoid unnecessary flashing.
* Consider skeletons where appropriate.
* Give progress information for genuinely long operations.

The user should always understand:

> "Is the application working, or is it broken?"

---

# 22. Accessibility Is Not Optional

Build interfaces that can reasonably be used by people with different abilities.

Consider:

* Keyboard navigation
* Focus management
* Semantic HTML
* Labels
* Accessible buttons
* Screen-reader descriptions
* Color contrast
* Error announcements
* Modal focus behavior
* Form accessibility
* Avoiding color as the only indication of state

Do not treat accessibility as a visual afterthought.

---

# 23. Mobile and Different Screen Sizes

Do not assume everyone uses the same screen.

Consider:

* Desktop
* Laptop
* Tablet
* Mobile
* Small viewport
* Large viewport
* Touch interaction
* Keyboard interaction

Responsive behavior should be intentional rather than simply allowing elements to overflow.

---

# 24. Dates, Times, Numbers, and Localization

Be careful with:

* Time zones
* UTC vs local time
* Daylight saving where relevant
* Date formats
* Currency
* Decimal precision
* Number formatting
* Relative dates

Never casually convert or display dates without understanding what timezone the data represents.

---

# 25. Observability

A production application needs to be diagnosable.

Think about:

* Structured logs
* Useful error context
* Request IDs / correlation IDs where appropriate
* Monitoring
* Metrics
* Failed background jobs
* External API failures
* Database failures
* Important business events

When something breaks in production, developers should have enough information to understand what happened without reproducing the user's exact environment.

Do not log passwords, tokens, API keys, or other sensitive information.

---

# 26. External Services Are Unreliable

Never assume an external API will always:

* Respond quickly
* Return valid data
* Be available
* Return the same response
* Accept every request
* Never rate-limit you

Consider:

* Timeouts
* Retries
* Retry limits
* Exponential backoff where appropriate
* Rate limits
* Invalid responses
* Partial failures
* Service outages
* Circuit-breaking strategies where appropriate

Do not blindly retry operations that are not safe to repeat.

---

# 27. Files and Uploads Need Special Attention

For file-related features, consider:

* File size
* File type
* MIME type
* Malicious files
* Filename handling
* Duplicate files
* Upload interruption
* Storage failures
* Processing failures
* Virus/malware scanning where appropriate
* Access permissions
* Cleanup of abandoned files
* Large files
* Progress feedback

Never trust the file extension alone.

---

# 28. Background Jobs Need Failure Handling

For asynchronous work, think about:

* Job retries
* Duplicate execution
* Failed jobs
* Partial completion
* Timeouts
* Job visibility
* Dead-letter handling
* Idempotency
* Cancellation
* Progress
* Cleanup

Never assume a background job will always complete successfully.

---

# 29. Think About Deployment

Code that works locally is not automatically production-ready.

Consider:

* Environment variables
* Production configuration
* Build process
* Database migrations
* Secrets
* CORS
* HTTPS
* Logging
* Error handling
* Health checks
* Startup failures
* Dependency versions
* Rollback strategy
* Resource limits

Do not rely on undocumented local-machine configuration.

---

# 30. Testing Is Part of Implementation

When implementing meaningful functionality, think about what needs to be tested.

At minimum, consider:

* Happy path
* Validation failures
* Permission failures
* Empty states
* Error states
* Boundary conditions
* Duplicate actions
* Important business rules
* Regression cases

Do not write tests merely to increase coverage numbers.

Test behavior that matters.

---

# 31. Never Hide Problems

If you discover:

* An architectural problem
* A security issue
* A data-integrity problem
* A performance concern
* A broken existing workflow
* An ambiguous requirement
* A potentially destructive migration

do not silently work around it.

Surface the problem and explain the consequence.

If there is a safe assumption that can be made, make it explicit.

---

# 32. Question Ambiguous Requirements

Do not blindly implement ambiguous instructions when doing so could create the wrong product behavior.

When something is unclear, determine:

* What is the intended user behavior?
* What should happen in edge cases?
* Who is allowed to perform the action?
* What should happen to existing data?
* Is the operation reversible?
* What happens when it fails?

If clarification is necessary, ask a focused question rather than making a large hidden assumption.

---

# 33. Think in User Workflows, Not Isolated Screens

A good application is a collection of connected workflows.

For example:

Create → Review → Edit → Submit → Approve → Process → Complete

Think through the entire lifecycle.

Ask:

* Can the user get stuck?
* Can they go backward?
* Can they cancel?
* Can they resume later?
* What happens if something fails midway?
* What happens if another user changes the record?
* What happens after completion?

Every workflow should have a clear beginning, middle, and end.

---

# 34. Think About Permissions at Every Layer

For every important action, ask:

> "Who should be allowed to do this?"

Do not only hide buttons in the UI.

Authorization must be enforced server-side.

Also consider:

* Who can view it?
* Who can create it?
* Who can edit it?
* Who can delete it?
* Who can approve it?
* Who can export it?
* Who can see sensitive fields?

---

# 35. Don't Confuse "Works" With "Finished"

A feature is not finished when:

> "It works on my machine."

A feature is finished when:

* The intended workflow works.
* Errors are handled.
* Edge cases have been considered.
* Permissions are correct.
* Data remains consistent.
* UI states are intentional.
* Existing functionality has not been broken.
* The implementation fits the existing architecture.
* The code is maintainable.
* Security implications have been considered.
* Performance implications have been considered.
* Important behavior is tested.
* The feature makes sense from the user's perspective.

---

# 36. Perform a Final Production Review

Before considering a task complete, mentally perform a production review.

Ask:

### User

* Would a normal user understand this?
* Is anything confusing?
* Can they recover from mistakes?
* Are all states handled?

### Product

* Does this workflow make sense end-to-end?
* Does this behavior match the rest of the application?
* Are there unintended consequences?

### Engineering

* Is the code maintainable?
* Is the architecture appropriate?
* Is there unnecessary duplication?
* Did this change break another part of the system?

### Data

* Is existing data safe?
* Are transactions/constraints needed?
* What happens with invalid or legacy data?

### Security

* Can an unauthorized user access or modify this?
* Are inputs validated?
* Could sensitive information leak?

### Reliability

* What happens when the API fails?
* What happens when the network fails?
* What happens when an external service fails?
* What happens when the request is repeated?

### Performance

* What happens with a large dataset?
* Are there unnecessary requests or queries?
* Will this scale reasonably?

### Operations

* Can we diagnose failures?
* Are useful logs and metrics available?
* Can this be deployed safely?
* Can it be rolled back?

---

# 37. The Core Rule

Before writing code, think.

Before changing code, understand its dependencies.

Before declaring something complete, test the workflow mentally from the user's perspective.

Do not optimize for:

> "How quickly can I produce code?"

Optimize for:

> "How can I produce a production-quality implementation that behaves correctly across the realistic situations this application will encounter?"

The goal is not to produce the most code.

The goal is to produce the **right system behavior** with the smallest reasonable amount of well-structured code.

Always think beyond the immediate request.

Always consider what the user sees.

Always consider what the system does behind the scenes.

Always consider what happens when things go wrong.

Always consider what happens six months from now.

**Build as if this application is going into production today and real users will depend on it tomorrow.**