// ./components/KanbanBoard.tsx
import React, { useState } from "react";
import { Box, Typography, IconButton, Tooltip } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import type { DropResult } from "@hello-pangea/dnd";
import { Ticket } from "../interfaces";
import TicketCard from "./TicketCard";
import { TICKET_STATUSES } from "../ticketVocab";
import { reorderKanbanColumns } from "../kanbanColumns";

const COLUMN_DROP_TYPE = "COLUMN";
const TICKET_DROP_TYPE = "TICKET";
const COLUMN_DROPPABLE_ID = "kanban-columns";

interface KanbanBoardProps {
  tickets: Ticket[];
  /** Ordered statuses selected in the current user's board preference. */
  columns?: string[];
  /** Persist a new left-to-right status order for the current user. */
  onColumnsReorder: (columns: string[]) => void | Promise<void>;
  onStatusChange: (ticketId: number, newStatus: string) => void;
  onTicketClick: (ticket: Ticket) => void;
  /** Close a ticket — invoked after its fall-off animation finishes. */
  onTicketClose: (ticketId: number) => void;
  selectionEnabled?: boolean;
  selectedIds?: Set<number>;
  onToggleTicketSelected?: (ticketId: number) => void;
}

// The card tips up, then drops off the bottom of the board on close.
const fallOff = keyframes({
  "0%": { transform: "translateY(0) rotate(0deg)", opacity: 1 },
  "15%": { transform: "translateY(-10px) rotate(-4deg)", opacity: 1 },
  "100%": { transform: "translateY(460px) rotate(16deg)", opacity: 0 },
});

