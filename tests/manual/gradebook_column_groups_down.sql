-- Restore the old frontend before rolling back the schema. Group labels and
-- membership are discarded, but columns, sort orders, expressions and scores remain.
BEGIN;
DROP FUNCTION public.gradebook_column_groups_reorder(bigint, bigint[]);
DROP FUNCTION public.initialize_gradebook_column_groups(bigint);
DROP POLICY "class members read groups" ON public.gradebook_column_groups;
ALTER TABLE public.gradebook_columns DROP COLUMN group_id;
DROP TABLE public.gradebook_column_groups;
ALTER TABLE public.gradebooks DROP CONSTRAINT gradebooks_id_class_unique;
COMMIT;
