/** Return a copy of the board vocabulary with one column moved in display order. */
export function reorderKanbanColumns(
  columns: readonly string[],
  sourceIndex: number,
  destinationIndex: number,
): string[] {
  const reordered = [...columns];
  if (
    sourceIndex < 0
    || sourceIndex >= reordered.length
    || destinationIndex < 0
    || destinationIndex >= reordered.length
    || sourceIndex === destinationIndex
  ) {
    return reordered;
  }

  const [moved] = reordered.splice(sourceIndex, 1);
  reordered.splice(destinationIndex, 0, moved);
  return reordered;
}
