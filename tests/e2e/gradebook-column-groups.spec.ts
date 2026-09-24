/**
 * Grading artifact for the CS 4535 column-groups onboarding assignment.
 *
 * Twenty-four people solve the same problem independently, and the thing being compared is what
 * the gradebook's column headers end up looking like. This spec photographs that, against the
 * `cs4535` seed template, so one submission's headers can be put next to another's.
 *
 * It deliberately asserts almost nothing about *which* groups appear. Reproducing today's
 * grouping exactly is correct at Pass, and correcting it is the whole point of Credit, so a spec
 * that pinned the group names would fail precisely the submissions that did the most work. What
 * it does assert is that the gradebook still renders and still groups something — the floor every
 * band shares — and then captures the evidence for a human to read.
 *
 * Three artifacts per run:
 *   - `column-groups-expanded`    every group open: which column sits under which header
 *   - `column-groups-collapsed`   every group collapsed: the header row, which is the comparison
 *   - `column-group-headers.json` the same header text as text, so 24 submissions can be diffed
 *                                 rather than eyeballed
 *
 * Requires the seeded class: `npm run seed -- --template cs4535`. It reads that class rather than
 * building its own fixture, because the planted cases the assignment is about (the hole in
 * sort_order where quiz-3 was, `assignment-final`'s two slug parts) live in the template, not in
 * the generic test helpers.
 */
import { test, expect } from "../global-setup";
import { createClient } from "@supabase/supabase-js";
import {
  supabase,
  loginAsUser,
  createClass,
  createUsersInClass,
  createAuthenticatedClient,
  type TestingUser
} from "./TestingUtils";
import { visualScreenshot } from "./VisualTestUtils";
import type { Course } from "@/utils/supabase/DatabaseTypes";
import dotenv from "dotenv";
import type { Page } from "@playwright/test";

dotenv.config({ path: ".env.local", quiet: true });

const SEEDED_CLASS_NAME = process.env.COLUMN_GROUPS_CLASS_NAME ?? "CS 4535: Software Design & Delivery";

