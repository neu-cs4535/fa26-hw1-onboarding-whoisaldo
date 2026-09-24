# Gradebook column groups

## Band claim

**Pass.** This change persists the current grouping, backfills existing gradebooks, applies course-scoped RLS, and makes the instructor table read group records. It does not claim to correct the heuristic or provide group-editing controls.

## Part one: the design built

A column group lets an instructor scan and collapse a related set of assessments without losing the individual scores. In the current gradebook, that means reducing a wide row of labs, assignments, quizzes and skills to recognizable blocks. Removing those blocks would make instructors scroll through many more headers to locate a grade. This migration preserves those blocks rather than deciding that matching slugs establish a pedagogical relationship.

I would ask Jonathan Bell, as both the course instructor and a Pawtograder maintainer, to compare the seeded gradebook's expanded and collapsed screenshots before and after migration. I would put the two separate Quiz blocks and the Assignment header for `assignment-final` in front of him explicitly: preserving those oddities is deliberate at Pass. I would also ask a grader to locate Quiz 4 and expand its block. These are proposed validation sessions, not interviews I have conducted.

For instructors, I prioritized unchanged initial headers and stable membership independent of column names. For maintainers, I prioritized a small relational model with enforceable ownership: a group belongs to one gradebook and course, and a column has at most one group in that same scope. The composite foreign keys enforce both relationships even when a caller bypasses RLS with a service credential. Group order and member order reuse existing column `sort_order`, with the first member determining a group's position. One extra group query per gradebook and a map lookup per column are enough; no per-student or per-column group queries are added. The existing controller handles readiness, caching, staff broadcasts and reconnects.

I chose compatibility over correcting misleading names and split families. That includes allowing an empty stored name because `assignment--1` produced a blank legacy header. I chose one group per column over overlapping categories and reused existing ordering rather than adding a second order field that could disagree with it. Newly created columns have no group and render as single columns; this change deliberately does not keep guessing from slugs after migration. Assigning those columns and managing groups through the UI are future work. The student what-if display still uses its existing grouping, and the existing instructor collapse state still treats equal display names together. Neither behavior is being silently redesigned here.

## Part two: a design for CS 2100

CS 2100 needs to represent **a topic assessed through multiple attempts**, not merely neighboring columns. An attempt can be an observation of a topic; a derived mastery column can summarize those observations. A separate expectation aggregate can summarize several topics. These are different relationships. Treating them all as one flat group would obscure which scores are evidence and which are computed conclusions. The twelve skill columns and three differently named expectation aggregates in the seed show why matching a string prefix cannot recover this structure.

I propose a topic-first instructor view with one summary column per topic. Expanding a topic would reveal its attempts in assessment order, with the assessment name and date visible. A mastery summary would be explicitly marked as computed and would show the inputs used when opened. A separate summary section would contain expectation-level aggregates, including aggregates that span several topics. An instructor could switch to the ordinary flat gradebook when entering scores across an entire assessment. A keyboard-operable expand button would announce its topic and expanded state; column headers would distinguish attempt scores from computed summaries. No attempt would disappear from export just because its topic was collapsed on screen.

The data model would add a course-scoped `gradebook_topics` table and a membership table relating topic IDs to existing column IDs, with an explicit role such as attempt or summary and an ordering field. A many-to-many membership table is warranted if one assessment column can assess several topics; I would validate that before requiring it. Computation would remain in the existing expressions and dependencies, not in a second grading engine. A dependency is evidence that a column contributes to another calculation, not proof that both belong to the same topic. Therefore migration would retain the groups implemented here as the default view, suggest topic mappings from dependencies where useful, and require an instructor to confirm ambiguous mappings. It would not infer mastery rules or move grades automatically.

