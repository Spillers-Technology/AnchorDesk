// ./components/KanbanBoard.tsx
import React, { useState } from "react";
import { Box, Typography, IconButton, Tooltip } from "@mui/material";
import { keyframes } from "@mui/system";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Ticket } from "../interfaces";
import TicketCard from "./TicketCard";
import { TICKET_STATUSES } from "../ticketVocab";

interface KanbanBoardProps {
  tickets: Ticket[];
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
  const beginClose = (id: number) =>
    setClosing((prev) => new Set(prev).add(id));

  // "Closed" isn't a working column — closing makes a card fall off the board.
  // We only show a Closed column when closed tickets are actually loaded (i.e.
  // the user opted into them via the advanced search "include closed").
  const hasClosed = tickets.some((t) => t.status === "Closed");
  const statuses = TICKET_STATUSES.filter((s) => s !== "Closed" || hasClosed);

  const ticketsByStatus = statuses.reduce((acc, status) => {
    acc[status] = tickets.filter((ticket) => ticket.status === status);
    return acc;
  }, {} as { [key: string]: Ticket[] });

  const handleDragEnd = (result: any) => {
    if (!result.destination) return;
    const { source, destination, draggableId } = result;
    if (source.droppableId !== destination.droppableId) {
      onStatusChange(Number(draggableId), destination.droppableId);
    }
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      {/* Columns flex to share the available width so the board always fills the
          page — never a horizontal scrollbar. minWidth:0 lets them shrink past
          their content (cards wrap/truncate) so even a narrow viewport fits. */}
      <Box sx={{ display: "flex", gap: 2, pb: 1, width: "100%" }}>
        {statuses.map((status) => (
          <Droppable droppableId={status} key={status}>
            {(provided, snapshot) => (
              <Box
                ref={provided.innerRef}
                {...provided.droppableProps}
                sx={{
                  flex: "1 1 0",
                  minWidth: 0,
                  bgcolor: snapshot.isDraggingOver ? "action.selected" : "grey.50",
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 2,
                  p: 1,
                  minHeight: 120,
                }}
              >
                <Typography variant="subtitle2" sx={{ px: 0.5, mb: 1, color: "text.secondary", fontWeight: 700 }}>
                  {status.toUpperCase()} · {ticketsByStatus[status]?.length ?? 0}
                </Typography>
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
        ))}
      </Box>
    </DragDropContext>
  );
};

export default KanbanBoard;