/** Resolve the seeded class, with an error that names the fix rather than a null dereference. */
async function findSeededClass(): Promise<Course> {
  const { data, error } = await supabase
    .from("classes")
    .select("*")
    .eq("name", SEEDED_CLASS_NAME)
    .order("id", { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(`Could not query classes: ${error.message}`);
  }
  if (!data?.length) {
    throw new Error(
      `No class named "${SEEDED_CLASS_NAME}". Run \`npm run seed -- --template cs4535\` first, ` +
        `or set COLUMN_GROUPS_CLASS_NAME to the class you want photographed.`
    );
  }
  return data[0] as Course;
}

/**
 * An instructor in that class to log in as. The seeder pins the first instructor to
 * FIXED_INSTRUCTOR_EMAIL when it is set, which is how CI gets a predictable account; without it,
 * fall back to whichever instructor the run happened to generate.
 */
async function findInstructor(class_id: number): Promise<TestingUser> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("user_id, private_profile_id, public_profile_id, users(email), profiles!private_profile_id(name)")
    .eq("class_id", class_id)
    .eq("role", "instructor")
    .limit(50);
  if (error) {
    throw new Error(`Could not query instructors for class ${class_id}: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as Array<{
    user_id: string;
    private_profile_id: string;
    public_profile_id: string;
    users: { email: string | null } | null;
    profiles: { name: string | null } | null;
  }>;
  const preferred = process.env.FIXED_INSTRUCTOR_EMAIL;
  const row = (preferred && rows.find((r) => r.users?.email === preferred)) || rows.find((r) => r.users?.email);
  if (!row?.users?.email) {
    throw new Error(`Class ${class_id} has no instructor with an email address to log in as.`);
  }

  return {
    private_profile_name: row.profiles?.name ?? "Instructor",
    public_profile_name: row.profiles?.name ?? "Instructor",
    email: row.users.email,
    user_id: row.user_id,
    private_profile_id: row.private_profile_id,
    public_profile_id: row.public_profile_id,
    class_id,
    password: process.env.TEST_PASSWORD ?? "change-it"
  };
}

test.describe("gradebook column groups", () => {
  // Wider than the default 1280 on purpose. The gradebook virtualizes horizontally, so the
  // viewport decides how much of it a screenshot contains, and at 1280 the tail is cut off —
  // which is where `attendance`, the `ai-usage-log-*` pair and `assignment-final` sit, three of
  // the cases the seed plants. Fixed rather than maximised so every submission's screenshot is
  // the same size and can be flipped through side by side.
  test.use({ viewport: { width: 2560, height: 1440 } });

  // A prod build of this page is slow to warm and the table is wide; the default 60s is not enough
  // to log in, load, collapse, expand and capture twice.
  test.setTimeout(180_000);

  test("photograph the grouped gradebook for grading", async ({ page }, testInfo) => {
    const course = await findSeededClass();
    const instructor = await findInstructor(course.id);

    await loginAsUser(page, instructor, course);
    await page.goto(`/course/${course.id}/manage/gradebook`);

    // The column headers are what this spec is about, so wait for them rather than for the page
    // heading — the heading paints before the table has columns in it.
    const headers = page.getByRole("columnheader");
    await expect(headers.first()).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => headers.count(), { timeout: 60_000, message: "gradebook never rendered its columns" })
      .toBeGreaterThan(5);

    const collapseAll = page.getByRole("button", { name: "Collapse all groups" });
    const expandAll = page.getByRole("button", { name: "Expand all groups" });

    // Both controls are asserted rather than probed: a submission that removed them has changed
    // the deliverable, and that deserves a named failure instead of a blank screenshot.
    await expect(collapseAll).toBeVisible({ timeout: 30_000 });
    await expect(expandAll).toBeVisible();

    const headerTexts = async () => (await page.getByRole("columnheader").allInnerTexts()).map((t) => t.trim());

    await expandAll.click();
    const expandedHeaders = await headerTexts();
    await visualScreenshot(page, "column-groups-expanded");

    await collapseAll.click();
    // Collapsing hides all but one column of each group, so which columns are on screen has to
    // change. Compare the header list, not its length: the table virtualizes horizontally, so the
    // count is set by how many columns fit in the viewport and stays put either way.
    //
    // This is the floor assertion and it is deliberately behavioural. It holds whatever a
    // submission renames the groups to, or however it rewrites the header markup, and it fails
    // only when nothing is grouped at all. Asserting the group *names* would fail exactly the
    // submissions that did the most work, since correcting today's grouping is what Credit asks
    // for.
    await expect
      .poll(async () => JSON.stringify(await headerTexts()), {
        timeout: 30_000,
        message: "collapsing every group changed nothing on screen, so the gradebook is grouping nothing"
      })
      .not.toBe(JSON.stringify(expandedHeaders));
    const collapsedHeaders = await headerTexts();
    await visualScreenshot(page, "column-groups-collapsed");

    // The app's own one-line summary of each group ("4 Labs...", and two "2 Quizzes..." where the
    // seeded quiz family is split by the hole in sort_order). Best-effort: it is read by text
    // shape, so a submission that renders its headers differently gets an empty list here rather
    // than a failure. The screenshots remain the primary artifact.
    const groupSummaries = await page.getByText(/^\d+\s+\S+\.\.\.$/).allInnerTexts();

    const report = {
      capturedAt: new Date().toISOString(),
      className: course.name,
      classId: course.id,
      commit: process.env.GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null,
      groupSummaries: groupSummaries.map((t) => t.trim()),
      expandedHeaderCount: expandedHeaders.length,
      collapsedHeaderCount: collapsedHeaders.length,
      expandedHeaders,
      collapsedHeaders
    };
    await testInfo.attach("column-group-headers.json", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json"
    });

    // eslint-disable-next-line no-console
    console.log(`Group headers when collapsed: ${groupSummaries.join(" | ") || "(none matched by text shape)"}`);
  });
});

test("groups fix backfill families and enforce course permissions", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 2560, height: 1440 });
  const course = await createClass();
  const otherCourse = await createClass();
  const [instructor, grader, student, outsider] = await createUsersInClass([
    { role: "instructor", class_id: course.id },
    { role: "grader", class_id: course.id },
    { role: "student", class_id: course.id },
    { role: "instructor", class_id: otherCourse.id }
  ]);
  const { data: books, error: bookError } = await supabase
    .from("gradebooks")
    .select("*")
    .in("class_id", [course.id, otherCourse.id]);
  expect(bookError).toBeNull();
  const book = books!.find((b) => b.class_id === course.id)!;
  const otherBook = books!.find((b) => b.class_id === otherCourse.id)!;
  // Includes a sort-order gap, a repeated prefix, a two-part assignment slug,
  // a compound family name and a blank assignment subtype.
  const layout = [
    ["quiz-1", 0],
    ["quiz-2", 1],
    ["quiz-4", 3],
    ["quiz-5", 4],
    ["assignment-lab-1", 5],
    ["assignment-lab-2", 6],
    ["assignment-final", 7],
    ["quiz-6", 8],
    ["assignment--1", 9],
    ["ai-usage-log-1", 10],
    ["ai-usage-log-2", 11]
  ] as const;
  for (const [slug, sort_order] of layout) {
    const { error } = await supabase.from("gradebook_columns").insert({
      class_id: course.id,
      gradebook_id: book.id,
      name: slug,
      slug,
      sort_order,
      max_score: 10
    });
    expect(error).toBeNull();
  }
  expect(
    (
      await supabase.from("gradebook_columns").insert({
        class_id: otherCourse.id,
        gradebook_id: otherBook.id,
        name: "Other quiz",
        slug: "quiz-1",
        max_score: 10
      })
    ).error
  ).toBeNull();
  for (const id of [book.id, otherBook.id, book.id]) {
    expect((await supabase.rpc("initialize_gradebook_column_groups", { target_gradebook_id: id })).error).toBeNull();
  }
  const { data: columns, error } = await supabase
    .from("gradebook_columns")
    .select("id, group_id, gradebook_column_groups(name)")
    .eq("gradebook_id", book.id)
    .order("sort_order");
  expect(error).toBeNull();
  expect(columns!.map((c) => c.gradebook_column_groups?.name)).toEqual([
    "Quiz",
    "Quiz",
    "Quiz",
    "Quiz",
    "Lab",
    "Lab",
    "Final",
    "Quiz",
    "assignment--1",
    "AI Usage Log",
    "AI Usage Log"
  ]);
  expect(columns![0].group_id).toBe(columns![1].group_id);
  expect(columns![2].group_id).toBe(columns![3].group_id);
  expect(columns![0].group_id).toBe(columns![2].group_id);
  expect(columns![0].group_id).toBe(columns![7].group_id);
  expect(new Set(columns!.map((c) => c.group_id)).size).toBe(5);
  const groupId = columns![0].group_id!;
  const { data: foreignGroups } = await supabase
    .from("gradebook_column_groups")
    .select("id")
    .eq("gradebook_id", otherBook.id);
  const foreignGroupId = foreignGroups![0].id;
  const clients = await Promise.all([instructor, grader, student, outsider].map(createAuthenticatedClient));
  const [teacher, staff, learner, stranger] = clients;
  const anonymous = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  expect((await anonymous.from("gradebook_column_groups").select("id").eq("gradebook_id", book.id)).data).toEqual([]);

  for (const client of clients.slice(0, 3)) {
    const { data, error: readError } = await client
      .from("gradebook_column_groups")
      .select("id")
      .eq("gradebook_id", book.id);
    expect(readError).toBeNull();
    expect(data).toHaveLength(5);
    expect(
      (await client.rpc("initialize_gradebook_column_groups", { target_gradebook_id: book.id })).error
    ).not.toBeNull();
  }
  expect((await stranger.from("gradebook_column_groups").select("id").eq("gradebook_id", book.id)).data).toEqual([]);
  for (const client of clients.slice(1)) {
    expect(
      (
        await client.from("gradebook_column_groups").insert({
          class_id: course.id,
          gradebook_id: book.id,
          name: "Forbidden"
        })
      ).error
    ).not.toBeNull();
    expect(
      (await client.from("gradebook_column_groups").update({ name: "Forbidden" }).eq("id", groupId).select("id")).data
    ).toEqual([]);
    expect((await client.from("gradebook_column_groups").delete().eq("id", groupId).select("id")).data).toEqual([]);
  }
  const currentIds = [...new Set(columns!.map((c) => c.group_id!))];
  for (const client of [staff, learner, stranger, anonymous]) {
    expect(
      (await client.rpc("gradebook_column_groups_reorder", { p_gradebook_id: book.id, p_group_ids: currentIds })).error
    ).not.toBeNull();
    const before = columns![0].group_id;
    await client.from("gradebook_columns").update({ group_id: null }).eq("id", columns![0].id);
    expect(
      (await teacher.from("gradebook_columns").select("group_id").eq("id", columns![0].id).single()).data?.group_id
    ).toBe(before);
  }
  for (const invalid of [
    currentIds.slice(1),
    [...currentIds, currentIds[0]],
    [...currentIds.slice(1), foreignGroupId]
  ]) {
    expect(
      (await teacher.rpc("gradebook_column_groups_reorder", { p_gradebook_id: book.id, p_group_ids: invalid })).error
    ).not.toBeNull();
  }
  const membership = columns!.map(({ id, group_id }) => ({ id, group_id })).sort((a, b) => a.id - b.id);
  expect(
    (
      await teacher.rpc("gradebook_column_groups_reorder", {
        p_gradebook_id: book.id,
        p_group_ids: [...currentIds].reverse()
      })
    ).error
  ).toBeNull();
  expect(
    (await teacher.from("gradebook_columns").select("id,group_id").eq("gradebook_id", book.id).order("id")).data
  ).toEqual(membership);
  expect(
    (await teacher.rpc("gradebook_columns_reorder", { p_ordered_column_ids: columns!.map((c) => c.id).reverse() }))
      .error
  ).toBeNull();
  expect(
    (await teacher.from("gradebook_columns").select("id,group_id").eq("gradebook_id", book.id).order("id")).data
  ).toEqual(membership);
  const { data: hiddenGroup, error: createError } = await teacher
    .from("gradebook_column_groups")
    .insert({
      class_id: course.id,
      gradebook_id: book.id,
      name: "Staff-only topic"
    })
    .select("id")
    .single();
  expect(createError).toBeNull();
  const { data: hiddenColumn, error: hiddenError } = await teacher
    .from("gradebook_columns")
    .insert({
      class_id: course.id,
      gradebook_id: book.id,
      group_id: hiddenGroup!.id,
      name: "Private assessment",
      slug: "private",
      instructor_only: true,
      max_score: 10
    })
    .select("id")
    .single();
  expect(hiddenError).toBeNull();
  expect((await learner.from("gradebook_column_groups").select("id").eq("id", hiddenGroup!.id)).data).toEqual([]);
  expect((await staff.from("gradebook_column_groups").select("id").eq("id", hiddenGroup!.id)).data).toHaveLength(1);
  expect((await teacher.from("gradebook_column_groups").delete().eq("id", hiddenGroup!.id)).error).toBeNull();
  expect(
    (await teacher.from("gradebook_columns").select("group_id").eq("id", hiddenColumn!.id).single()).data?.group_id
  ).toBeNull();
  // Even the service role cannot create inconsistent course/gradebook membership.
  expect(
    (
      await supabase.from("gradebook_column_groups").insert({
        class_id: course.id,
        gradebook_id: otherBook.id,
        name: "Wrong course"
      })
    ).error?.code
  ).toBe("23503");
  expect(
    (await teacher.from("gradebook_columns").update({ group_id: foreignGroupId }).eq("id", columns![0].id)).error?.code
  ).toBe("23503");
  expect(
    (await teacher.from("gradebook_column_groups").update({ name: "Persisted topic" }).eq("id", groupId)).error
  ).toBeNull();
  expect(
    (await teacher.from("gradebook_columns").update({ name: "Renamed quiz" }).eq("id", columns![0].id)).error
  ).toBeNull();
  expect((await supabase.rpc("initialize_gradebook_column_groups", { target_gradebook_id: book.id })).error).toBeNull();
  expect(
    (await teacher.from("gradebook_columns").select("group_id").eq("id", columns![0].id).single()).data?.group_id
  ).toBe(groupId);
  expect(
    (
      await teacher.from("gradebook_columns").insert({
        class_id: course.id,
        gradebook_id: book.id,
        name: "New standalone column",
        slug: "quiz-new",
        max_score: 10
      })
    ).error
  ).toBeNull();
  await loginAsUser(page, instructor, course);
  await page.goto(`/course/${course.id}/manage/gradebook`);
  await expect(page.getByRole("button", { name: "Expand all groups" })).toBeVisible();
  await page.getByRole("button", { name: "Collapse all groups" }).click();
  await expect(page.getByText("5 Persisted topics...", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Expand all groups" }).click();
  await expect(page.getByRole("columnheader", { name: /New standalone column/ })).toBeVisible();
  await page.getByRole("button", { name: "Manage groups", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manage column groups" });
  await dialog.getByRole("textbox", { name: "Group name", exact: true }).fill("Coursework");
  await dialog.getByRole("button", { name: "Create group", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Rename group", exact: true })).toBeEnabled();
  const picker = dialog.getByRole("combobox", { name: "Selected group", exact: true });
  const createdId = Number(await picker.inputValue());
  const assignment = dialog.getByRole("combobox", { name: "Group for New standalone column", exact: true });
  await assignment.selectOption(String(createdId));
  await expect(assignment).toBeEnabled();
  await dialog.getByRole("combobox", { name: "Group for Renamed quiz", exact: true }).selectOption(String(createdId));
  await expect(assignment).toBeEnabled();
  await dialog.getByRole("textbox", { name: "Group name", exact: true }).fill("Portfolio");
  await dialog.getByRole("button", { name: "Rename group", exact: true }).click();
  await expect(picker.locator("option:checked")).toHaveText("Portfolio");
  await expect(dialog.getByRole("button", { name: "Move group up", exact: true })).toBeEnabled();
  await visualScreenshot(page, "column-groups-management");
  const scoresBeforeDelete = (
    await teacher
      .from("gradebook_column_students")
      .select("id,gradebook_column_id,score,score_override")
      .eq("class_id", course.id)
      .order("id")
  ).data;
  const beforeMove = (
    await teacher.from("gradebook_columns").select("id,group_id").eq("gradebook_id", book.id).order("id")
  ).data;
  const beforeOrder = await picker
    .locator("option")
    .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
  await dialog.getByRole("button", { name: "Move group up", exact: true }).click();
  await expect
    .poll(() => picker.locator("option").evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value)))
    .not.toEqual(beforeOrder);
  await expect(dialog.getByRole("button", { name: "Move group down", exact: true })).toBeEnabled();
  expect(
    (await teacher.from("gradebook_columns").select("id,group_id").eq("gradebook_id", book.id).order("id")).data
  ).toEqual(beforeMove);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Collapse all groups" }).click();
  await expect(page.getByText("2 Portfolios...", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Manage groups", exact: true }).click();
  await picker.selectOption(String(createdId));
  await dialog.getByRole("button", { name: "Delete group", exact: true }).click();
  await dialog.getByRole("button", { name: "Confirm delete group", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeEnabled();
  await expect(dialog.getByRole("textbox", { name: "Group name", exact: true })).toHaveValue("");
  expect(
    (
      await teacher
        .from("gradebook_column_students")
        .select("id,gradebook_column_id,score,score_override")
        .eq("class_id", course.id)
        .order("id")
    ).data
  ).toEqual(scoresBeforeDelete);
  expect((await teacher.from("gradebook_columns").select("id").eq("gradebook_id", book.id)).data).toHaveLength(
    beforeMove!.length
  );
  expect(
    (await teacher.from("gradebook_columns").select("group_id").eq("id", columns![0].id).single()).data?.group_id
  ).toBeNull();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Expand all groups" }).click();
  await expect(page.getByRole("columnheader", { name: /New standalone column/ })).toBeVisible();
});

async function createGroupOrderingFixture() {
  const course = await createClass();
  const [instructor, student, grader] = await createUsersInClass([
    { role: "instructor", class_id: course.id },
    { role: "student", class_id: course.id },
    { role: "grader", class_id: course.id }
  ]);
  const teacher = await createAuthenticatedClient(instructor);
  const { data: book, error: bookError } = await teacher
    .from("gradebooks")
    .select("id")
    .eq("class_id", course.id)
    .single();
  expect(bookError).toBeNull();
  const { data: groups, error: groupError } = await teacher
    .from("gradebook_column_groups")
    .insert(
      ["Beta", "Empty first", "Alpha", "Empty second"].map((name, sort_order) => ({
        gradebook_id: book!.id,
        class_id: course.id,
        name,
        sort_order
      }))
    )
    .select("*");
  expect(groupError).toBeNull();
  const alpha = groups!.find((g) => g.name === "Alpha")!;
  const beta = groups!.find((g) => g.name === "Beta")!;
  const columns = [];
  // Interleave the database order while groups display as Beta then Alpha.
  for (const [name, slug, group_id] of [
    ["Alpha 1", "alpha-1", alpha.id],
    ["Beta 1", "beta-1", beta.id],
    ["Alpha 2", "alpha-2", alpha.id],
    ["Beta 2", "beta-2", beta.id]
  ] as const) {
    const { data: column, error } = await teacher
      .from("gradebook_columns")
      .insert({
        gradebook_id: book!.id,
        class_id: course.id,
        name,
        slug,
        group_id,
        sort_order: columns.length,
        max_score: 10
      })
      .select("id,group_id,name")
      .single();
    expect(error).toBeNull();
    columns.push(column!);
  }
  return { course, instructor, student, grader, teacher, book: book!, groups: groups!, columns };
}

async function dragColumnToGap(page: Page, columnId: number, gapIndex: number) {
  const handle = page
    .locator(`[data-col-id="grade_${columnId}"]`)
    .getByRole("button", { name: "Drag to reorder column" });
  await expect(handle).toBeVisible();
  const source = (await handle.boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2, { steps: 4 });
  const gap = page.locator(`[data-gradebook-gap-index="${gapIndex}"]`);
  await expect(gap).toBeVisible();
  const target = (await gap.boundingBox())!;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 });
  await page.mouse.up();
}

test("column dragging handles both group boundaries with interleaved stored order", async ({ page }) => {
  test.setTimeout(180_000);
  const { course, instructor, teacher, book, columns } = await createGroupOrderingFixture();
  const [a1, b1, a2, b2] = columns;
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginAsUser(page, instructor, course);
  await page.goto(`/course/${course.id}/manage/gradebook`);
  await page.getByRole("button", { name: "Expand all groups" }).click();
  const headers = page.getByRole("region", { name: "Instructor Gradebook Table" }).locator('[data-col-id^="grade_"]');
  const headerIds = () =>
    headers.evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-col-id")!.slice(6))));
  const storedOrder = async () => {
    const { data, error } = await teacher
      .from("gradebook_columns")
      .select("id,group_id")
      .eq("gradebook_id", book.id)
      .order("sort_order");
    expect(error).toBeNull();
    return data!;
  };
  await expect.poll(headerIds).toEqual([b1.id, b2.id, a1.id, a2.id]);

  // The gap after Beta 2 is also the gap before Alpha 1.
  await dragColumnToGap(page, b1.id, 2);
  await expect.poll(headerIds).toEqual([b2.id, b1.id, a1.id, a2.id]);
  expect(await storedOrder()).toEqual([a1, b2, a2, b1].map(({ id, group_id }) => ({ id, group_id })));

  await dragColumnToGap(page, b1.id, 0);
  await expect.poll(headerIds).toEqual([b1.id, b2.id, a1.id, a2.id]);
  const beforeInvalidDrop = await storedOrder();
  // An interior gap in Alpha is still rejected instead of changing membership.
  await dragColumnToGap(page, b1.id, 3);
  // The shared visual-test CSS hides toasts, so assert their DOM presence.
  await expect(page.getByText("Use Manage groups to change a column's group", { exact: true })).toBeAttached();
  expect(await storedOrder()).toEqual(beforeInvalidDrop);
  await page.reload();
  await page.getByRole("button", { name: "Expand all groups" }).click();
  await expect.poll(headerIds).toEqual([b1.id, b2.id, a1.id, a2.id]);
});

test("auto-layout orders persisted groups and members without changing membership", async ({ page }) => {
  test.setTimeout(180_000);
  const { course, instructor, student, grader, teacher, book, columns } = await createGroupOrderingFixture();
  const [a1, b1, a2, b2] = columns;
  for (const user of [student, grader]) {
    const client = await createAuthenticatedClient(user);
    expect((await client.rpc("gradebook_auto_layout", { p_gradebook_id: book.id })).error?.code).toBe("42501");
  }
  const otherCourse = await createClass();
  const [outsider] = await createUsersInClass([{ role: "instructor", class_id: otherCourse.id }]);
  const stranger = await createAuthenticatedClient(outsider);
  expect((await stranger.rpc("gradebook_auto_layout", { p_gradebook_id: book.id })).error?.code).toBe("42501");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginAsUser(page, instructor, course);
  await page.goto(`/course/${course.id}/manage/gradebook`);
  await page.getByRole("button", { name: "Expand all groups" }).click();
  const headers = page.getByRole("region", { name: "Instructor Gradebook Table" }).locator('[data-col-id^="grade_"]');
  const headerIds = () =>
    headers.evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-col-id")!.slice(6))));
  await expect.poll(headerIds).toEqual([b1.id, b2.id, a1.id, a2.id]);
  await page.getByRole("button", { name: "Auto-layout columns", exact: true }).click();
  await expect(page.getByText("Auto-layout complete", { exact: true })).toBeAttached();
  await expect.poll(headerIds).toEqual([a1.id, a2.id, b1.id, b2.id]);
  const { data: orderedGroups, error: groupError } = await teacher
    .from("gradebook_column_groups")
    .select("name")
    .eq("gradebook_id", book.id)
    .order("sort_order");
  expect(groupError).toBeNull();
  expect(orderedGroups!.map((g) => g.name)).toEqual(["Alpha", "Beta", "Empty first", "Empty second"]);
  const { data: members, error: memberError } = await teacher
    .from("gradebook_columns")
    .select("id,group_id")
    .eq("gradebook_id", book.id)
    .order("sort_order");
  expect(memberError).toBeNull();
  expect(members).toEqual([a1, a2, b1, b2].map(({ id, group_id }) => ({ id, group_id })));
  await page.reload();
  await page.getByRole("button", { name: "Expand all groups" }).click();
  await expect.poll(headerIds).toEqual([a1.id, a2.id, b1.id, b2.id]);
});
