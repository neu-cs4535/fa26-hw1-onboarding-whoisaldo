# Gradebook column groups

## Band claim

**Distinction.** The backfill corrects three demonstrated heuristic failures, and instructors can create, rename, reorder and delete groups and move columns between them. Both group and column reordering preserve stored membership. The migration, course permissions, design writeup and rollback remain included.

## Part one: the design built

A column group lets an instructor scan related assessments together and collapse their detail while reviewing scores. A deleted quiz should not split its family into two headers, and the label should say which assessments it contains. A group therefore has an identity and a name independent of its members' slugs. An instructor can use Manage groups to change that organization without renaming assessments or altering grades.

I would ask Jonathan Bell to review the seeded gradebook before and after migration, specifically the four surviving quizzes, the final assessment and the AI usage logs. I would ask a grader to find Quiz 4, then ask an instructor to create a group, move two columns into it, rename it, reorder it and delete it. These are proposed validation sessions, not interviews already conducted. The browser test performs the editing workflow and checks persistence after reload.

I prioritized persistent membership, understandable labels and recoverable edits. A group belongs to one course and gradebook; the column's composite foreign key enforces that same scope even for service-role writes. Groups have their own integer order, while columns retain their existing order within a group. This extra order field allows empty groups to be positioned before they have members. The instructor display reads one group collection and one column collection, with no query per cell. Group edits use the existing table controllers and broadcasts; a validated database function commits group reordering atomically.

I chose explicit instructor edits over continuing to infer relationships at runtime. The backfill recognizes numbered slug families once, but cannot know a course's intended pedagogy. Unknown or malformed slugs get separate groups named from their column; newly created columns are unassigned until an instructor chooses a group. Unassigned columns appear after named groups. Deleting a group preserves columns and scores but discards its label and order. Group buttons and collapsed-group dragging reorder groups; column arrows reorder members within their group, and dragging an expanded column across a group boundary directs the instructor to Manage groups instead of silently changing membership. Student what-if grouping is unchanged and remains outside this instructor-table deliverable.

## Credit: demonstrated backfill failures

These cases were found by reading the legacy memo and the `cs4535` seed's `createColumnGroupFixtures`, then exercised in the database/browser integration fixture. The grading screenshots use the actual seeded course.

1. **A deleted quiz splits one family.** The seed creates `quiz-1` through `quiz-5`, then deletes `quiz-3`, leaving a gap in `sort_order`. The old consecutive-order check renders two Quiz blocks. The backfill groups the surviving numbered `quiz` family together regardless of gaps or interleaving. The test asserts equal group IDs for quizzes on both sides of a gap and a later repeated occurrence.
2. **A two-part assignment loses its type.** The old special case requires at least three slug components, so `assignment-final` is labeled Assignment. The importer accepts a nonempty assignment subtype with or without a numeric suffix and labels this group Final. The integration fixture asserts that exact label.
3. **A compound family loses its meaning.** `ai-usage-log-1` and `ai-usage-log-2` become Ai under the old first-component rule, losing usage-log and incorrectly capitalizing AI. The importer removes only the numeric suffix, retains the full family and stores AI Usage Log. The test checks that both columns share that group and label.

The migration leaves scores, expressions, slugs and column order unchanged. Its policy is deliberately conservative for unnumbered, unknown or malformed slugs: one group per column, using the existing display name. It does not guess that similarly named aggregates belong together. Instructors can explicitly combine them using the new controls. The service-role-only import helper skips already grouped gradebooks, preserving edits on repeated seed/import calls.

## Part two: a design for CS 2100

CS 2100 needs to represent **a topic assessed through multiple attempts**, not merely neighboring columns. An attempt can be an observation of a topic; a derived mastery column can summarize those observations. A separate expectation aggregate can summarize several topics. These are different relationships. Treating them all as one flat group would obscure which scores are evidence and which are computed conclusions. The twelve skill columns and three differently named expectation aggregates in the seed show why matching a string prefix cannot recover this structure.

I propose a topic-first instructor view with one summary column per topic. Expanding a topic would reveal its attempts in assessment order, with the assessment name and date visible. A mastery summary would be explicitly marked as computed and would show the inputs used when opened. A separate summary section would contain expectation-level aggregates, including aggregates that span several topics. An instructor could switch to the ordinary flat gradebook when entering scores across an entire assessment. A keyboard-operable expand button would announce its topic and expanded state; column headers would distinguish attempt scores from computed summaries. No attempt would disappear from export just because its topic was collapsed on screen.

