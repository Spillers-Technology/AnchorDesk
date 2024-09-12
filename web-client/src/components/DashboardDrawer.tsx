import { Drawer, List, ListItem, ListItemText, ListItemIcon, Divider, Toolbar } from "@mui/material";
import HomeIcon from "@mui/icons-material/Home";
import SyncIcon from "@mui/icons-material/Sync";
import AssignmentIcon from "@mui/icons-material/Assignment";

interface DashboardDrawerProps {
  drawerOpen: boolean;
  toggleDrawer: () => void;
  switchToView: (view: "tickets" | "myTickets" | "cwManage") => void;
}

const DashboardDrawer: React.FC<DashboardDrawerProps> = ({ drawerOpen, toggleDrawer, switchToView }) => {
  return (
    <Drawer
      variant="temporary" // Change this to temporary for autoclose behavior
      anchor="left"
      open={drawerOpen}
      onClose={toggleDrawer} // Close drawer when clicking outside
      ModalProps={{
        keepMounted: true, // Better open performance on mobile
      }}
    >
      <Toolbar /> {/* This will help offset the AppBar height */}
      <Divider />
      <List>
        <ListItem button onClick={() => { switchToView("tickets"); toggleDrawer(); }}>
          <ListItemIcon>
            <HomeIcon />
          </ListItemIcon>
          <ListItemText primary="Tickets" />
        </ListItem>
        <ListItem button onClick={() => { switchToView("myTickets"); toggleDrawer(); }}>
          <ListItemIcon>
            <AssignmentIcon />
          </ListItemIcon>
          <ListItemText primary="My Tickets" />
        </ListItem>
        <ListItem button onClick={() => { switchToView("cwManage"); toggleDrawer(); }}>
          <ListItemIcon>
            <SyncIcon />
          </ListItemIcon>
          <ListItemText primary="CW Manage" />
        </ListItem>
      </List>
    </Drawer>
  );
};

export default DashboardDrawer;
