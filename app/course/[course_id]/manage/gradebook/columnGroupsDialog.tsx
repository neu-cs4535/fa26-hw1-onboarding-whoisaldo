"use client";

import { useState } from "react";
import { Box, Button, Dialog, HStack, Input, NativeSelect, Portal, Text, VStack } from "@chakra-ui/react";
import { useGradebookColumnGroups, useGradebookColumns, useGradebookController } from "@/hooks/useGradebook";
import { createClient } from "@/utils/supabase/client";
import { toaster } from "@/components/ui/toaster";

export default function ColumnGroupsDialog() {
  const controller = useGradebookController();
  const groups = [...useGradebookColumnGroups()].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const columns = [...useGradebookColumns()].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const group = groups.find((g) => g.id === selected);

  async function save(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await Promise.all([controller.gradebook_column_groups.refetchAll(), controller.gradebook_columns.refetchAll()]);
    } catch (error) {
      toaster.error({
        title: "Could not save groups",
        description: error && typeof error === "object" && "message" in error ? String(error.message) : String(error)
      });
    } finally {
      setBusy(false);
    }
  }

  async function move(offset: number) {
    const ids = groups.map((g) => g.id);
    const index = ids.indexOf(selected!);
    [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
    const { error } = await createClient().rpc("gradebook_column_groups_reorder", {
      p_gradebook_id: controller.gradebook_id,
      p_group_ids: ids
    });
    if (error) throw error;
  }

  return (
    <Dialog.Root open={open} onOpenChange={({ open }) => setOpen(open)} size="lg">
      <Dialog.Trigger asChild>
        <Button variant="outline" size="sm">
          Manage groups
        </Button>
      </Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Manage column groups</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              <VStack align="stretch" gap={4}>
                <Text fontSize="sm">
                  Group order is separate from column order. Moving a group keeps all its members. Unassigned columns
                  appear after groups.
                </Text>
                <NativeSelect.Root disabled={busy}>
                  <NativeSelect.Field
                    aria-label="Selected group"
                    value={selected ?? ""}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      setSelected(id);
                      setName(groups.find((g) => g.id === id)?.name ?? "");
                      setDeleting(false);
                    }}
                  >
                    <option value="">New group</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
                <Input aria-label="Group name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
                <HStack flexWrap="wrap">
                  <Button
                    disabled={busy || !name.trim()}
                    onClick={() =>
                      save(async () => {
                        if (group) await controller.gradebook_column_groups.update(group.id, { name: name.trim() });
                        else {
                          const created = await controller.gradebook_column_groups.create({
                            gradebook_id: controller.gradebook_id,
                            class_id: controller.class_id,
                            name: name.trim(),
                            sort_order: Math.max(-1, ...groups.map((g) => g.sort_order)) + 1
                          });
                          setSelected(created.id);
                        }
                      })
                    }
                  >
                    {group ? "Rename group" : "Create group"}
                  </Button>
                  {group && (
                    <>
                      <Button disabled={busy || groups[0]?.id === group.id} onClick={() => save(() => move(-1))}>
                        Move group up
                      </Button>
                      <Button disabled={busy || groups.at(-1)?.id === group.id} onClick={() => save(() => move(1))}>
                        Move group down
                      </Button>
                      <Button colorPalette="red" variant="outline" disabled={busy} onClick={() => setDeleting(true)}>
                        Delete group
                      </Button>
                    </>
                  )}
                </HStack>
                {group && deleting && (
                  <Box borderWidth="1px" p={3}>
                    <Text>Delete {group.name}? Its columns and scores will remain, with no group.</Text>
                    <HStack mt={2}>
                      <Button
                        colorPalette="red"
                        disabled={busy}
                        onClick={() =>
                          save(async () => {
                            await controller.gradebook_column_groups.hardDelete(group.id);
                            setSelected(null);
                            setName("");
                            setDeleting(false);
                          })
                        }
                      >
                        Confirm delete group
                      </Button>
                      <Button variant="outline" disabled={busy} onClick={() => setDeleting(false)}>
                        Cancel delete
                      </Button>
                    </HStack>
                  </Box>
                )}
                <Text fontWeight="semibold">Column membership</Text>
                <VStack align="stretch" maxH="40vh" overflowY="auto">
                  {columns.map((col) => (
                    <HStack key={col.id} justify="space-between">
                      <Text flex="1" fontSize="sm">
                        {col.name}
                      </Text>
                      <NativeSelect.Root width="55%" disabled={busy}>
                        <NativeSelect.Field
                          aria-label={`Group for ${col.name}`}
                          value={col.group_id ?? ""}
                          onChange={(e) => {
                            const group_id = e.target.value ? Number(e.target.value) : null;
                            void save(() => controller.gradebook_columns.update(col.id, { group_id }));
                          }}
                        >
                          <option value="">Unassigned</option>
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    </HStack>
                  ))}
                </VStack>
              </VStack>
            </Dialog.Body>
            <Dialog.Footer>
              <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
                Done
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
