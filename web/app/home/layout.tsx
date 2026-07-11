import OvTabs from '../OvTabs';
import HomeNav from './HomeNav';

// Shared shell for the Home tab and its content pages (/home, /home/openview, /home/app,
// /home/about): the dark folder-tab bar (Home ↔ OpenView) + the heading nav row.
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <OvTabs active="home" />
      <HomeNav />
      {children}
    </>
  );
}
