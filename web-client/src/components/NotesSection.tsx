import React from 'react';
import { Box, List, ListItem, Typography } from '@mui/material';
import { ArrowDownward, ArrowUpward } from '@mui/icons-material';

interface NotesSectionProps {
  notes: any[];
  sortAscending: boolean;
  toggleSort: () => void;
}

const NotesSection: React.FC<NotesSectionProps> = ({ notes, sortAscending, toggleSort }) => {
  const sortedNotes = [...notes].sort((a, b) => {
    const dateA = new Date(a.dateCreated).getTime();
    const dateB = new Date(b.dateCreated).getTime();
    return sortAscending ? dateA - dateB : dateB - dateA;
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography
          variant="h6"
          onClick={toggleSort}
          sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
        >
          Notes
          {sortAscending ? <ArrowUpward fontSize="small" /> : <ArrowDownward fontSize="small" />}
        </Typography>
      </Box>

      {notes.length > 0 ? (
        <List>
          {sortedNotes.map((note, index) => (
            <ListItem key={index} divider>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                <Box sx={{ minWidth: 150 }}>
                  <Typography variant="body2" sx={{ color: '#333' }}>
                    {new Date(note.dateCreated).toLocaleTimeString()} {new Date(note.dateCreated).toLocaleDateString()}
                  </Typography>
                </Box>
                <Box sx={{ maxWidth: '70%' }}>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: '#000' }}>
                    {note.text}
                  </Typography>
                </Box>
              </Box>
            </ListItem>
          ))}
        </List>
      ) : (
        <Typography variant="body2" color="textSecondary">
          No notes available for this ticket.
        </Typography>
      )}
    </Box>
  );
};

export default NotesSection;
