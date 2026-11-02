const TITLES: Record<string, string> = {
  "/": "Home",
  "/photos": "Photos",
  "/map": "Map",
  "/favorites": "Favourites",
  "/albums": "Albums",
  "/flights": "Flights",
  "/community": "Community",
  "/bin": "Bin",
  "/drones": "Drones",
  "/utilities": "Utilities",
  "/settings": "Settings",
  "/upload": "Upload",
  "/search": "Search",
  "/admin": "Admin",
  "/cinema": "Cinema",
};

export function pageTitleForPath(pathname: string): string | null {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith("/assets/")) return "Asset";
  if (pathname.startsWith("/flights/")) return "Flight";
  if (pathname.startsWith("/albums/")) return "Album";
  if (pathname.startsWith("/u/")) return "Profile";
  return null;
}
