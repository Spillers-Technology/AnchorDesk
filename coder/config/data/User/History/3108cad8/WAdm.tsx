import { Drawer, List, ListItemButton, ListItemIcon, ListItemText, Divider, IconButton, Toolbar } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import { styled } from "@mui/material/styles";

const DashboardDrawer = styled(Drawer)(({ theme }) => ({
  width: 240,
  flexShrink: 0,
  "& .MuiDrawer-paper": {
    width: 240,
    boxSizing: "border-box",
  },
}));

function DrawerComponent({ drawerOpen :any; toggleDrawer: any}) {
  return (
    <DashboardDrawer variant="temporary" open={drawerOpen} onClose={toggleDrawer}>
      <Toolbar>
        <IconButton onClick={toggleDrawer}>
          <ChevronLeftIcon />
        </IconButton>
      </Toolbar>
      <Divider />
      <List>
        <ListItemButton>
          <ListItemIcon>{/* Add icons if needed */}</ListItemIcon>
          <ListItemText primary="Home" />
        </ListItemButton>
        {/* Add more ListItems for navigation */}
      </List>
    </DashboardDrawer>
  );
}

export default DrawerComponent;