The data model would add a course-scoped `gradebook_topics` table and a membership table relating topic IDs to existing column IDs, with an explicit role such as attempt or summary and an ordering field. A many-to-many membership table is warranted if one assessment column can assess several topics; I would validate that before requiring it. Computation would remain in the existing expressions and dependencies, not in a second grading engine. A dependency is evidence that a column contributes to another calculation, not proof that both belong to the same topic. Therefore migration would retain the groups implemented here as the default view, suggest topic mappings from dependencies where useful, and require an instructor to confirm ambiguous mappings. It would not infer mastery rules or move grades automatically.

For a 500-student course with 40 topics and four attempts per topic, there are roughly 80,000 attempt-score cells. Topic metadata is only about 40 topics and 160 memberships, so two course-level metadata queries are cheap relative to loading the scores. The collapsed view should fetch paginated student summary rows, then fetch attempt values for visible students only when a topic is expanded. That requires an indexed score query keyed by gradebook, column and student, plus batched requests rather than one request per cell. Existing materialized gradebook values should supply summaries; recomputing every student's expressions on each expand would be unacceptable. I would measure query counts, initial load time, expansion latency and payload size on a 500-student fixture before selecting batch sizes.

The instructor's setup cost is naming topics, mapping attempts and selecting the correct summary for each topic. A bulk mapping screen and a reusable course template could reduce repeated work, but suggested mappings would need review. Courses organized around independent assignments or projects should keep the flat grouped view and pay no topic-configuration cost. Forcing a topic hierarchy on those courses would add empty or misleading structure. Overlapping topics also mean the same underlying score could appear in more than one view; exports and editing must make that shared identity clear rather than duplicating grades.

I would ask the CS 2100 coordinator how retakes, missing attempts, excused work and mastery replacement actually behave, and whether one column can assess multiple topics. I would ask instructors and graders to complete both a topic-review task and an assessment-entry task using a prototype. I would ask students whether the distinction between evidence and the computed outcome is understandable, including with a screen reader. Finally, I would ask the platform maintainer to review dependency updates, RLS and the query plan under realistic load. Those answers could change the membership cardinality, summary presentation or default view before implementation.

## Migration and permissions

- Auto-layout updates column order and group order in one transaction. It applies the existing column layout, then places each group at its first member's new position. Empty groups follow populated groups in their previous relative order. Membership remains unchanged, and unassigned columns still appear after groups.
- Dragging an expanded column to either edge of its group reorders only that group's members, even when the stored global column order interleaves multiple groups. Drops inside a different group still require an explicit membership edit.
- The migration imports every existing gradebook in `(coalesce(sort_order, 0), id)` order. IDs break ties deterministically where the old client did not specify an order.
- Existing rows with inconsistent course/gradebook ownership cause the transaction to fail rather than silently reassigning grades.
- Numeric families retain membership across gaps and interleaving. Each group starts at its first member's order; instructor reordering replaces group positions atomically and never updates `group_id`. Empty and duplicate-name groups have distinct IDs and independent order/collapse state.
- `initialize_gradebook_column_groups` is an invoker-rights, service-role-only import helper. It locks the gradebook and skips one that already has groups, so a rerun cannot overwrite edits. The local seeder calls it after constructing its legacy fixture layout because seeding happens after migration replay.
- Staff can read their course's groups. Students can read only groups with at least one column visible to them under column RLS, so hidden-only groups do not leak their labels. Only instructors can insert, update or delete groups. Anonymous callers and other courses cannot read them. The import helper is not available to authenticated browser clients.
- Deleting a group clears only its members' `group_id`. It does not delete columns or scores. The instructor table shows unassigned columns independently.

## Verification

The existing grading screenshot test captures expanded and collapsed headers of the seeded CS4535 course. The additional integration test covers the three backfill fixes, repeated imports, names surviving a column rename, unassigned columns, instructor/grader/student permissions, cross-course foreign keys, invalid reorder payloads, and unchanged memberships under both reorder APIs. Its browser workflow creates and renames a group, assigns columns from another group and from the unassigned state, reorders it, reloads, then deletes it and checks that the columns survive. Two ordering regressions exercise real pointer drags at both group boundaries with interleaved stored column order, and Auto-layout through the instructor UI. They check the displayed order, database order, unchanged membership, permissions and persistence after reload. They run in the existing gradebook CI job, without relaxing that job's assertions.

Run the same checks as CI:

```sh
npx supabase start -x logflare,vector
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

Deploy the previous frontend first, then run `tests/manual/gradebook_column_groups_down.sql` against the intended database. The script is transactional, restores the previous Auto-layout function, and removes the new helper, membership column, group table and ownership constraint. Columns, expressions, ordering and scores are not removed. Back up the group table and `(id, group_id)` mappings first if instructors have edited groups: those labels and memberships cannot be recovered from slugs after rollback. For another rollout, apply a new forward migration rather than rewriting production migration history.
