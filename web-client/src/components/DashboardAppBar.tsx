import { AppBar, Toolbar, IconButton, Typography } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";

interface DashboardAppBarProps {
  drawerOpen: boolean;
  toggleDrawer: () => void;
}

const DashboardAppBar: React.FC<DashboardAppBarProps> = ({ drawerOpen, toggleDrawer }) => {
  return (
    <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}>
      <Toolbar>
        <IconButton color="inherit" edge="start" onClick={toggleDrawer} sx={{ mr: 2 }}>
          <MenuIcon />
        </IconButton>
        <Typography variant="h6" noWrap>
          Dashboard
        </Typography>
      </Toolbar>
    </AppBar>
  );
};

export default DashboardAppBar;
