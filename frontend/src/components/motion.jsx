import { useLocation } from 'react-router-dom';

/** A dependency-free route entrance wrapper. Motion is disabled globally for reduced-motion users. */
export function PageTransition({ children }) {
  const location = useLocation();
  return <div key={location.pathname} className="page-enter">{children}</div>;
}

export const Stagger = ({ children, className = '' }) => <div className={`stagger-enter ${className}`}>{children}</div>;