const KanbanBoard: React.FC<KanbanBoardProps> = ({
  tickets,
  columns,
  onColumnsReorder,
  onStatusChange,
  onTicketClick,
  onTicketClose,
  selectionEnabled = false,
  selectedIds = new Set<number>(),
  onToggleTicketSelected,
}) => {
  // Ids mid-animation. They stay opacity:0 (animation fills forwards) until the
  // parent drops them from the list, so there's no flash-back before unmount.
  const [closing, setClosing] = useState<Set<number>>(new Set());
  const [savingColumnOrder, setSavingColumnOrder] = useState(false);
  const beginClose = (id: number) =>
    setClosing((prev) => new Set(prev).add(id));

  // "Closed" isn't a working column — closing makes a card fall off the board.
  // We only show a Closed column when closed tickets are actually loaded (i.e.
  // the user opted into them via the advanced search "include closed").
  const hasClosed = tickets.some((t) => t.status === "Closed");
  const preferredStatuses = columns?.length
    ? columns.filter((status) => (TICKET_STATUSES as readonly string[]).includes(status))
    : TICKET_STATUSES;
  const statuses = preferredStatuses.filter((status) =>
    status !== "Closed" || hasClosed || columns?.includes("Closed")
  );

  const ticketsByStatus = statuses.reduce((acc, status) => {
    acc[status] = tickets.filter((ticket) => ticket.status === status);
    return acc;
  }, {} as { [key: string]: Ticket[] });

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const { source, destination, draggableId, type } = result;

    if (type === COLUMN_DROP_TYPE) {
      if (source.index === destination.index) return;
      const reordered = reorderKanbanColumns(statuses, source.index, destination.index);
      setSavingColumnOrder(true);
      void Promise.resolve(onColumnsReorder(reordered)).finally(() => setSavingColumnOrder(false));
      return;
    }

    if (source.droppableId !== destination.droppableId) {
      onStatusChange(Number(draggableId), destination.droppableId);
    }
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      {/* At lg+ columns flex to share the available width so the board fills the
          page with no horizontal scrollbar (minWidth:0 lets them shrink past their
          content). Below lg the fluid columns would squeeze past legibility and
          clip the rightmost statuses, so we switch to fixed-width columns and let
          the board scroll horizontally instead. */}
      <Droppable droppableId={COLUMN_DROPPABLE_ID} direction="horizontal" type={COLUMN_DROP_TYPE}>
        {(columnsProvided) => (
          <Box
            ref={columnsProvided.innerRef}
            {...columnsProvided.droppableProps}
            sx={{
              display: "flex",
              gap: 2,
              pb: 1,
              width: "100%",
              overflowX: { xs: "auto", lg: "visible" },
            }}
          >
            {statuses.map((status, columnIndex) => (
              <Draggable
                draggableId={`column:${status}`}
                index={columnIndex}
                isDragDisabled={savingColumnOrder}
                disableInteractiveElementBlocking
                key={status}
              >
                {(columnProvided, columnSnapshot) => (
                  <Box
                    ref={columnProvided.innerRef}
                    {...columnProvided.draggableProps}
                    sx={{
                      display: "flex",
                      // lg+: fluid columns that share the width and can shrink to 0.
                      // Below lg: fixed ~280px columns so each stays legible and the
                      // board (overflowX:auto above) scrolls to reach later statuses.
                      flex: { xs: "0 0 280px", lg: "1 1 0" },
                      minWidth: { xs: 280, lg: 0 },
                    }}
                  >
                    <Droppable droppableId={status} type={TICKET_DROP_TYPE}>
                      {(provided, snapshot) => (
                        <Box
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          sx={{
                            flex: 1,
                            minWidth: 0,
                            bgcolor: snapshot.isDraggingOver ? "action.selected" : "background.paper",
                            border: 1,
                            borderColor: columnSnapshot.isDragging ? "primary.main" : "divider",
                            borderRadius: 2,
                            p: 1,
                            minHeight: 120,
                            boxShadow: columnSnapshot.isDragging ? 4 : 0,
                          }}
                        >
                          <Box sx={{ display: "flex", alignItems: "center", minHeight: 44, mb: 0.5 }}>
                            <Typography variant="subtitle2" sx={{ px: 0.5, color: "text.secondary", fontWeight: 700, flexGrow: 1 }}>
                              {status.toUpperCase()} · {ticketsByStatus[status]?.length ?? 0}
                            </Typography>
                            <Tooltip title={savingColumnOrder ? "Saving column order…" : "Drag to reorder column"}>
                              <span>
                                <IconButton
                                  {...columnProvided.dragHandleProps}
                                  aria-label={`Drag to reorder ${status} column`}
                                  disabled={savingColumnOrder}
                                  size="small"
                                  sx={{
                                    width: 44,
                                    height: 44,
                                    cursor: columnSnapshot.isDragging ? "grabbing" : "grab",
                                    touchAction: "none",
                                    color: "text.secondary",
                                  }}
                                >
                                  <DragIndicatorIcon />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </Box>
                          {ticketsByStatus[status]?.map((ticket, index) => {
                            const id = ticket.localId ?? null;
                            const isClosing = id != null && closing.has(id);
                            return (
                              <Draggable
                                draggableId={String(ticket.localId ?? ticket.ticketnumber)}
                                index={index}
                                isDragDisabled={isClosing}
                                key={ticket.localId ?? ticket.ticketnumber}
                              >
                                {(provided, dragSnapshot) => (
                                  <Box
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                    sx={{ marginBottom: 2 }}
                                  >
                                    {/* Inner wrapper owns the close animation so it never
                                        fights @hello-pangea/dnd's drag transform on the
                                        outer (draggable) element. */}
                                    <Box
                                      onAnimationEnd={() => { if (isClosing && id != null) onTicketClose(id); }}
                                      sx={{
                                        position: "relative",
                                        pointerEvents: isClosing ? "none" : "auto",
                                        animation: isClosing
                                          ? `${fallOff} 0.55s cubic-bezier(0.45, 0, 0.65, 1) forwards`
                                          : "none",
                                        "&:hover .kb-close": { opacity: 1 },
                                        // Touch-primary devices have no hover: keep the
                                        // close affordance visible instead of unreachable.
                                        "@media (hover: none)": { "& .kb-close": { opacity: 0.85 } },
                                      }}
                                    >
                                      <TicketCard
                                        ticket={ticket}
                                        onClick={() => onTicketClick(ticket)}
                                        shortenedSummary={ticket.ticketSummary}
                                        selectionEnabled={selectionEnabled && id != null}
                                        selected={id != null && selectedIds.has(id)}
                                        onToggleSelected={id != null ? () => onToggleTicketSelected?.(id) : undefined}
                                      />
                                      {id != null && !dragSnapshot.isDragging && (
                                        <Tooltip title="Close ticket">
                                          <IconButton
                                            className="kb-close"
                                            size="small"
                                            onClick={(e) => { e.stopPropagation(); beginClose(id); }}
                                            sx={{
                                              position: "absolute",
                                              top: 4,
                                              right: 4,
                                              opacity: 0,
                                              transition: "opacity 0.15s, color 0.15s",
                                              color: "text.disabled",
                                              bgcolor: "background.paper",
                                              boxShadow: 1,
                                              "&:hover": { color: "success.main", bgcolor: "background.paper" },
                                            }}
                                          >
                                            <TaskAltIcon fontSize="small" />
                                          </IconButton>
                                        </Tooltip>
                                      )}
                                    </Box>
                                  </Box>
                                )}
                              </Draggable>
                            );
                          })}
                          {provided.placeholder}
                        </Box>
                      )}
                    </Droppable>
                  </Box>
                )}
              </Draggable>
            ))}
            {columnsProvided.placeholder}
          </Box>
        )}
      </Droppable>
    </DragDropContext>
  );
};

export default KanbanBoard;