For a 500-student course with 40 topics and four attempts per topic, there are roughly 80,000 attempt-score cells. Topic metadata is only about 40 topics and 160 memberships, so two course-level metadata queries are cheap relative to loading the scores. The collapsed view should fetch paginated student summary rows, then fetch attempt values for visible students only when a topic is expanded. That requires an indexed score query keyed by gradebook, column and student, plus batched requests rather than one request per cell. Existing materialized gradebook values should supply summaries; recomputing every student's expressions on each expand would be unacceptable. I would measure query counts, initial load time, expansion latency and payload size on a 500-student fixture before selecting batch sizes.

The instructor's setup cost is naming topics, mapping attempts and selecting the correct summary for each topic. A bulk mapping screen and a reusable course template could reduce repeated work, but suggested mappings would need review. Courses organized around independent assignments or projects should keep the flat grouped view and pay no topic-configuration cost. Forcing a topic hierarchy on those courses would add empty or misleading structure. Overlapping topics also mean the same underlying score could appear in more than one view; exports and editing must make that shared identity clear rather than duplicating grades.

I would ask the CS 2100 coordinator how retakes, missing attempts, excused work and mastery replacement actually behave, and whether one column can assess multiple topics. I would ask instructors and graders to complete both a topic-review task and an assessment-entry task using a prototype. I would ask students whether the distinction between evidence and the computed outcome is understandable, including with a screen reader. Finally, I would ask the platform maintainer to review dependency updates, RLS and the query plan under realistic load. Those answers could change the membership cardinality, summary presentation or default view before implementation.

## Migration and permissions

- The migration imports every existing gradebook in `(coalesce(sort_order, 0), id)` order. IDs break ties deterministically where the old client did not specify an order.
- Existing rows with inconsistent course/gradebook ownership cause the transaction to fail rather than silently reassigning grades.
- Contiguous prefix runs retain their legacy names and membership. Gaps and separated occurrences remain distinct groups, including the two Quiz groups in the seed.
- `initialize_gradebook_column_groups` is an invoker-rights, service-role-only import helper. It locks the gradebook and skips one that already has groups, so a rerun cannot overwrite edits. The local seeder calls it after constructing its legacy fixture layout because seeding happens after migration replay.
- Staff can read their course's groups. Students can read only groups with at least one column visible to them under column RLS, so hidden-only groups do not leak their labels. Only instructors can insert, update or delete groups. Anonymous callers and other courses cannot read them. The import helper is not available to authenticated browser clients.
- Deleting a group clears only its members' `group_id`. It does not delete columns or scores. The instructor table shows unassigned columns independently.

## Verification

The existing grading screenshot test captures expanded and collapsed headers. The additional integration test covers explicit backfill boundaries, repeated imports, persisted group names after a column rename, unassigned columns, instructor/grader/student permissions, and cross-course foreign keys. It runs in the existing gradebook CI job, without relaxing that job's assertions.

Run the same checks as CI:

```sh
npx supabase start -x analytics,vector
npx supabase db reset
npm run client-local
npm run seed -- --template cs4535
npm run format
npm run lint
npm run test:functions
npm run build
# In separate terminals, with local .env.local configured:
npx supabase functions serve --env-file .env.local
PORT=3001 npm run start
BASE_URL=http://localhost:3001 npx playwright test --project=chromium \
  tests/e2e/gradebook-column-groups.spec.ts \
  tests/e2e/gradebook.test.tsx \
  tests/e2e/gradebook-whatif.test.tsx \
  tests/e2e/gradebook-calculations.test.tsx
```

Maintain current audit partitions with `SELECT public.audit_maintain_partitions();` after a fresh reset, as required by this repository. Use the local development environment and dummy integration credentials described in `AGENTS.md`, not production credentials.

## Rollback

Deploy the previous frontend first, then run `tests/manual/gradebook_column_groups_down.sql` against the intended database. The script is transactional and removes the new helper, membership column, group table and ownership constraint. Columns, expressions, ordering and scores are not removed. Back up the group table and `(id, group_id)` mappings first if instructors have edited groups: those labels and memberships cannot be recovered from slugs after rollback. For another rollout, apply a new forward migration rather than rewriting production migration history.
