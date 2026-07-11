import Navbar from '../Navbar';

// Layout for the marketing/site pages — adds the TV-style top navbar. The /chart route
// lives OUTSIDE this group so it renders full-viewport with no navbar.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <main className="ov-main">{children}</main>
    </>
  );
}
