import OvTabs from '../OvTabs';
import HomeFooter from './HomeFooter';
import HomeNav from './HomeNav';

// Shared shell for the Home tab and its content pages (/home, /home/openview, /home/app,
// /home/about): the dark folder-tab bar (Home ↔ OpenView) + the heading nav row.
export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ov-home-shell">
      <OvTabs />
      <div className="ov-home-bg">
        <HomeNav />
        {children}
      </div>
      <HomeFooter year={new Date().getFullYear()} />
    </div>
  );
}
