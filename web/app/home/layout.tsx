import OvTabs from '../OvTabs';
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
      <footer className="ov-footer">
        <div>© {new Date().getFullYear()} Openview</div>
        <p className="ov-powered-by">
          Powered by{' '}
          <a href="https://juturna.io/" target="_blank" rel="noopener noreferrer">
            Juturna
          </a>
        </p>
        <div className="ov-footer-links">
          <a href="/home/privacy">Privacy</a>
        </div>
      </footer>
    </div>
  );
}
