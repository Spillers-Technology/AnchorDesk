import { Card, CardContent, Typography, Box } from "@mui/material";
import PriorityHighIcon from "@mui/icons-material/PriorityHigh";
import BusinessIcon from "@mui/icons-material/Business";
import PersonIcon from "@mui/icons-material/Person";
import { Ticket } from "../interfaces";

interface TicketCardProps {
  ticket: Ticket;
  onClick: () => void;
}

const TicketCard: React.FC<TicketCardProps> = ({ ticket, onClick }) => {
  return (
    <Card
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        cursor: "pointer",
        position: "relative",
        padding: 2,
        background: "linear-gradient(135deg, #ffffff 0%, #f4f6f8 100%)",
        borderRadius: 2,
        border: "2px solid #1976d2",
        boxShadow: "0 8px 16px rgba(0, 0, 0, 0.2)",
        "&:hover": {
          boxShadow: "0 12px 24px rgba(0, 0, 0, 0.3)",
          border: "2px solid #f50057",
        },
      }}
      onClick={onClick}
    >
      <Box sx={{ position: "absolute", top: 0, left: 0, width: "100%", height: "4px", backgroundColor: ticket.priority === "High" ? "#f50057" : "#1976d2" }} />
      <CardContent>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <PriorityHighIcon sx={{ color: ticket.priority === "High" ? "#f50057" : "#1976d2", mr: 1 }} />
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Ticket #{ticket.ticketnumber}
          </Typography>
        </Box>
        <Typography variant="body1" sx={{ fontWeight: "bold", color: "#333", mb: 1 }}>
          {ticket.ticketSummary}
        </Typography>

        <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
          <BusinessIcon sx={{ color: "#1976d2", mr: 1 }} />
          <Typography variant="body2" sx={{ color: "#666" }}>
            {ticket.company.CompanyName} (Acronym: {ticket.company.Acronym})
          </Typography>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
          <PersonIcon sx={{ color: "#1976d2", mr: 1 }} />
          <Typography variant="body2" sx={{ color: "#666" }}>
            Engagement Manager: {ticket.company.PrimaryEngagementMgr}
          </Typography>
        </Box>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle1" sx={{ color: "#1976d2", fontWeight: "bold", mb: 1 }}>
            Technicians:
          </Typography>
          {ticket.technicians?.length > 0 ? (
            ticket.technicians.map((tech) => (
              <Box key={tech.TechnicianID} sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
                <PersonIcon sx={{ color: "#666", fontSize: "small", mr: 1 }} />
                <Typography variant="body2" sx={{ color: "#666" }}>
                  {tech.FirstName} {tech.LastName} ({tech.Username})
                </Typography>
              </Box>
            ))
          ) : (
            <Typography variant="body2" color="textSecondary">
              No technicians available.
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

export default TicketCard;
